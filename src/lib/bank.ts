/* Phase 7: the bank, through Plaid. The helper (worker/bank.ts) holds the bank link and pulls new
   transactions every 3 hours; the phone asks it for what changed and keeps a copy in `txns`.
   Plaid Link (Plaid's own sign-in screen) opens on top of Nest: Anthony signs in to his bank there,
   so Nest never sees the login. Every call carries his Supabase session; the helper checks it. */
import { useLiveQuery } from "dexie-react-hooks";
import { db, nowISO, type Txn } from "./db";
import { CLOUD, supabase } from "./supabase";

export type PlaidEnv = "sandbox" | "production";
export interface BankItem { item_id: string; env: PlaidEnv; inst_name: string; status: "ok" | "login" | "error"; error: string; update_status: string; last_sync: number }
export interface BankAccount { account_id: string; item_id: string; name: string; mask: string; type: string; subtype: string; current: number | null; available: number | null; updated: number }
export interface BankStatus {
  ok: boolean; keys_sandbox: boolean; keys_production: boolean;
  items: BankItem[]; accounts: BankAccount[];
  count: number; newest: string | null; seq: number; prod_used: number; prod_limit: number; last_run: number;
}
interface RawTxn { id: string; item_id: string; account_id: string; date: string; amount: number; name: string; merchant: string; pending: number; pending_id: string | null; hint: string; removed: number; seq: number }

/** Why a bank call didn't work, in a word the screen can turn into a sentence. */
export class BankFail extends Error {
  constructor(public why: string, message?: string) { super(message || why); }
}

const PLAID_JS = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

async function sessionToken(): Promise<string | null> {
  if (!CLOUD) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function bankCall<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const t = await sessionToken();
  if (!t) throw new BankFail("SIGN_IN");
  let r: Response;
  try {
    r = await fetch(`/api/bank/${op}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  } catch { throw new BankFail("OFFLINE"); }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; why?: string; message?: string };
  if (!r.ok || j.ok === false) throw new BankFail(j.why || "HTTP_" + r.status, j.message);
  return j as T;
}

async function saveStatus(s: BankStatus) { await db.bank.put({ key: "status", data: s, updated_at: nowISO() }); }

export function useBank(): { status: BankStatus | null; checked: string | null; ready: boolean } {
  const row = useLiveQuery(() => db.bank.get("status"), [], undefined);
  return { status: (row?.data as BankStatus | undefined) ?? null, checked: row?.updated_at ?? null, ready: row !== undefined };
}

export async function refreshStatus(): Promise<BankStatus> {
  const s = await bankCall<BankStatus>("status");
  await saveStatus(s);
  return s;
}

/** Bring down what changed since last time. Nest's own sorting (category, note) stays put, and a purchase
    that goes from pending to posted keeps the category it was given while pending. */
export async function pullBank(): Promise<number> {
  let since = Number((await db.bank.get("seq"))?.data ?? 0);
  let n = 0;
  for (let page = 0; page < 30; page++) {
    const r = await bankCall<{ rows: RawTxn[]; seq: number; more: boolean }>("changes", { since, limit: 1000 });
    await db.transaction("rw", db.txns, db.bank, async () => {
      const keys = [...new Set(r.rows.flatMap((x) => (x.pending_id ? [x.id, x.pending_id] : [x.id])))];
      const old = new Map((await db.txns.bulkGet(keys)).filter((t): t is Txn => !!t).map((t) => [t.id, t]));
      const put: Txn[] = [], del: string[] = [];
      for (const x of r.rows) {
        if (x.removed) { del.push(x.id); continue; }
        const was = old.get(x.id) ?? (x.pending_id ? old.get(x.pending_id) : undefined);
        put.push({
          id: x.id, item_id: x.item_id, account_id: x.account_id, date: x.date, month: x.date.slice(0, 7), amount: x.amount,
          name: x.name, merchant: x.merchant, pending: !!x.pending, hint: x.hint,
          category: was?.category ?? null, note: was?.note ?? null, updated_at: nowISO(),
        });
      }
      const keep = new Set(put.map((t) => t.id));
      if (put.length) await db.txns.bulkPut(put);
      if (del.length) await db.txns.bulkDelete(del.filter((id) => !keep.has(id)));
      await db.bank.put({ key: "seq", data: r.seq, updated_at: nowISO() });
    });
    n += r.rows.length;
    since = r.seq;
    if (!r.more) break;
  }
  if (n) { const { refreshNestMoney } = await import("./budget"); await refreshNestMoney(); }
  return n;
}

/** Part of every sync, once a bank is linked: quiet when there's nothing new. */
export async function syncBank(): Promise<void> {
  const s = (await db.bank.get("status"))?.data as BankStatus | undefined;
  if (!s?.items?.length) return;
  await pullBank();
  await refreshStatus();
  const { refreshNestMoney } = await import("./budget");
  await refreshNestMoney();
}

/* ---------- Plaid Link ---------- */

interface PlaidMeta { institution?: { institution_id?: string; name?: string } | null }
interface PlaidHandler { open(): void; destroy?(): void }
declare global {
  interface Window { Plaid?: { create(o: { token: string; onSuccess(publicToken: string, meta: PlaidMeta): void; onExit(err: unknown, meta?: unknown): void }): PlaidHandler } }
}

let loading: Promise<void> | null = null;
function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return (loading ??= new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = PLAID_JS;
    s.async = true;
    s.onload = () => (window.Plaid ? res() : rej(new BankFail("OFFLINE")));
    s.onerror = () => { loading = null; rej(new BankFail("OFFLINE")); };
    document.head.appendChild(s);
  }));
}

function openLink(token: string): Promise<{ publicToken: string; meta: PlaidMeta } | null> {
  return new Promise((res) => {
    let h: PlaidHandler | null = null;
    h = window.Plaid!.create({
      token,
      onSuccess: (publicToken, meta) => { h?.destroy?.(); res({ publicToken, meta }); },
      onExit: () => { h?.destroy?.(); res(null); },
    });
    h.open();
  });
}

/** Link a bank. "closed" means he backed out (nothing was used up). */
export async function connectBank(env: PlaidEnv): Promise<"ok" | "closed"> {
  const [{ link_token }] = await Promise.all([bankCall<{ link_token: string }>("link", { env }), loadPlaid()]);
  const r = await openLink(link_token);
  if (!r) return "closed";
  const inst = r.meta?.institution ?? null;
  const s = await bankCall<BankStatus>("exchange", { env, public_token: r.publicToken, institution: { id: inst?.institution_id ?? "", name: inst?.name ?? "" } });
  await saveStatus(s);
  await pullBank();
  return "ok";
}

/** The bank wants him to sign in again: same link (Plaid's update mode), nothing used up. */
export async function reconnectBank(itemId: string): Promise<"ok" | "closed"> {
  const [{ link_token }] = await Promise.all([bankCall<{ link_token: string }>("link", { item_id: itemId }), loadPlaid()]);
  const r = await openLink(link_token);
  if (!r) return "closed";
  await saveStatus(await bankCall<BankStatus>("relinked", { item_id: itemId }));
  await pullBank();
  return "ok";
}

export async function pullNow(): Promise<number> {
  await saveStatus(await bankCall<BankStatus>("pull"));
  return pullBank();
}

export async function removePractice(itemId: string): Promise<void> {
  await saveStatus(await bankCall<BankStatus>("remove", { item_id: itemId }));
  await pullBank();
}

/** For the Bank card: the words for a failed call. */
export function bankWhy(e: unknown): string {
  const why = e instanceof BankFail ? e.why : "ERROR";
  if (why === "SIGN_IN") return "Connect Claude first (Settings → Claude).";
  if (why === "OFFLINE") return "No connection. Try again with signal.";
  if (why === "NO_KEYS") return "The Plaid keys aren't in Cloudflare yet.";
  if (why === "NOT_YOURS") return "This bank belongs to another Nest account.";
  if (why === "LINK_LIMIT") return "All 10 free bank links are used.";
  if (why === "INVALID_API_KEYS") return "Plaid didn't take the keys. Check them in Cloudflare.";
  return "Plaid said no. Try again in a minute.";
}
