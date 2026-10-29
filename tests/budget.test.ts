import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../src/lib/db";
import { budgetAccounts, importSetup, refreshNestMoney, setPlanAmount, sortPurchase, SKIP, toggleBudgetAccount } from "../src/lib/budget";
import { saveMoney, type MoneySummary } from "../src/lib/money";
import type { Setup } from "../src/lib/money-core.js";

vi.mock("../src/lib/time", async (orig) => ({ ...(await orig<typeof import("../src/lib/time")>()), today: () => "2026-10-29" }));

const setup: Setup = {
  v: 1, from: "bird-budgeting", made: "2026-10-29T18:00:00Z",
  envelopes: [
    { key: "groceries", name: "Groceries", group: "food", order: 0, archived: false },
    { key: "dining", name: "Dining Out", group: "food", order: 1, archived: false },
    { key: "internet", name: "Internet", group: "housing", order: 0, archived: false },
  ],
  groups: [], plans: [{ month: "2026-10", amounts: { groceries: 500, dining: 250, internet: 65 } }],
  bills: [{ id: "net", type: "expense", name: "Internet", amount: 65, dueDay: 28, cadence: "", dueMonth: null, anchorDate: "", categoryId: "internet" }],
  labels: [{ key: "winco foods", categoryId: "groceries" }],
};
const accounts = [
  { account_id: "joint", item_id: "i", name: "Joint Checking", mask: "9123", type: "depository", subtype: "checking", current: 324.48, available: 300, updated: 0 },
  { account_id: "biz", item_id: "i", name: "Small Business Checking", mask: "9381", type: "depository", subtype: "checking", current: 0, available: 0, updated: 0 },
  { account_id: "card", item_id: "i", name: "Credit Card", mask: "5648", type: "credit", subtype: "credit card", current: 4949, available: null, updated: 0 },
];
const t = (id: string, amount: number, date: string, o: Record<string, unknown> = {}) => ({ id, item_id: "i", account_id: "joint", date, month: date.slice(0, 7), amount, name: "", merchant: "", pending: false, hint: "", updated_at: "x", ...o });
const bb = { v: 1, as_of: "x", month: "2026-10", today: "2026-10-29", left: { total: 1, budget: 1, spent: 0 }, categories: [], groceries: { id: "groceries", name: "Groceries", budget: 500, spent: 152, left: 348 }, payday: null, before_payday: { total: 0, bills: [] }, bank_through: "2026-10-09", overdue: 0, unseen: 0, due_today: [], paid_this_month: { count: 0, total: 0 }, to_sort: 3 } as MoneySummary;

beforeEach(async () => {
  await Promise.all([db.budget.clear(), db.txns.clear(), db.money.clear(), db.bank.clear()]);
  await db.bank.put({ key: "status", data: { accounts, items: [{ item_id: "i" }] }, updated_at: "x" });
});

describe("the budget account", () => {
  test("Joint Checking by default: not the business account, not the card", () => {
    expect([...budgetAccounts(accounts as never)]).toEqual(["joint"]);
    expect([...budgetAccounts(accounts as never, ["joint", "biz"])]).toEqual(["joint", "biz"]);
  });
  test("tapping an account adds it to the budget, tapping again takes it out", async () => {
    await toggleBudgetAccount("biz");
    expect((await db.budget.get("prefs"))?.accounts).toEqual(["joint", "biz"]);
    await toggleBudgetAccount("biz");
    expect((await db.budget.get("prefs"))?.accounts).toEqual(["joint"]);
  });
});

describe("moving in from Bird Budgeting", () => {
  test("the setup is imported once; after that Nest owns it", async () => {
    expect(await importSetup(setup)).toBe(true);
    expect(await db.budget.where("kind").equals("envelope").count()).toBe(3);
    expect(await db.budget.get("label:winco foods")).toMatchObject({ categoryId: "groceries" });
    expect(await db.budget.get("bill:net")).toMatchObject({ amount: 65, dueDay: 28 });
    expect(await importSetup({ ...setup, envelopes: [setup.envelopes[0]] })).toBe(false);
    expect(await db.budget.where("kind").equals("envelope").count()).toBe(3);
  });
  test("Bird Budgeting's summary shows until the bank has purchases, then Nest's own takes over", async () => {
    await saveMoney({ ...bb, setup } as never, "2026-10-29T12:00:00Z");
    expect((await db.money.get("summary"))?.data.source).toBeUndefined(); // no purchases yet
    expect((await db.money.get("summary"))?.data).not.toHaveProperty("setup");
    await db.txns.bulkPut([t("g", -152.36, "2026-10-27", { merchant: "WinCo Foods" }), t("x", -20, "2026-10-28", { merchant: "Some Shop" }), t("biz1", -99, "2026-10-28", { account_id: "biz" })]);
    expect(await refreshNestMoney("2026-10-29")).toBe(true);
    const s = (await db.money.get("summary"))!.data;
    expect(s.source).toBe("nest");
    expect(s.groceries).toMatchObject({ spent: 152.36, left: 347.64 });
    expect(s.to_sort).toBe(1);
    await saveMoney(bb, "2026-10-30T12:00:00Z"); // tomorrow's Bird Budgeting summary doesn't replace it
    expect((await db.money.get("summary"))!.data.source).toBe("nest");
  });
});

describe("his changes", () => {
  beforeEach(async () => {
    await importSetup(setup);
    await db.txns.bulkPut([t("x", -20, "2026-10-28", { merchant: "Pizza Place" }), t("v", -40, "2026-10-26", { merchant: "Venmo", name: "VENMO PAYMENT TOMMY" })]);
  });
  test("sorting a store remembers it; undo takes both back", async () => {
    const undo = await sortPurchase({ id: "x", merchant: "Pizza Place", name: "" }, "dining");
    expect(await db.budget.get("sort:x")).toMatchObject({ categoryId: "dining" });
    expect(await db.budget.get("label:pizza place")).toMatchObject({ categoryId: "dining" });
    expect((await db.money.get("summary"))!.data.to_sort).toBe(1);
    await undo();
    expect((await db.budget.get("sort:x"))?.deleted_at).toBeTruthy();
    expect((await db.budget.get("label:pizza place"))?.deleted_at).toBeTruthy();
    expect((await db.money.get("summary"))!.data.to_sort).toBe(2);
  });
  test("Venmo is sorted on its own (no rule); 'not spending' leaves the totals", async () => {
    await sortPurchase({ id: "v", merchant: "Venmo", name: "VENMO PAYMENT TOMMY" }, SKIP);
    expect(await db.budget.where("kind").equals("label").count()).toBe(1);
    const s = (await db.money.get("summary"))!.data;
    expect(s.to_sort).toBe(1);
    expect(s.left.spent).toBe(0);
  });
  test("changing an envelope's amount writes this month's plan", async () => {
    await setPlanAmount("2026-10", "groceries", 600);
    expect((await db.budget.get("plan:2026-10"))?.amounts).toMatchObject({ groceries: 600, dining: 250 });
    expect((await db.money.get("summary"))!.data.plan_own).toBe(true);
  });
});

describe("a setup that arrived early", () => {
  test("an older Nest kept it with the summary: it moves in at start", async () => {
    const { startMoney } = await import("../src/lib/budget");
    await db.money.put({ key: "summary", data: { ...bb, setup } as never, updated_at: "x" });
    await startMoney();
    expect(await db.budget.where("kind").equals("envelope").count()).toBe(3);
  });
});
