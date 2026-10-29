/* Phase 7: money in Nest. Nest's own budget (envelopes, plans, bills, store rules, his sorts) lives in the
   `budget` table and syncs like everything else; purchases come from the bank (txns). The summary the
   Money screen, the Today circle and the bill blocks read is worked out here and kept in `money` under
   "summary", the same place Bird Budgeting's summary used to land, so every reader keeps working. */
import { useLiveQuery } from "dexie-react-hooks";
import { db, nowISO, type BudgetRow, type Txn } from "./db";
import type { BankAccount, BankStatus } from "./bank";
import { nestSummary, planFor, SKIP, sortOf, storeKeyFor, type Bill, type Envelope, type Label, type Plan, type Setup, type SortCtx } from "./money-core.js";
import { today } from "./time";

export { SKIP };
const live = (r: BudgetRow) => !r.deleted_at;

/** First time only: Bird Budgeting's envelopes, plans, bills and store rules become Nest's. */
export async function importSetup(setup: Setup): Promise<boolean> {
  if (!setup || setup.v !== 1 || !Array.isArray(setup.envelopes) || !setup.envelopes.length) return false;
  if (await db.budget.where("kind").equals("envelope").count()) return false; // already set up: Nest owns it now
  const at = nowISO();
  const rows: BudgetRow[] = [
    ...setup.envelopes.map((e) => ({ id: "env:" + e.key, kind: "envelope" as const, key: e.key, name: e.name, group: e.group, order: e.order, archived: e.archived, updated_at: at })),
    ...setup.plans.map((p) => ({ id: "plan:" + p.month, kind: "plan" as const, month: p.month, amounts: p.amounts, carry: p.carry ?? {}, updated_at: at })),
    ...setup.bills.map(({ id, ...b }) => ({ ...b, id: "bill:" + id, kind: "bill" as const, updated_at: at })),
    ...setup.labels.map((l) => ({ id: "label:" + l.key, kind: "label" as const, key: l.key, categoryId: l.categoryId, updated_at: at })),
  ];
  const prefs = await db.budget.get("prefs");
  rows.push({ ...(prefs ?? {}), id: "prefs", kind: "prefs", setup_made: setup.made, groups: setup.groups, updated_at: at });
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
  groups: { id: string; name: string; isIncome: boolean }[]; prefs: BudgetRow | undefined; accounts: BankAccount[]; budgetIds: Set<string>;
}
async function load(): Promise<Loaded> {
  const rows = (await db.budget.toArray()).filter(live);
  const by = (k: BudgetRow["kind"]) => rows.filter((r) => r.kind === k);
  const prefs = rows.find((r) => r.id === "prefs");
  const status = (await db.bank.get("status"))?.data as BankStatus | undefined;
  const accounts = status?.accounts ?? [];
  return {
    envelopes: by("envelope").map((r) => ({ key: r.key!, name: r.name ?? "", group: r.group ?? "", order: r.order ?? 0, archived: !!r.archived })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    plans: by("plan").map((r) => ({ month: r.month!, amounts: r.amounts ?? {}, carry: r.carry ?? {} })),
    bills: by("bill").map((r) => ({ id: r.id.slice(5), type: r.type ?? "expense", name: r.name ?? "", amount: r.amount ?? 0, dueDay: r.dueDay ?? 0, cadence: r.cadence ?? "", dueMonth: r.dueMonth ?? null, anchorDate: r.anchorDate ?? "", categoryId: r.categoryId ?? "" })),
    labels: by("label").map((r) => ({ key: r.key!, categoryId: r.categoryId ?? "" })),
    sorts: new Map(by("sort").map((r) => [r.txn!, r.categoryId ?? ""])),
    groups: prefs?.groups ?? [],
    prefs, accounts, budgetIds: budgetAccounts(accounts, prefs?.accounts),
  };
}

/** Work the summary out again (after a pull, a sort, a plan change, or a new day). Quiet until there's
    a setup and the bank has purchases on a budget account. */
export async function refreshNestMoney(day = today()): Promise<boolean> {
  const d = await load();
  if (!d.envelopes.length) return false;
  const txns = await db.txns.toArray();
  if (!txns.some((t) => d.budgetIds.has(t.account_id))) return false;
  const s = nestSummary({ ...d, txns, accounts: d.budgetIds }, day);
  await db.money.put({ key: "summary", data: s, updated_at: nowISO() });
  return true;
}

/** At start: a setup that arrived while an older Nest was running (it kept it with the summary) moves in now. */
export async function startMoney(): Promise<void> {
  const row = await db.money.get("summary");
  const setup = (row?.data as { setup?: Setup } | undefined)?.setup;
  if (setup) await importSetup(setup);
  await refreshNestMoney();
}

/* ---------- what the Money screen needs live ---------- */

export interface Purchase extends Txn { cat: string | null; how: "you" | "rule" | "hint" | null }
export function useBudget() {
  return useLiveQuery(async () => {
    const d = await load();
    const ctx: SortCtx = { sorts: d.sorts, labels: d.labels, envelopes: d.envelopes, keys: new Set(d.envelopes.filter((e) => !e.archived).map((e) => e.key)) };
    const month = today().slice(0, 7);
    const txns = (await db.txns.where("month").equals(month).toArray()).filter((t) => d.budgetIds.has(t.account_id));
    const purchases: Purchase[] = txns.map((t) => ({ ...t, ...sortOf(t, ctx) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { ...d, month, plan: planFor(month, d.plans, d.bills), purchases };
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

/** Change what an envelope gets this month (the rest of the month's plan is kept as it is). */
export async function setPlanAmount(month: string, key: string, amount: number): Promise<void> {
  const d = await load();
  const p = planFor(month, d.plans, d.bills);
  p.amounts[key] = Math.max(0, Math.round(amount * 100) / 100);
  await db.budget.put({ id: "plan:" + month, kind: "plan", month, amounts: p.amounts, carry: p.carry, updated_at: nowISO() });
  await refreshNestMoney();
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
