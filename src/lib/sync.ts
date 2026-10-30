/* Phase 4 sync. The phone is the main copy; the cloud keeps a copy so Claude can read it
   (and so a new phone can restore). Every local write marks its row "dirty"; a dirty row is
   pushed to Supabase `nest_rows` when signed in and online. Claude's writes (proposals,
   calendar, mail) live in their own tables and are pulled down. Nothing here ever blocks the app. */
import type { Session } from "@supabase/supabase-js";
import { db, nowISO } from "./db";
import { CLOUD, supabase } from "./supabase";
import { createStore } from "../head/useHead";
import { today, addDays } from "./time";
import { cleanDeep } from "./text";

/** Phone tables copied to the cloud. Photos stay on the phone; proposals/calendar/mail come down, not up. */
export const SYNC_TABLES = ["days", "blocks", "steps", "settings", "areas", "projects", "tasks", "templates", "trash", "fit", "reports", "budget"] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

const DIRTY = "nest:dirty";
const SEP = "\u0001";

export const cloud = createStore({
  signedIn: false, email: "", pending: 0, lastSync: "" as string, error: "" as string, busy: false, claimed: false,
});
const patch = (p: Partial<ReturnType<typeof cloud.get>>) => cloud.set((s) => ({ ...s, ...p }));

/* ---------- dirty rows (kept in localStorage so a closed app still pushes later) ---------- */

let dirty: Map<string, number> = load();
let ver = 0;
/* Writes that come FROM the cloud (a restore) aren't edits, so they aren't marked. Only that transaction is quiet:
   anything Anthony changes at the same moment still syncs. */
const QUIET = "__nestQuiet";
const isQuiet = (tx: unknown) => !!(tx && (tx as Record<string, unknown>)[QUIET]);

function load(): Map<string, number> {
  try { const a = JSON.parse(localStorage.getItem(DIRTY) || "[]") as string[]; return new Map(a.map((k) => [k, 0])); } catch { return new Map(); }
}
let saveT = 0;
function save() {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => { try { localStorage.setItem(DIRTY, JSON.stringify([...dirty.keys()])); } catch { /* full or blocked */ } }, 50);
  patch({ pending: dirty.size });
}
export function markDirty(tbl: string, id: unknown) {
  if (id == null) return;
  dirty.set(tbl + SEP + String(id), ++ver);
  save();
  schedule(4000);
}
export const pendingCount = () => dirty.size;

/** Everything on the phone, marked to go up (first sign-in, or after a restore from a file). */
export async function markAll(): Promise<number> {
  for (const t of SYNC_TABLES) {
    const keys = await db.table(t).toCollection().primaryKeys();
    for (const k of keys) dirty.set(t + SEP + String(k), ++ver);
  }
  save();
  return dirty.size;
}

/* ---------- hooks: every write to a synced table marks its row ---------- */

let hooked = false;
export function installSync() {
  if (hooked) return;
  hooked = true;
  for (const t of SYNC_TABLES) {
    const table = db.table(t);
    const kp = table.schema.primKey.keyPath as string;
    table.hook("creating", function (pk, obj, tx) { if (!isQuiet(tx)) markDirty(t, pk ?? (obj as Record<string, unknown>)[kp]); });
    table.hook("updating", function (_mods, pk, _obj, tx) { if (!isQuiet(tx)) markDirty(t, pk); });
    table.hook("deleting", function (pk, _obj, tx) { if (!isQuiet(tx)) markDirty(t, pk); });
  }
  if (!CLOUD) return;
  supabase.auth.onAuthStateChange((_e, s) => void onSession(s));
  void supabase.auth.getSession().then(({ data }) => onSession(data.session));
  window.addEventListener("online", () => schedule(500));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(800); });
  window.setInterval(() => { if (!document.hidden) schedule(0); }, 120_000);
}

let session: Session | null = null;
async function onSession(s: Session | null) {
  const was = session?.user.id;
  session = s;
  patch({ signedIn: !!s, email: s?.user.email ?? "" });
  if (!s) return;
  if (was !== s.user.id) {
    // Tie Claude's token to this account. (Joining the cloud copy happens in syncNow, before anything is pushed.)
    try { const { data } = await supabase.rpc("nest_claim_gateway"); patch({ claimed: !!data }); } catch { /* offline */ }
  }
  schedule(300);
}

/* ---------- push + pull ---------- */

let timer = 0;
export function schedule(ms: number) {
  if (!CLOUD) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), ms);
}

let running = false;
export async function syncNow(): Promise<boolean> {
  if (!CLOUD || running || !navigator.onLine || !session) return false;
  running = true;
  patch({ busy: true, error: "" });
  try {
    await ensureJoined(session.user.id);
    await pullReports(); // before pushing, so Claude's "fixed" notes are never overwritten by an older copy
    await pushDirty(session.user.id);
    await pushDerived(session.user.id);
    await pullClaude();
    patch({ lastSync: nowISO() });
    return true;
  } catch (e) {
    patch({ error: (e as Error).message || String(e) });
    return false;
  } finally {
    running = false;
    patch({ busy: false, pending: dirty.size });
  }
}

/** First sync for this account on this phone (a new phone, or after a reset): bring the cloud copy down,
    THEN send everything up. Body's rows (settings, program, logs) come from the cloud when it has them, so
    the fresh defaults a new phone starts with can't overwrite the real ones. If this fails (offline),
    nothing is pushed and it tries again next sync. */
const joined = new Set<string>();
async function ensureJoined(userId: string) {
  const key = "nest:pushed-all:" + userId;
  if (joined.has(userId)) return;
  let done = false;
  try { done = !!localStorage.getItem(key); } catch { /* blocked */ }
  if (!done) {
    const n = await restoreFromCloud({ cloudWins: ["fit"] });
    if (n) { const { resetFitCache } = await import("../body/host"); await resetFitCache(); }
    await markAll();
    try { localStorage.setItem(key, nowISO()); } catch { /* blocked */ }
  }
  joined.add(userId);
}

/* Rows the cloud refused even on their own (rare: a value Postgres can't store). They're set aside so the
   rest keep syncing; Settings shows the count. */
const STUCK = "nest:sync-stuck";
function noteStuck(key: string, why: string) {
  try {
    const m = JSON.parse(localStorage.getItem(STUCK) || "{}") as Record<string, string>;
    m[key] = why.slice(0, 160);
    localStorage.setItem(STUCK, JSON.stringify(m));
  } catch { /* blocked */ }
}
export function stuckRows(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STUCK) || "{}") as Record<string, string>; } catch { return {}; }
}

/** The cloud refused the CONTENT (Postgres "data exception" 22xxx / "constraint" 23xxx), not the connection. */
function isDataError(e: { message: string; code?: string }): boolean {
  return /^2[23]/.test(e.code ?? "") || /unicode|escape sequence|invalid input|malformed|violates|too long|out of range/i.test(e.message);
}

/** Rows as they are on the phone, minus anything that can't go up (photo blobs). */
function clean(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!(v instanceof Blob)) out[k] = v;
  return cleanDeep(out);
}

async function pushDirty(userId: string) {
  if (!dirty.size) return;
  const snap = new Map(dirty);
  const byTable = new Map<string, string[]>();
  for (const k of snap.keys()) { const [t, id] = k.split(SEP); if (!byTable.has(t)) byTable.set(t, []); byTable.get(t)!.push(id); }
  for (const [t, ids] of byTable) {
    if (!(SYNC_TABLES as readonly string[]).includes(t)) { ids.forEach((id) => dirty.delete(t + SEP + id)); continue; }
    const rows = await db.table(t as SyncTable).bulkGet(ids);
    let batch: Record<string, unknown>[] = [];
    let size = 0;
    const done = (r: Record<string, unknown>) => { const k = t + SEP + r.id; if (dirty.get(k) === snap.get(k)) dirty.delete(k); };
    const send = async () => {
      if (!batch.length) return;
      const { error } = await supabase.from("nest_rows").upsert(batch, { onConflict: "user_id,tbl,id" });
      if (!error) batch.forEach(done);
      else if (!isDataError(error)) throw new Error(error.message); // offline, signed out, server busy: try again later
      else {
        // One bad row shouldn't hold back the rest: send them one at a time and set aside any the cloud refuses.
        for (const r of batch) {
          const one = await supabase.from("nest_rows").upsert([r], { onConflict: "user_id,tbl,id" });
          if (!one.error) done(r);
          else { noteStuck(t + SEP + r.id, one.error.message); dirty.delete(t + SEP + r.id); }
        }
      }
      save();
      batch = []; size = 0;
    };
    for (let i = 0; i < ids.length; i++) {
      const row = rows[i] as Record<string, unknown> | undefined;
      const data = row ? clean(row) : {};
      const item = {
        user_id: userId, tbl: t, id: ids[i], data,
        day: typeof data.day === "string" ? data.day : null,
        updated_at: nowISO(),
        deleted_at: row ? ((data.deleted_at as string | null | undefined) ?? null) : nowISO(),
      };
      batch.push(item);
      size += JSON.stringify(data).length;
      if (batch.length >= 200 || size > 400_000) await send();
    }
    await send();
  }
}

/* What Claude needs that only the phone can work out: the next week of Body plans and a few settings. */
type FitPlanLike = { date: string; workout: string | null; blocks: { key: string; title: string; start: number | null; minutes: number; done?: boolean; steps: { label: string; value: string; done?: boolean }[] }[] };
export type BodyDerived = { days: FitPlanLike[]; missed: { date: string; workout: string } | null };
let derivedProvider: (() => BodyDerived | null) | null = null;
export function setBodyPlanProvider(fn: () => BodyDerived | null) { derivedProvider = fn; }
let lastDerived = "";

async function pushDerived(userId: string) {
  let body: BodyDerived | null = null;
  try { body = derivedProvider?.() ?? null; } catch { body = null; }
  const fitSettings = (await db.fit.get("fit/settings"))?.value as Record<string, unknown> | undefined;
  const head = (await db.settings.get("head"))?.value as Record<string, unknown> | undefined;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const prefs = {
    tz: "America/Los_Angeles",
    gym_days: fitSettings?.gymDays ?? null,               // 0 = Sunday
    gym_time: typeof fitSettings?.gymTime === "number" ? hm(fitSettings.gymTime as number) : null,
    units: fitSettings?.units ?? "lb",
    plan_time: head?.planTime ?? null, shutdown_time: head?.shutdownTime ?? null, off_days: head?.offDays ?? null,
  };
  const rows: Record<string, unknown>[] = [{ user_id: userId, tbl: "derived", id: "prefs", data: prefs, day: null, updated_at: nowISO(), deleted_at: null }];
  if (body) {
    rows.push({ user_id: userId, tbl: "derived", id: "body_plan", day: null, updated_at: nowISO(), deleted_at: null,
      data: { made: nowISO(), missed: body.missed, days: body.days.map((p) => ({ date: p.date, workout: p.workout,
        blocks: p.blocks.map((b) => ({ key: b.key, title: b.title, start: b.start != null ? hm(b.start) : null, minutes: b.minutes, done: !!b.done,
          steps: b.steps.map((s) => ({ label: s.label, value: s.value, done: !!s.done })) })) })) } });
  }
  const sig = JSON.stringify(rows.map((r) => r.data)).replace(/"made":"[^"]*"/, "");
  if (sig === lastDerived) return;
  const { error } = await supabase.from("nest_rows").upsert(rows, { onConflict: "user_id,tbl,id" });
  if (error) throw new Error(error.message);
  lastDerived = sig;
}

/** Claude's side: proposals, calendar and flagged mail. */
export async function pullClaude() {
  const { flushOutbox, refreshProposals } = await import("./proposals");
  const errors: string[] = [];
  const part = async (f: () => Promise<void>) => { try { await f(); } catch (e) { errors.push((e as Error).message || String(e)); } };
  await part(async () => { await flushOutbox(); await refreshProposals(); });
  await part(pullCalendar);
  await part(pullMail);
  await part(pullMoney);
  await part(async () => { const { syncBank } = await import("./bank"); await syncBank().catch(() => undefined); }); // quiet: the Bank card shows its own state
  if (errors.length) throw new Error(errors.join(" · "));
}

async function pullCalendar() {
  const from = addDays(today(), -1), to = addDays(today(), 7);
  const cal = await supabase.from("calendar_cache").select("google_id,day,start_time,end_time,title,all_day,calendar").gte("day", from).lte("day", to);
  if (cal.error) throw new Error(cal.error.message);
  await db.transaction("rw", db.calendar, async () => {
    await db.calendar.clear();
    await db.calendar.bulkPut((cal.data ?? []).map((e) => ({ id: e.google_id + "|" + e.day, day: e.day, start: e.start_time, end: e.end_time, title: e.title, all_day: e.all_day, calendar: (e as { calendar?: string | null }).calendar ?? null })));
  });
}

/** Phase 6: the money summary Claude leaves each morning (absent until migration 0005 is run: skipped quietly). */
async function pullMoney() {
  const r = await supabase.from("money_summary").select("data,updated_at").maybeSingle();
  if (r.error) { if (/money_summary|relation|schema cache/i.test(r.error.message)) return; throw new Error(r.error.message); }
  if (r.data?.data) { const { saveMoney } = await import("./money"); await saveMoney(r.data.data, r.data.updated_at); }
}

async function pullMail() {
  const { flushOutbox } = await import("./proposals");
  await flushOutbox(); // dismissals first, so a dismissed note doesn't come back
  const dismissed = new Set((await db.outbox.toArray()).filter((o) => o.table === "mail_items").map((o) => o.row_id));
  const mail = await supabase.from("mail_items").select("id,received,sender,subject,ask,due,link,created_at,dismissed_at")
    .is("dismissed_at", null).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(60);
  if (mail.error) throw new Error(mail.error.message);
  await db.transaction("rw", db.mail, async () => { await db.mail.clear(); await db.mail.bulkPut((mail.data ?? []).filter((m) => !dismissed.has(m.id))); });
}

/** Testing mode: when Claude marks a report fixed (through its door), bring the status down. */
async function pullReports() {
  if (!(await db.reports.count())) return;
  const r = await supabase.from("nest_rows").select("id,status:data->>status,fix_note:data->>fix_note,fixed_at:data->>fixed_at")
    .eq("tbl", "reports").is("deleted_at", null).limit(300);
  if (r.error) throw new Error(r.error.message);
  for (const row of (r.data ?? []) as { id: string; status: string | null; fix_note: string | null; fixed_at: string | null }[]) {
    const local = await db.reports.get(row.id);
    if (!local || !row.fixed_at || row.fixed_at <= (local.status_at ?? "")) continue;
    if (local.status === row.status && local.fix_note === row.fix_note) continue;
    await db.reports.update(row.id, { status: (row.status as "open" | "fixed" | "later") ?? local.status, fix_note: row.fix_note, fixed_at: row.fixed_at, status_at: row.fixed_at });
  }
}

/** ✕ on a flagged email: gone here now, and queued for the cloud (sent when signed in and online). */
export async function dismissMail(id: string) {
  await db.mail.delete(id);
  if (!CLOUD) return;
  await db.outbox.put({ op_id: crypto.randomUUID(), table: "mail_items", row_id: id, patch: { dismissed_at: nowISO() }, queued_at: nowISO() });
  const { flushOutbox } = await import("./proposals");
  void flushOutbox();
}

/* ---------- restore from the cloud (a new phone, or after "Reset") ---------- */

export async function cloudCounts(): Promise<Record<string, number> | null> {
  if (!CLOUD || !session) return null;
  const out: Record<string, number> = {};
  for (const t of ["tasks", "blocks", "fit"]) {
    const { count, error } = await supabase.from("nest_rows").select("id", { count: "exact", head: true }).eq("tbl", t).is("deleted_at", null);
    if (error) return null;
    out[t] = count ?? 0;
  }
  return out;
}

/** Adds the cloud copy to this phone. Rows already here stay as they are, except in `cloudWins` tables,
    where the cloud's version replaces this phone's. Returns how many rows were written. */
export async function restoreFromCloud(opts: { cloudWins?: string[] } = {}): Promise<number> {
  if (!CLOUD || !session) throw new Error("Sign in first");
  let n = 0;
  for (const t of SYNC_TABLES) {
    const wins = opts.cloudWins?.includes(t) ?? false;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("nest_rows").select("id,data").eq("tbl", t).is("deleted_at", null)
        .order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      const table = db.table(t);
      const kp = table.schema.primKey.keyPath as string;
      const have = wins ? new Set<string>() : new Set((await table.toCollection().primaryKeys()).map(String));
      const add = data.filter((r) => !have.has(String((r.data as Record<string, unknown>)[kp] ?? r.id))).map((r) => r.data);
      if (add.length) {
        await db.transaction("rw", table, async (tx) => { (tx as unknown as Record<string, unknown>)[QUIET] = true; await table.bulkPut(add); });
      }
      n += add.length;
      if (data.length < 1000) break;
    }
  }
  return n;
}

export async function signOut() {
  await supabase.auth.signOut();
  patch({ signedIn: false, email: "", claimed: false });
}
