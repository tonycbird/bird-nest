/* Money (Phase 6): a read-only summary of Bird Budgeting. Claude works it out each morning
   (claude/tools/money.mjs) and leaves it in the cloud; the phone keeps a copy. No money is entered here:
   Bird Budgeting stays the place to import, label and mark bills paid. */
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { addBlock } from "./river";
import { today as riverToday } from "./time";

export interface MoneyCategory { id: string; name: string; budget: number; spent: number; left: number }
export interface MoneyBill { id: string; name: string; date: string; amount: number; late: boolean; unseen: boolean }
export interface MoneySummary {
  v: number;
  as_of: string;
  month: string;
  today: string;
  left: { total: number; budget: number; spent: number };
  categories: MoneyCategory[];
  groceries: MoneyCategory | null;
  payday: { date: string; amount: number } | null;
  before_payday: { total: number; bills: MoneyBill[] };
  bank_through: string | null;
  overdue: number;
  unseen: number;
  due_today: { id: string; name: string; amount: number }[];
  paid_this_month: { count: number; total: number };
  to_sort: number;
  /** Phase 7: "nest" when Nest worked it out from the bank itself (Bird Budgeting's has none). */
  source?: "nest";
  sorted?: { you: number; rule: number; hint: number };
  plan_own?: boolean;
  paycheck?: import("./money-core.js").Paycheck | null;
  trends?: import("./money-core.js").Trends;
}

/** Bird Budgeting's own link (it opens in Safari). */
export const BUDGET_URL = "https://claude.ai/code/artifact/edb46b38-b8d7-4236-838f-5f9ad2f1f7cd";

export const fmtMoney = (n: number, round = false) => {
  const v = Math.abs(n);
  const s = round || v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "−$" : "$") + s;
};

export function useMoney(): { summary: MoneySummary | null; updated: string | null; ready: boolean } {
  const row = useLiveQuery(() => db.money.get("summary"), [], undefined);
  return { summary: row?.data ?? null, updated: row?.updated_at ?? null, ready: row !== undefined };
}

/** What the cloud hands down: Bird Budgeting's summary, and once, the setup that moves it into Nest.
    After that Nest works the numbers out itself, and Bird Budgeting's summary no longer replaces them. */
export async function saveMoney(data: MoneySummary & { setup?: unknown; setup_gz?: unknown }, updated_at: string): Promise<void> {
  if (!data || typeof data !== "object" || !data.month) return;
  if (data.setup || data.setup_gz) {
    const { importSetup, refreshNestMoney, unpackSetup } = await import("./budget");
    const setup = await unpackSetup(data);
    if (setup && (await importSetup(setup))) await refreshNestMoney();
  }
  if ((await db.money.get("summary"))?.data?.source === "nest") return;
  const { setup: _setup, setup_gz: _gz, ...summary } = data;
  void _setup; void _gz;
  await db.money.put({ key: "summary", data: summary, updated_at });
}

/** This month's summary only: last month's numbers would mislead. */
export function isCurrent(s: MoneySummary | null, day = riverToday()): s is MoneySummary {
  return !!s && s.month === day.slice(0, 7);
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Bills due today → small money blocks on the River ("Open ICCU · Pay $65 · Mark paid in Budget").
    Once per bill per day: a block you delete stays deleted. Only from a summary made today. */
export async function placeBillBlocks(day: string = riverToday()): Promise<number> {
  const row = await db.money.get("summary");
  const s = row?.data;
  if (!s || s.today !== day || !s.due_today?.length) return 0;
  const blocks = await db.blocks.where("day").equals(day).toArray();
  const placed = new Set(blocks.filter((b) => b.source_type === "bill").map((b) => b.source_id)); // deleted ones count too
  let at = 7 * 60 + 30, n = 0;
  const taken = blocks.filter((b) => !b.deleted_at).map((b) => b.start);
  for (const bill of s.due_today) {
    const sid = `${day}|${bill.id}`;
    if (placed.has(sid)) continue;
    while (taken.includes(hhmm(at))) at += 15;
    await addBlock({
      day, start: hhmm(at), end: hhmm(at + 15), kind: "money", icon: "bill", title: `Pay ${bill.name}`.slice(0, 48),
      // Nest sees the payment in the bank by itself; Bird Budgeting needed it marked by hand.
      steps: s.source === "nest" ? [{ label: "Open ICCU" }, { label: "Pay", value: fmtMoney(bill.amount) }] : [{ label: "Open ICCU" }, { label: "Pay", value: fmtMoney(bill.amount) }, { label: "Mark paid in Budget" }],
      source_type: "bill", source_id: sid,
    });
    taken.push(hhmm(at)); at += 15; n++;
  }
  return n;
}

/** "$348 left" for the grocery block, when there's a fresh summary. */
export async function groceriesLeftLabel(day: string = riverToday()): Promise<string | null> {
  const s = (await db.money.get("summary"))?.data ?? null;
  return isCurrent(s, day) && s.groceries ? `${fmtMoney(s.groceries.left, true)} left` : null;
}
