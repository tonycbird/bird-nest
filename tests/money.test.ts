import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import { summarize, billDaysInMonth, nextPayday, txnLines } from "../claude/tools/money.mjs";
import { db } from "../src/lib/db";
import { groceriesLeftLabel, placeBillBlocks, saveMoney, type MoneySummary } from "../src/lib/money";

/* A made-up household with the same shapes as Bird Budgeting's data (no real numbers). */
const recurring = [
  { id: "rent", type: "expense", name: "Rent", amount: 1500, dueDay: 2, categoryId: "rent" },
  { id: "net", type: "expense", name: "Internet", amount: 60, dueDay: 28, categoryId: "internet" },
  { id: "carA", type: "expense", name: "Car Insurance (State Farm)", amount: 80, dueDay: 1, categoryId: "auto" },
  { id: "carB", type: "expense", name: "Honda Insurance", amount: 50, dueDay: 20, categoryId: "auto" },
  { id: "phone", type: "expense", name: "Phone", amount: 45, dueDay: 12, categoryId: "phone" },
  { id: "reg", type: "expense", name: "Registration", amount: 120, dueDay: 15, dueMonth: 3, cadence: "yearly", categoryId: "dmv" },
  { id: "water", type: "expense", name: "Water", amount: 90, dueDay: 5, categoryId: "water" },
  { id: "pay1", type: "income", name: "Payroll", amount: 1500, cadence: "biweekly", anchorDate: "2026-04-03" },
  { id: "pay2", type: "income", name: "Payroll 2", amount: 400, cadence: "biweekly", anchorDate: "2026-04-03" },
];
const categories = [
  { id: "groceries", name: "Groceries", group: "food" }, { id: "dining", name: "Dining Out", group: "food" },
  { id: "fuel", name: "Fuel", group: "transport" }, { id: "rent", name: "Rent", group: "housing" },
  { id: "internet", name: "Internet", group: "housing" }, { id: "auto", name: "Auto Insurance", group: "insurance" },
  { id: "phone", name: "Phone", group: "housing" }, { id: "dmv", name: "DMV", group: "transport" }, { id: "water", name: "Water", group: "housing" },
  { id: "paycat", name: "Paychecks", group: "income" }, { id: "old", name: "Old", group: "fun", archived: true },
];
const budget = { month: "2026-10", allocations: { groceries: 500, dining: 200, fuel: 150, rent: 1500, internet: 60, auto: 130, phone: 45, water: 90 }, carryover: { groceries: 25 } };
const transactions = [
  { id: "t1", month: "2026-10", date: "2026-10-01", amount: -1500, categoryId: "rent" },
  { id: "t2", month: "2026-10", date: "2026-10-01", amount: -80, categoryId: "auto" },        // State Farm (due 1st), not Honda
  { id: "t3", month: "2026-10", date: "2026-10-03", amount: -120.5, categoryId: "groceries" },
  { id: "t4", month: "2026-10", date: "2026-10-04", amount: -60, splits: [{ categoryId: "groceries", amount: -40 }, { categoryId: "dining", amount: -20 }] },
  { id: "t5", month: "2026-10", date: "2026-10-06", amount: 1500, categoryId: "paycat" },
  { id: "t6", month: "2026-10", date: "2026-10-07", amount: -500, transfer: true },
  { id: "t7", month: "2026-10", date: "2026-10-08", amount: -33.33 },                        // no category yet
  { id: "t8", month: "2026-10", date: "2026-10-09", amount: -91.12, categoryId: "fuel" },
];
const billMarks = [{ id: "water_2026-10", recurringId: "water", month: "2026-10", kind: "manual", amount: 90, date: "2026-10-05" }];
const data = { recurring, categories, groups: [], budget, transactions, billMarks };

describe("money summary (claude/tools/money.mjs)", () => {
  const s = summarize(data, "2026-10-28");
  test("left to spend: groceries first, splits counted, transfers and income ignored", () => {
    expect(s.groceries).toMatchObject({ id: "groceries", budget: 525, spent: 160.5, left: 364.5 });
    expect(s.categories[0].id).toBe("groceries");
    expect(s.categories.find((c: { id: string }) => c.id === "dining")).toMatchObject({ spent: 20, left: 180 });
    expect(s.categories.map((c: { id: string }) => c.id)).not.toContain("rent"); // a bill's category isn't everyday spending
    expect(s.left.spent).toBe(1500 + 80 + 160.5 + 20 + 91.12);
  });
  test("the next payday adds both paychecks on the same Friday", () => {
    expect(s.payday).toEqual({ date: "2026-10-30", amount: 1900 });
  });
  test("bills: shared category goes to the nearest due day; a manual mark counts; late vs not in the bank copy yet", () => {
    const byId = Object.fromEntries(s.before_payday.bills.map((b: { id: string }) => [b.id, b]));
    expect(byId.rent).toBeUndefined();           // paid
    expect(byId.carA).toBeUndefined();           // the $80 on the 1st is State Farm's
    expect(byId.water).toBeUndefined();          // marked paid by hand
    expect(byId.phone).toMatchObject({ late: false, unseen: true }); // due the 12th, bank copy ends the 9th
    expect(byId.carB).toMatchObject({ unseen: true });
    expect(byId.net).toMatchObject({ date: "2026-10-28", late: false, unseen: false });
    expect(byId.reg).toBeUndefined();            // yearly, due in March
    expect(s.bank_through).toBe("2026-10-09");
    expect(s.due_today).toEqual([{ id: "net", name: "Internet", amount: 60 }]);
    expect(s.paid_this_month).toEqual({ count: 3, total: 1670 });
    expect(s.to_sort).toBe(1);
  });
  test("a bill due before the bank copy ends, with no payment, is flagged", () => {
    const s2 = summarize({ ...data, transactions: [...transactions, { id: "t9", month: "2026-10", date: "2026-10-20", amount: -5, categoryId: "fuel" }] }, "2026-10-28");
    const phone = s2.before_payday.bills.find((b: { id: string }) => b.id === "phone");
    expect(phone).toMatchObject({ late: true, unseen: false });
    expect(s2.overdue).toBe(2); // phone (12th) and Honda (20th)
  });
  test("helpers match Bird Budgeting", () => {
    expect(billDaysInMonth({ cadence: "biweekly", anchorDate: "2026-04-03" }, 2026, 9)).toEqual([2, 16, 30]);
    expect(billDaysInMonth({ dueDay: 31 }, 2026, 1)).toEqual([28]);
    expect(billDaysInMonth({ dueDay: 15, dueMonth: 3, cadence: "quarterly" }, 2026, 5)).toEqual([15]);
    expect(billDaysInMonth({ dueDay: 15, dueMonth: 3, cadence: "quarterly" }, 2026, 4)).toEqual([]);
    expect(txnLines({ transfer: true, amount: -5 })).toEqual([]);
    expect(nextPayday(recurring, new Date(2026, 9, 31))?.date.getDate()).toBe(13);
  });
  test("the summary is small and has no transactions or payees in it", () => {
    const text = JSON.stringify(s);
    expect(text.length).toBeLessThan(6000);
    expect(text).not.toMatch(/t1|t3|payee/);
  });
});

describe("money on the phone", () => {
  test("a bill due today becomes one money block, once; the grocery label reads the summary", async () => {
    const s = summarize(data, "2026-10-28") as MoneySummary;
    await saveMoney(s, "2026-10-28T12:00:00Z");
    expect(await placeBillBlocks("2026-10-28")).toBe(1);
    expect(await placeBillBlocks("2026-10-28")).toBe(0);
    const b = (await db.blocks.where("day").equals("2026-10-28").toArray()).find((x) => x.source_type === "bill")!;
    expect(b).toMatchObject({ kind: "money", title: "Pay Internet", source_id: "2026-10-28|net", start: "07:30" });
    const steps = await db.steps.where("block_id").equals(b.id).sortBy("n");
    expect(steps.map((x) => x.label)).toEqual(["Open ICCU", "Pay", "Mark paid in Budget"]);
    expect(steps[1].value).toBe("$60.00");
    expect(await placeBillBlocks("2026-10-29")).toBe(0); // the summary is from the 28th
    expect(await groceriesLeftLabel("2026-10-28")).toBe("$365 left");
    expect(await groceriesLeftLabel("2026-11-02")).toBeNull();
  });
});
