/* The bank part of the Nest helper (Phase 7, money in Nest).
   One Bank Durable Object holds the Plaid link(s), their cursors, the accounts and every transaction.
   The bank key (Plaid's access_token) never leaves it: the phone only ever gets transactions and balances.
   Plaid's keys are Cloudflare Secrets (PLAID_CLIENT_ID, PLAID_SANDBOX_SECRET, PLAID_SECRET).

   Only Anthony: every call needs his Supabase session, and the first account that uses the bank owns it.
   Sign: like Bird Budgeting, spending is negative (Plaid sends it positive). */
import { DurableObject } from "cloudflare:workers";

export type PlaidEnv = "sandbox" | "production";
export interface BankEnv {
  BANK: DurableObjectNamespace<Bank>;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;          // production
  PLAID_SANDBOX_SECRET?: string;  // the practice bank
  PLAID_REDIRECT_URI?: string;    // only if a bank signs in on its own site (OAuth)
  PLAID_DEV_BASE?: string;        // local tests only: every Plaid call goes here
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;          // the publishable key (public)
}

export const PROD_LINK_LIMIT = 10;  // Plaid's free Trial: 10 bank links, ever
const PAGE = 500;
const FOLLOW_UPS = [60_000, 10 * 60_000, 60 * 60_000]; // after a new link, look again (history arrives in waves)

/** The code rides in the message too: errors that cross from the Durable Object to the door lose their class. */
export class PlaidError extends Error {
  constructor(public code: string, message: string) { super(code + "|" + message); }
}
export function errCode(e: unknown): { code: string; message: string } {
  if (e instanceof PlaidError) return { code: e.code, message: e.message.slice(e.code.length + 1) };
  const m = /^([A-Z0-9_]+)\|([\s\S]*)$/.exec(String((e as Error)?.message ?? e));
  return m ? { code: m[1], message: m[2] } : { code: "ERROR", message: String((e as Error)?.message ?? e) };
}

type Row = Record<string, string | number | boolean | null>;
export interface PlaidTxn {
  transaction_id: string; account_id: string; amount: number; date: string; name?: string | null; merchant_name?: string | null;
  pending?: boolean; pending_transaction_id?: string | null; personal_finance_category?: { primary?: string; detailed?: string } | null;
}
interface PlaidAccount { account_id: string; name?: string; official_name?: string | null; mask?: string | null; type?: string; subtype?: string | null; balances?: { current?: number | null; available?: number | null } }

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/** Plaid → Nest: spending negative, short strings, the detailed category kept as a hint for sorting. */
export function toNest(t: PlaidTxn) {
  return {
    id: clip(t.transaction_id, 80),
    account_id: clip(t.account_id, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? String(t.date) : "",
    amount: money(-Number(t.amount)),
    name: clip(t.name ?? "", 120),
    merchant: clip(t.merchant_name ?? "", 80),
    pending: t.pending ? 1 : 0,
    pending_id: clip(t.pending_transaction_id ?? "", 80), // a posted purchase points back at its pending one
    hint: clip(t.personal_finance_category?.detailed || t.personal_finance_category?.primary || "", 60),
  };
}

async function plaid<T = Record<string, unknown>>(env: BankEnv, pe: PlaidEnv, path: string, body: Record<string, unknown>): Promise<T> {
  const secret = pe === "production" ? env.PLAID_SECRET : env.PLAID_SANDBOX_SECRET;
  if (!env.PLAID_CLIENT_ID || !secret) throw new PlaidError("NO_KEYS", "Plaid keys aren't in Cloudflare yet");
  const base = env.PLAID_DEV_BASE || (pe === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com");
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID.trim(), secret: secret.trim(), ...body }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new PlaidError(String(j.error_code || "HTTP_" + r.status), String(j.error_message || j.display_message || "Plaid said no").slice(0, 200));
  return j as T;
}

/** Errors that need Anthony to sign in to the bank again (Link in update mode; it doesn't use a new link). */
const LOGIN_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "INVALID_CREDENTIALS", "INSUFFICIENT_CREDENTIALS", "USER_SETUP_REQUIRED", "MFA_NOT_SUPPORTED", "NO_ACCOUNTS"]);

export class Bank extends DurableObject<BankEnv> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: BankEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (item_id TEXT PRIMARY KEY, env TEXT NOT NULL, access_token TEXT NOT NULL, inst_id TEXT, inst_name TEXT,
        cursor TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ok', error TEXT NOT NULL DEFAULT '', update_status TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, last_sync INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS accounts (account_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT, mask TEXT, type TEXT, subtype TEXT,
        current REAL, available REAL, updated INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS txns (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, account_id TEXT, date TEXT, amount REAL, name TEXT, merchant TEXT,
        pending INTEGER NOT NULL DEFAULT 0, pending_id TEXT, hint TEXT, removed INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS txns_seq ON txns(seq)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
  }

  private meta(k: string): string | null {
    const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return r ? String(r.v) : null;
  }
  private setMeta(k: string, v: string) { this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v); }
  private nextSeq(): number { const n = Number(this.meta("seq") || 0) + 1; this.setMeta("seq", String(n)); return n; }

  /** The first signed-in account to use the bank owns it; anyone else is turned away. */
  async claim(userId: string): Promise<boolean> {
    const o = this.meta("owner");
    if (o) return o === userId;
    this.setMeta("owner", userId);
    return true;
  }

  async linkToken(pe: PlaidEnv, itemId?: string): Promise<{ link_token: string; prod_used: number }> {
    const prodUsed = Number(this.meta("prod_links") || 0);
    const body: Record<string, unknown> = { client_name: "Bird Nest", language: "en", country_codes: ["US"], user: { client_user_id: "nest-owner" } };
    if (this.env.PLAID_REDIRECT_URI) body.redirect_uri = this.env.PLAID_REDIRECT_URI;
    if (itemId) {
      // Update mode: sign in again on the same link. Doesn't count against the 10.
      const it = this.sql.exec("SELECT access_token, env FROM items WHERE item_id = ?", itemId).toArray()[0];
      if (!it) throw new PlaidError("NO_ITEM", "That bank link isn't here");
      body.access_token = String(it.access_token);
      const r = await plaid<{ link_token: string }>(this.env, it.env as PlaidEnv, "/link/token/create", body);
      return { link_token: r.link_token, prod_used: prodUsed };
    }
    if (pe === "production" && prodUsed >= PROD_LINK_LIMIT) throw new PlaidError("LINK_LIMIT", "All 10 free bank links are used");
    body.products = ["transactions"];
    body.transactions = { days_requested: 730 };
    const r = await plaid<{ link_token: string }>(this.env, pe, "/link/token/create", body);
    return { link_token: r.link_token, prod_used: prodUsed };
  }

  async exchange(pe: PlaidEnv, publicToken: string, inst: { id?: string; name?: string }): Promise<Row> {
    const r = await plaid<{ access_token: string; item_id: string }>(this.env, pe, "/item/public_token/exchange", { public_token: publicToken });
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`INSERT INTO items (item_id, env, access_token, inst_id, inst_name, created_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(item_id) DO UPDATE SET access_token = excluded.access_token, status = 'ok', error = ''`,
        r.item_id, pe, r.access_token, clip(inst.id, 40), clip(inst.name, 80), Date.now());
      if (pe === "production") this.setMeta("prod_links", String(Number(this.meta("prod_links") || 0) + 1));
    });
    await this.syncItem(r.item_id).catch(() => undefined);
    this.setMeta("follow_ups", JSON.stringify(FOLLOW_UPS.map((d) => Date.now() + d)));
    await this.armAlarm();
    return this.status();
  }

  /** After update mode (signed in again): clear the error and pull. */
  async relinked(itemId: string): Promise<Row> {
    this.sql.exec("UPDATE items SET status = 'ok', error = '' WHERE item_id = ?", itemId);
    await this.syncItem(itemId).catch(() => undefined);
    return this.status();
  }

  async syncAll(): Promise<number> {
    let n = 0;
    for (const it of this.sql.exec("SELECT item_id FROM items").toArray()) n += await this.syncItem(String(it.item_id)).catch(() => 0);
    this.setMeta("last_run", String(Date.now()));
    return n;
  }

  /** Pull everything new for one link with /transactions/sync, then write it in one go. */
  async syncItem(itemId: string): Promise<number> {
    const it = this.sql.exec("SELECT access_token, env, cursor FROM items WHERE item_id = ?", itemId).toArray()[0];
    if (!it) return 0;
    const start = String(it.cursor || "");
    let added: PlaidTxn[] = [], modified: PlaidTxn[] = [], removed: { transaction_id: string }[] = [], accounts: PlaidAccount[] = [];
    let cursor = start, status = "";
    for (let attempt = 0; ; attempt++) {
      try {
        added = []; modified = []; removed = []; cursor = start;
        for (let page = 0; page < 40; page++) {
          const r = await plaid<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean; accounts?: PlaidAccount[]; transactions_update_status?: string }>(
            this.env, it.env as PlaidEnv, "/transactions/sync", { access_token: String(it.access_token), cursor: cursor || undefined, count: PAGE });
          added.push(...(r.added || [])); modified.push(...(r.modified || [])); removed.push(...(r.removed || []));
          if (r.accounts?.length) accounts = r.accounts;
          if (r.transactions_update_status) status = r.transactions_update_status;
          cursor = r.next_cursor || cursor;
          if (!r.has_more) break;
        }
        break;
      } catch (e) {
        const { code } = errCode(e);
        if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 3) continue;
        this.sql.exec("UPDATE items SET status = ?, error = ?, last_sync = ? WHERE item_id = ?",
          LOGIN_CODES.has(code) ? "login" : "error", code, Date.now(), itemId);
        throw e;
      }
    }
    let changed = 0;
    this.ctx.storage.transactionSync(() => {
      for (const t of [...added, ...modified]) {
        const x = toNest(t);
        if (!x.id || !x.date) continue;
        this.sql.exec(`INSERT INTO txns (id, item_id, account_id, date, amount, name, merchant, pending, pending_id, hint, removed, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, date = excluded.date, amount = excluded.amount, name = excluded.name,
              merchant = excluded.merchant, pending = excluded.pending, pending_id = excluded.pending_id, hint = excluded.hint, removed = 0, seq = excluded.seq`,
          x.id, itemId, x.account_id, x.date, x.amount, x.name, x.merchant, x.pending, x.pending_id, x.hint, this.nextSeq());
        changed++;
      }
      for (const r of removed) {
        const id = clip(r.transaction_id, 80);
        if (!id) continue;
        this.sql.exec("UPDATE txns SET removed = 1, seq = ? WHERE id = ?", this.nextSeq(), id);
        changed++;
      }
      for (const a of accounts) {
        this.sql.exec(`INSERT INTO accounts (account_id, item_id, name, mask, type, subtype, current, available, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, mask = excluded.mask, type = excluded.type, subtype = excluded.subtype,
              current = excluded.current, available = excluded.available, updated = excluded.updated`,
          clip(a.account_id, 80), itemId, clip(a.name || a.official_name || "Account", 60), clip(a.mask ?? "", 8), clip(a.type ?? "", 20), clip(a.subtype ?? "", 30),
          a.balances?.current ?? null, a.balances?.available ?? null, Date.now());
      }
      this.sql.exec("UPDATE items SET cursor = ?, status = 'ok', error = '', update_status = ?, last_sync = ? WHERE item_id = ?", cursor, status, Date.now(), itemId);
    });
    return changed;
  }

  /** "Pull now": ask Plaid to check the bank (free on the Trial), take what's there, look again in 90 s. */
  async pull(): Promise<Row> {
    for (const it of this.sql.exec("SELECT access_token, env FROM items WHERE status = 'ok'").toArray()) {
      await plaid(this.env, it.env as PlaidEnv, "/transactions/refresh", { access_token: String(it.access_token) }).catch(() => undefined);
    }
    await this.syncAll();
    const due = JSON.parse(this.meta("follow_ups") || "[]") as number[];
    this.setMeta("follow_ups", JSON.stringify([...due, Date.now() + 90_000]));
    await this.armAlarm();
    return this.status();
  }

  /** Practice links only: real ones stay (removing a real one doesn't give the link back). */
  async remove(itemId: string): Promise<Row> {
    const it = this.sql.exec("SELECT access_token, env FROM items WHERE item_id = ?", itemId).toArray()[0];
    if (!it) throw new PlaidError("NO_ITEM", "That bank link isn't here");
    if (it.env !== "sandbox") throw new PlaidError("REAL_LINK", "Real bank links stay");
    await plaid(this.env, "sandbox", "/item/remove", { access_token: String(it.access_token) }).catch(() => undefined);
    this.ctx.storage.transactionSync(() => {
      for (const t of this.sql.exec("SELECT id FROM txns WHERE item_id = ? AND removed = 0", itemId).toArray()) this.sql.exec("UPDATE txns SET removed = 1, seq = ? WHERE id = ?", this.nextSeq(), String(t.id));
      this.sql.exec("DELETE FROM accounts WHERE item_id = ?", itemId);
      this.sql.exec("DELETE FROM items WHERE item_id = ?", itemId);
    });
    return this.status();
  }

  status(): Row {
    const items = this.sql.exec("SELECT item_id, env, inst_name, status, error, update_status, last_sync FROM items ORDER BY created_at").toArray();
    const accounts = this.sql.exec("SELECT account_id, item_id, name, mask, type, subtype, current, available, updated FROM accounts").toArray();
    const c = this.sql.exec("SELECT COUNT(*) AS n, MAX(date) AS newest FROM txns WHERE removed = 0").one();
    return {
      ok: true,
      keys_sandbox: !!this.env.PLAID_CLIENT_ID && !!this.env.PLAID_SANDBOX_SECRET,
      keys_production: !!this.env.PLAID_CLIENT_ID && !!this.env.PLAID_SECRET,
      items: JSON.stringify(items), accounts: JSON.stringify(accounts),
      count: Number(c.n) || 0, newest: (c.newest as string | null) ?? null,
      seq: Number(this.meta("seq") || 0), prod_used: Number(this.meta("prod_links") || 0), prod_limit: PROD_LINK_LIMIT,
      last_run: Number(this.meta("last_run") || 0),
    };
  }

  /** What changed since the phone last asked (by sequence number, removed ones included). */
  changes(since: number, limit = 1000): Row {
    const rows = this.sql.exec("SELECT id, item_id, account_id, date, amount, name, merchant, pending, pending_id, hint, removed, seq FROM txns WHERE seq > ? ORDER BY seq LIMIT ?",
      Math.max(0, Math.floor(since) || 0), Math.min(Math.max(limit, 1), 2000)).toArray();
    const seq = rows.length ? Number(rows[rows.length - 1].seq) : Math.max(0, Math.floor(since) || 0);
    return { ok: true, rows: JSON.stringify(rows), seq, more: rows.length >= limit };
  }

  private async armAlarm() {
    const due = (JSON.parse(this.meta("follow_ups") || "[]") as number[]).filter((t) => t > Date.now() - 60_000).sort((a, b) => a - b);
    this.setMeta("follow_ups", JSON.stringify(due));
    if (due.length) await this.ctx.storage.setAlarm(Math.max(due[0], Date.now() + 1000));
  }
  async alarm(): Promise<void> {
    const due = (JSON.parse(this.meta("follow_ups") || "[]") as number[]).filter((t) => t > Date.now() + 1000);
    this.setMeta("follow_ups", JSON.stringify(due));
    await this.syncAll();
    await this.armAlarm();
  }
}

/* ---------- the /api/bank/* door ---------- */

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function sha256(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Who's asking: the Supabase account behind the session token (checked with Supabase, cached 5 minutes). */
const seen = new Map<string, { id: string; exp: number }>();
export async function sessionUser(req: Request, env: BankEnv): Promise<string | null> {
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(req.headers.get("authorization") || "");
  if (!m || !env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  const h = await sha256(m[1]);
  const c = seen.get(h);
  if (c && c.exp > Date.now()) return c.id;
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_KEY, authorization: "Bearer " + m[1] } }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = (await r.json().catch(() => null)) as { id?: string } | null;
  if (!u?.id) return null;
  if (seen.size > 50) seen.clear();
  seen.set(h, { id: u.id, exp: Date.now() + 5 * 60_000 });
  return u.id;
}

const OPS = new Set(["status", "link", "exchange", "relinked", "pull", "changes", "remove"]);
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function bankFetch(req: Request, env: BankEnv, op: string): Promise<Response> {
  if (!OPS.has(op)) return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 8_000) return json({ error: "too big" }, 413);
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { return json({ error: "bad json" }, 400); }
  const user = await sessionUser(req, env);
  if (!user) return json({ ok: false, why: "SIGN_IN" }, 401);
  const bank = env.BANK.get(env.BANK.idFromName("main"));
  if (!(await bank.claim(user))) return json({ ok: false, why: "NOT_YOURS" }, 403);
  const pe: PlaidEnv = body.env === "production" ? "production" : "sandbox";
  const item = typeof body.item_id === "string" && ID.test(body.item_id) ? body.item_id : undefined;
  try {
    switch (op) {
      case "status": return json(unpack(await bank.status()));
      case "link": return json({ ok: true, ...(await bank.linkToken(pe, item)) });
      case "exchange": {
        const pt = typeof body.public_token === "string" ? body.public_token.slice(0, 200) : "";
        if (!/^public-[a-z]+-[A-Za-z0-9-]+$/.test(pt)) return json({ ok: false, why: "BAD_TOKEN" }, 400);
        const inst = (body.institution ?? {}) as { id?: string; name?: string };
        return json(unpack(await bank.exchange(pe, pt, { id: clip(inst.id, 40), name: clip(inst.name, 80) })));
      }
      case "relinked": if (!item) return json({ ok: false, why: "NO_ITEM" }, 400); return json(unpack(await bank.relinked(item)));
      case "pull": return json(unpack(await bank.pull()));
      case "changes": {
        const r = await bank.changes(Number(body.since) || 0, Number(body.limit) || 1000);
        return json({ ok: true, rows: JSON.parse(String(r.rows)), seq: r.seq, more: r.more });
      }
      case "remove": if (!item) return json({ ok: false, why: "NO_ITEM" }, 400); return json(unpack(await bank.remove(item)));
    }
  } catch (e) {
    const { code, message } = errCode(e);
    const status = code === "NO_KEYS" ? 503 : code === "LINK_LIMIT" || code === "REAL_LINK" ? 409 : code === "NO_ITEM" ? 404 : 502;
    return json({ ok: false, why: code, message: message.slice(0, 200) }, status);
  }
  return json({ error: "not found" }, 404);
}

/** status() packs lists as JSON strings (Durable Object replies must be plain values); unpack them for the phone. */
function unpack(r: Row) {
  return { ...r, items: JSON.parse(String(r.items || "[]")), accounts: JSON.parse(String(r.accounts || "[]")) };
}

export async function bankCron(env: BankEnv): Promise<void> {
  await env.BANK.get(env.BANK.idFromName("main")).syncAll();
}
