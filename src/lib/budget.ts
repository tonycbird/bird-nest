/* Phase 7: money in Nest. Nest's own budget (envelopes, plans, bills, store rules, his sorts) lives in the
   `budget` table and syncs like everything else; purchases come from the bank (txns). The summary the
   Money screen, the Today circle and the bill blocks read is worked out here and kept in `money` under
   "summary", the same place Bird Budgeting's summary used to land, so every reader keeps working. */
import { useLiveQuery } from "dexie-react-hooks";
import { db, nowISO, uid, type BudgetRow, type Txn } from "./db";
import type { BankAccount, BankStatus } from "./bank";
import { billDaysInMonth, budgetMonth, makeCtx, matchHistory, monthBills, nestSummary, paidCheck, planOf, SKIP, sortOf, storeKeyFor, suggestPlan, usualSpend, type Bill, type Envelope, type HistoryEntry, type Label, type Plan, type Setup } from "./money-core.js";
import { today } from "./time";

export { SKIP };
const live = (r: BudgetRow) => !r.deleted_at;

/** The setup rides the money door gzipped (setup_gz) so it fits; older payloads carry it plain. */
export async function unpackSetup(data: { setup?: unknown; setup_gz?: unknown } | undefined | null): Promise<Setup | null> {
  if (!data) return null;
  if (data.setup && typeof data.setup === "object") return data.setup as Setup;
  if (typeof data.setup_gz !== "string" || !data.setup_gz) return null;
  try {
    const bin = Uint8Array.from(atob(data.setup_gz), (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return JSON.parse(text) as Setup;
  } catch { return null; }
}

/** Bird Budgeting's envelopes, plans, bills, store rules, paid marks and sorting history become Nest's.
    The first setup moves everything in. A newer setup (v2) on a phone that took an older one (v1, Oct 29)
    upgrades it in place: it adds what v1 didn't carry (keywords, targets, marks, history, mixed stores),
    takes Anthony's bill decisions, and keeps everything he has changed since (plans, his sorts, his store
    rules). Anything older or the same is ignored: after that, Nest owns it. */
export async function importSetup(setup: Setup): Promise<boolean> {
  if (!setup || (setup.v !== 1 && setup.v !== 2) || !Array.isArray(setup.envelopes) || !setup.envelopes.length) return false;
  const prefs = await db.budget.get("prefs");
  const had = await db.budget.where("kind").equals("envelope").count();
  if (had && (prefs?.setup_v ?? 1) >= setup.v) return false;
  const at = nowISO();
  const env = (e: Setup["envelopes"][number]) => ({ keywords: e.keywords ?? [], target: e.target ?? null, priority: e.priority ?? "", rollover: !!e.rollover });
  const rows: BudgetRow[] = [];
  if (!had) {
    rows.push(
      ...setup.envelopes.map((e) => ({ id: "env:" + e.key, kind: "envelope" as const, key: e.key, name: e.name, group: e.group, order: e.order, archived: e.archived, ...env(e), updated_at: at })),
      ...setup.plans.map((p) => ({ id: "plan:" + p.month, kind: "plan" as const, month: p.month, amounts: p.amounts, carry: p.carry ?? {}, updated_at: at })),
      ...setup.bills.map(({ id, ...b }) => ({ ...b, id: "bill:" + id, kind: "bill" as const, updated_at: at })),
      ...setup.labels.map((l) => ({ id: "label:" + l.key, kind: "label" as const, key: l.key, categoryId: l.categoryId, updated_at: at })),
    );
  } else {
    // Upgrade: envelopes gain their extras; bills are replaced (there's no bill editing yet, so nothing of his is lost);
    // store rules and plans he may have touched are left as they are, and only missing rules are added.
    const old = new Map((await db.budget.where("kind").anyOf("envelope", "bill", "label").toArray()).map((r) => [r.id, r]));
    for (const e of setup.envelopes) {
      const r = old.get("env:" + e.key);
      rows.push(r ? { ...r, ...env(e), updated_at: at } : { id: "env:" + e.key, kind: "envelope", key: e.key, name: e.name, group: e.group, order: e.order, archived: e.archived, ...env(e), updated_at: at });
    }
    const billIds = new Set(setup.bills.map((b) => "bill:" + b.id));
    rows.push(...setup.bills.map(({ id, ...b }) => ({ ...b, id: "bill:" + id, kind: "bill" as const, updated_at: at })));
    for (const r of old.values()) if (r.kind === "bill" && !billIds.has(r.id) && !r.deleted_at) rows.push({ ...r, deleted_at: at, updated_at: at });
    for (const l of setup.labels) if (!old.has("label:" + l.key)) rows.push({ id: "label:" + l.key, kind: "label", key: l.key, categoryId: l.categoryId, updated_at: at });
  }
  for (const m of setup.marks ?? []) {
    const id = `mark:${m.billId}_${m.month}`;
    if (!had || !(await db.budget.get(id))) rows.push({ id, kind: "mark", billId: m.billId, month: m.month, amount: m.amount, date: m.date, updated_at: at });
  }
  if (setup.history?.length) rows.push({ id: "history", kind: "history", entries: setup.history, updated_at: at });
  rows.push({ ...(prefs ?? {}), id: "prefs", kind: "prefs", setup_made: setup.made, setup_v: setup.v, groups: setup.groups, mixed: setup.mixed ?? prefs?.mixed ?? {}, updated_at: at });
  await db.budget.bulkPut(rows);
  return true;
}

/** The accounts that count as the budget: his pick, else Joint Checking (any checking that isn't business). */
export function budgetAccounts(accounts: BankAccount[], picked?: string[] | null): Set<string> {
  if (picked?.length) return new Set(picked);
  const chk = accounts.filter((a) => a.subtype === "checking");
  const joint = chk.filter((a) => /joint/i.test(a.name));
  const pick = joint.length ? joint : chk.filter((a) => !/business/i.test(a.name));
  return new Set((pick.length ? pick : chk.slice(0, 1)).map((a) => a.account_id));
}

interface Loaded {
  envelopes: Envelope[]; plans: Plan[]; bills: Bill[]; labels: Label[]; sorts: Map<string, string>;
  marks: { recurringId: string; month: string; kind: "manual"; amount: number; date: string }[];
  history: HistoryEntry[]; mixed: Record<string, Record<string, number>>;
  groups: { id: string; name: string; isIncome: boolean }[]; prefs: BudgetRow | undefined; accounts: BankAccount[]; budgetIds: Set<string>;
}
async function load(): Promise<Loaded> {
  const rows = (await db.budget.toArray()).filter(live);
  const by = (k: BudgetRow["kind"]) => rows.filter((r) => r.kind === k);
  const prefs = rows.find((r) => r.id === "prefs");
  const status = (await db.bank.get("status"))?.data as BankStatus | undefined;
  const accounts = status?.accounts ?? [];
  return {
    envelopes: by("envelope").map((r) => ({ key: r.key!, name: r.name ?? "", group: r.group ?? "", order: r.order ?? 0, archived: !!r.archived,
      keywords: r.keywords ?? [], target: r.target ?? null, priority: r.priority ?? "", rollover: !!r.rollover })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    plans: by("plan").map((r) => ({ month: r.month!, amounts: r.amounts ?? {}, carry: r.carry ?? {} })),
    bills: by("bill").map((r) => ({ id: r.id.slice(5), type: r.type ?? "expense", name: r.name ?? "", amount: r.amount ?? 0, dueDay: r.dueDay ?? 0, cadence: r.cadence ?? "",
      dueMonth: r.dueMonth ?? null, anchorDate: r.anchorDate ?? "", categoryId: r.categoryId ?? "", variesBy: r.variesBy ?? 0 })),
    labels: by("label").map((r) => ({ key: r.key!, categoryId: r.categoryId ?? "" })),
    sorts: new Map(by("sort").map((r) => [r.txn!, r.categoryId ?? ""])),
    marks: by("mark").map((r) => ({ recurringId: r.billId!, month: r.month!, kind: "manual" as const, amount: r.amount ?? 0, date: r.date ?? "" })),
    history: (by("history")[0]?.entries ?? []).map(([date, cents, cat, name]) => ({ date, cents, cat, name })),
    groups: prefs?.groups ?? [], mixed: prefs?.mixed ?? {},
    prefs, accounts, budgetIds: budgetAccounts(accounts, prefs?.accounts),
  };
}

/** Bird Budgeting's sorting lands on the bank's copy: each past purchase that finds its twin (same cents,
    within 3 days) gets the envelope it had there, as his own pick. Runs again as more history arrives;
    a purchase he has ever sorted himself (even undone) is never touched. */
async function applyHistory(d: Loaded, txns: Txn[]): Promise<number> {
  if (!d.history.length) return 0;
  const mine = txns.filter((t) => d.budgetIds.has(t.account_id));
  const { pairs } = matchHistory(d.history, mine);
  const keys = new Set(d.envelopes.map((e) => e.key));
  const want = pairs.filter((p) => p.cat && keys.has(p.cat));
  if (!want.length) return 0;
  const had = await db.budget.bulkGet(want.map((p) => "sort:" + p.txn));
  const at = nowISO();
  const add: BudgetRow[] = want.filter((_, i) => !had[i]).map((p) => ({ id: "sort:" + p.txn, kind: "sort", txn: p.txn, categoryId: p.cat, from: "bird", updated_at: at }));
  if (add.length) await db.budget.bulkPut(add);
  return add.length;
}

/** Every budget-account purchase with its envelope (his pick, a rule, Plaid's hint, or none yet). */
function sortAll(d: Loaded, txns: Txn[]) {
  const ctx = makeCtx(d);
  return { ctx, sorted: txns.filter((t) => d.budgetIds.has(t.account_id)).map((t) => ({ ...t, ...sortOf(t, ctx) })) };
}

/** A new month starts on the suggested plan (bills, his usual spending, the paychecks that pay for it),
    written down so it's his to change. Only once there's a full month of the bank's history to go on. */
async function startMonthPlan(d: Loaded, txns: Txn[], day: string): Promise<boolean> {
  const month = day.slice(0, 7);
  if (d.plans.some((p) => p.month === month)) return false;
  if ((await db.budget.get("plan:" + month))) return false; // he removed it (deleted row): leave it
  const { ctx, sorted } = sortAll(d, txns);
  if (!sorted.some((t) => t.month < month)) return false;
  const sg = suggestPlan({ ...d, income: ctx.income }, month, day, sorted);
  await db.budget.put({ id: "plan:" + month, kind: "plan", month, amounts: sg.amounts, carry: {}, from: "suggested", updated_at: nowISO() });
  return true;
}

/** Work the summary out again (after a pull, a sort, a plan change, or a new day). Quiet until there's
    a setup and the bank has purchases on a budget account. */
export async function refreshNestMoney(day = today()): Promise<boolean> {
  let d = await load();
  if (!d.envelopes.length) return false;
  const txns = await db.txns.toArray();
  if (!txns.some((t) => d.budgetIds.has(t.account_id))) return false;
  if (await applyHistory(d, txns)) d = await load();
  if (await startMonthPlan(d, txns, day)) d = await load();
  const s = nestSummary({ ...d, txns, accounts: d.budgetIds }, day);
  await db.money.put({ key: "summary", data: s, updated_at: nowISO() });
  return true;
}

/** At start: a setup that arrived while an older Nest was running (it kept it with the summary) moves in now. */
export async function startMoney(): Promise<void> {
  const setup = await unpackSetup((await db.money.get("summary"))?.data as never);
  if (setup) await importSetup(setup);
  await refreshNestMoney();
}

/* ---------- what the Money screen needs live ---------- */

export interface Purchase extends Txn { cat: string | null; how: "you" | "rule" | "hint" | null }
/** One month of the budget, live: the plan (his, or the suggested one), every envelope's plan / spent /
    left, money in, the month's bills, its purchases, his usual month, and the suggestion. */
export function useBudget(month: string = today().slice(0, 7)) {
  return useLiveQuery(async () => {
    const d = await load();
    const day = today();
    const { ctx, sorted } = sortAll(d, await db.txns.toArray());
    const dd = { ...d, income: ctx.income };
    const plan = planOf(month, dd, day, sorted);
    const statusOf = paidCheck(d.bills, sorted, d.marks, day);
    const purchases: Purchase[] = sorted.filter((t) => t.month === month).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      ...d, month, day, income: ctx.income, plan, purchases,
      bm: budgetMonth(dd, month, day, sorted, plan, statusOf),
      billLines: monthBills(d.bills, month, statusOf),
      usual: usualSpend(sorted, day, ctx.income).by,
      suggestion: suggestPlan(dd, month, day, sorted),
      months: [...new Set([...d.plans.map((p) => p.month), day.slice(0, 7)])].sort(), // the months he has a budget for
    };
  }, [month]);
}
export type BudgetView = NonNullable<ReturnType<typeof useBudget>>;

/** Settings → Bank: how Bird Budgeting's history lines up with the bank's copy, over the dates both have. */
export function useBirdCheck() {
  return useLiveQuery(async () => {
    const d = await load();
    if (!d.history.length) return null;
    const txns = (await db.txns.toArray()).filter((t) => d.budgetIds.has(t.account_id));
    if (!txns.length) return null;
    const m = matchHistory(d.history, txns);
    return { matched: m.matched, total: m.total, from: m.from, to: m.to, onlyBird: m.onlyBird, onlyBank: m.onlyBank };
  }, []);
}

/* ---------- his changes ---------- */

/** Sort one purchase. For a store (not Venmo, a transfer…), remember it so the next one sorts itself. */
export async function sortPurchase(t: Pick<Txn, "id" | "merchant" | "name">, categoryId: string, remember = true): Promise<() => Promise<void>> {
  const at = nowISO();
  const store = remember && categoryId !== SKIP ? storeKeyFor(t) : null;
  const before = await db.budget.bulkGet(["sort:" + t.id, ...(store ? ["label:" + store] : [])]);
  await db.budget.put({ id: "sort:" + t.id, kind: "sort", txn: t.id, categoryId, updated_at: at });
  if (store) await db.budget.put({ id: "label:" + store, kind: "label", key: store, categoryId, updated_at: at });
  await refreshNestMoney();
  return async () => {
    const at2 = nowISO();
    const [sort, label] = before;
    await db.budget.put(sort ? { ...sort, updated_at: at2 } : { id: "sort:" + t.id, kind: "sort", txn: t.id, updated_at: at2, deleted_at: at2 });
    if (store) await db.budget.put(label ? { ...label, updated_at: at2 } : { id: "label:" + store, kind: "label", key: store, updated_at: at2, deleted_at: at2 });
    await refreshNestMoney();
  };
}

async function planNow(month: string) {
  const d = await load();
  const { ctx, sorted } = sortAll(d, await db.txns.toArray());
  return planOf(month, { ...d, income: ctx.income }, today(), sorted);
}

/** Change what an envelope gets in a month (the rest of that month's plan is kept as it is). */
export async function setPlanAmount(month: string, key: string, amount: number): Promise<void> {
  const p = await planNow(month);
  p.amounts[key] = Math.max(0, Math.round(amount * 100) / 100);
  await db.budget.put({ id: "plan:" + month, kind: "plan", month, amounts: p.amounts, carry: p.carry, updated_at: nowISO() });
  await refreshNestMoney();
}

/** Use a whole plan for a month (the suggested one). Returns an undo. */
export async function usePlan(month: string, amounts: Record<string, number>): Promise<() => Promise<void>> {
  const before = await db.budget.get("plan:" + month);
  const p = await planNow(month);
  await db.budget.put({ id: "plan:" + month, kind: "plan", month, amounts: { ...amounts }, carry: p.carry, updated_at: nowISO() });
  await refreshNestMoney();
  return async () => {
    const at = nowISO();
    await db.budget.put(before ? { ...before, updated_at: at } : { id: "plan:" + month, kind: "plan", month, updated_at: at, deleted_at: at });
    await refreshNestMoney();
  };
}

/* ---------- bills (and paychecks) he changes himself ---------- */

export type BillInput = Omit<Bill, "id"> & { id?: string };
const monthsFrom = (day: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
const billTotal = (bills: Bill[], cat: string, month: string) => {
  const [y, m] = month.split("-").map(Number);
  return Math.round(bills.filter((b) => b.type === "expense" && b.categoryId === cat).reduce((a, b) => a + billDaysInMonth(b, y, m - 1).length * (Number(b.amount) || 0), 0) * 100) / 100;
};

/** Change a bill or a paycheck (or add one). A month's plan that was following its bills (planned = what they
    cost) follows the change, this month and next; a plan he set to something else is left alone. Returns undo. */
export async function saveBill(b: BillInput): Promise<() => Promise<void>> {
  const id = b.id ?? uid();
  const d = await load();
  const old = d.bills.find((x) => x.id === id);
  const next: Bill = { ...b, id, amount: Math.round((Number(b.amount) || 0) * 100) / 100 } as Bill;
  const after = [...d.bills.filter((x) => x.id !== id), next];
  const at = nowISO();
  const touched = await followPlans(d, after, [old?.categoryId, next.categoryId], at);
  const before = await db.budget.get("bill:" + id);
  const { id: _i, ...rest } = next; void _i;
  await db.budget.put({ ...(before ?? {}), ...rest, id: "bill:" + id, kind: "bill", deleted_at: null, updated_at: at });
  await refreshNestMoney();
  return async () => {
    const t = nowISO();
    await db.budget.put(before ? { ...before, updated_at: t } : { id: "bill:" + id, kind: "bill", updated_at: t, deleted_at: t });
    for (const r of touched) await db.budget.put({ ...r, updated_at: t });
    await refreshNestMoney();
  };
}

/** Take a bill off (it stays in the past months' paid marks); a plan that followed it follows. Returns undo. */
export async function removeBill(id: string): Promise<() => Promise<void>> {
  const row = await db.budget.get("bill:" + id);
  if (!row) return async () => {};
  const d = await load();
  const at = nowISO();
  const touched = await followPlans(d, d.bills.filter((x) => x.id !== id), [row.categoryId], at);
  await db.budget.put({ ...row, deleted_at: at, updated_at: at });
  await refreshNestMoney();
  return async () => {
    const t = nowISO();
    await db.budget.put({ ...row, deleted_at: null, updated_at: t });
    for (const r of touched) await db.budget.put({ ...r, updated_at: t });
    await refreshNestMoney();
  };
}

/** This month's and next month's plans: an envelope planned at exactly what its bills cost follows the bills. */
async function followPlans(d: Loaded, after: Bill[], cats: (string | null | undefined)[], at: string): Promise<BudgetRow[]> {
  const touched: BudgetRow[] = [];
  for (const month of monthsFrom(today(), 2)) {
    const plan = d.plans.find((p) => p.month === month);
    if (!plan) continue;
    const amounts = { ...plan.amounts };
    let changed = false;
    for (const cat of new Set(cats.filter((c): c is string => !!c))) {
      const was = billTotal(d.bills, cat, month), now = billTotal(after, cat, month);
      if (was !== now && Math.abs((amounts[cat] ?? 0) - was) < 0.01) { amounts[cat] = now; changed = true; }
    }
    if (changed) { const row = await db.budget.get("plan:" + month); if (row) { touched.push(row); await db.budget.put({ ...row, amounts, updated_at: at }); } }
  }
  return touched;
}

/** A purchase that was pending posts under a new id: his pick moves with it. */
export async function carrySorts(pairs: [string, string][]): Promise<number> {
  if (!pairs.length) return 0;
  const olds = await db.budget.bulkGet(pairs.map(([, was]) => "sort:" + was));
  const news = await db.budget.bulkGet(pairs.map(([id]) => "sort:" + id));
  const at = nowISO();
  const add: BudgetRow[] = [];
  pairs.forEach(([id], i) => {
    const o = olds[i];
    if (o && !o.deleted_at && o.categoryId && !news[i]) add.push({ id: "sort:" + id, kind: "sort", txn: id, categoryId: o.categoryId, ...(o.from ? { from: o.from } : {}), updated_at: at });
  });
  if (add.length) await db.budget.bulkPut(add);
  return add.length;
}

/** Tap an account in Settings → Bank to count it in the budget, or not. */
export async function toggleBudgetAccount(accountId: string): Promise<void> {
  const d = await load();
  const now = new Set(d.budgetIds);
  if (now.has(accountId)) now.delete(accountId); else now.add(accountId);
  await db.budget.put({ ...(d.prefs ?? {}), id: "prefs", kind: "prefs", accounts: [...now], updated_at: nowISO() });
  await refreshNestMoney();
}
export function useBudgetAccounts(): Set<string> | undefined {
  return useLiveQuery(async () => (await load()).budgetIds, []);
}
