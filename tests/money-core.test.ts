// @ts-nocheck — plain JS modules on both sides
import { describe, expect, test } from "vitest";
import * as bird from "../claude/tools/money.mjs";
import {
  SKIP, buildSetup, hintEnvelope, learnMerchants, merchantKey, nestSummary, planFor, ruleFor, sortOf, storeKeyFor, summarize, tidyPayee,
} from "../src/lib/money-core.js";

/* Made-up household (no real numbers), the same shapes as Bird Budgeting and Plaid. */
const envelopes = [
  { key: "groceries", name: "Groceries", group: "food", order: 0, archived: false },
  { key: "dining", name: "Dining Out", group: "food", order: 1, archived: false },
  { key: "coffee", name: "Coffee Shops", group: "food", order: 2, archived: false },
  { key: "fuel", name: "Fuel", group: "transport", order: 0, archived: false },
  { key: "internet", name: "Internet", group: "housing", order: 0, archived: false },
  { key: "rent", name: "Mortgage / Rent", group: "housing", order: 0, archived: false },
  { key: "paycat", name: "Income", group: "income", order: 0, archived: false },
  { key: "old", name: "Old", group: "fun", order: 0, archived: true },
];
const bills = [
  { id: "net", type: "expense", name: "Internet", amount: 65, dueDay: 28, cadence: "", dueMonth: null, anchorDate: "", categoryId: "internet" },
  { id: "rent", type: "expense", name: "Rent", amount: 1670, dueDay: 2, cadence: "", dueMonth: null, anchorDate: "", categoryId: "rent" },
  { id: "pay", type: "income", name: "Payroll", amount: 1573.7, dueDay: 0, cadence: "biweekly", dueMonth: null, anchorDate: "2026-04-03", categoryId: "" },
];
const txn = (id, amount, date, o = {}) => ({ id, account_id: "chk", month: date.slice(0, 7), date, amount, merchant: "", name: "", hint: "", ...o });

describe("Bird Budgeting's rules, shared", () => {
  test("summarize is the same code as claude/tools/money.mjs (same answer on the same data)", () => {
    const data = {
      recurring: bills, categories: envelopes.map((e) => ({ id: e.key, name: e.name, group: e.group, archived: e.archived })), groups: [],
      budget: { month: "2026-10", allocations: { groceries: 500, dining: 250, internet: 65, rent: 1670 }, carryover: {} },
      transactions: [txn("a", -1670, "2026-10-02", { categoryId: "rent" }), txn("b", -152.36, "2026-10-04", { categoryId: "groceries" }), txn("c", -12, "2026-10-06")],
      billMarks: [],
    };
    const a = summarize(data, "2026-10-21"), b = bird.summarize(data, "2026-10-21");
    delete a.as_of; delete b.as_of;
    expect(a).toEqual(b);
  });
});

describe("store keys and rules (ported from Bird Budgeting's Smart Labels)", () => {
  test("merchant keys drop the bank's scaffolding", () => {
    expect(merchantKey("XX3360 Sq *Stoked Roasters + Chood River Orus")).toBe("stoked roasters chood");
    expect(merchantKey("Point Of Sale Withdrawal Fred Meyer #0123 Coeur D Aleneidus")).toBe("fred meyer coeur");
    expect(merchantKey("WinCo Foods")).toBe("winco foods");
    expect(merchantKey("")).toBe("");
    expect(tidyPayee("XX3360 Sq *Union Coeur D'Aleneidus")).toBe("Union Coeur D'Aleneidus");
  });
  test("the longest matching rule wins; a rule covers longer keys that start with it", () => {
    const labels = [{ key: "fred meyer", categoryId: "groceries" }, { key: "fred meyer fuel", categoryId: "fuel" }];
    expect(ruleFor("fred meyer coeur", labels).categoryId).toBe("groceries");
    expect(ruleFor("fred meyer fuel", labels).categoryId).toBe("fuel");
    expect(ruleFor("fred", labels)).toBe(null);
  });
  test("a store is learned only when 3 in 4 of its rows agree", () => {
    const rows = [
      { payee: "Walmart", categoryId: "groceries" }, { payee: "Walmart", categoryId: "groceries" }, { payee: "Walmart", categoryId: "groceries" }, { payee: "Walmart", categoryId: "household" },
      { payee: "Venmo Tommy", categoryId: "rent" }, { payee: "Venmo Tommy", categoryId: "dining" },
    ];
    expect(learnMerchants(rows, (t) => t.payee)).toEqual({ walmart: "groceries" });
  });
  test("Venmo, Zelle and transfers are one-offs: sorting one doesn't make a rule", () => {
    expect(storeKeyFor({ merchant: "Venmo", name: "VENMO PAYMENT TOMMY" })).toBe(null);
    expect(storeKeyFor({ merchant: "", name: "Zelle Amy Edwards" })).toBe(null);
    expect(storeKeyFor({ merchant: "WinCo Foods", name: "WINCO FOODS #12" })).toBe("winco foods");
  });
});

describe("sorting a purchase", () => {
  const ctx = { sorts: new Map([["mine", "dining"]]), labels: [{ key: "winco foods", categoryId: "groceries" }, { key: "venmo bird", categoryId: SKIP }], envelopes, keys: new Set(envelopes.filter((e) => !e.archived).map((e) => e.key)) };
  test("his own pick beats a rule, a rule beats Plaid's category", () => {
    expect(sortOf(txn("mine", -10, "2026-10-01", { merchant: "WinCo Foods" }), ctx)).toEqual({ cat: "dining", how: "you" });
    expect(sortOf(txn("w", -10, "2026-10-01", { merchant: "WinCo Foods", hint: "FOOD_AND_DRINK_RESTAURANT" }), ctx)).toEqual({ cat: "groceries", how: "rule" });
    expect(sortOf(txn("s", -10, "2026-10-01", { merchant: "Starbucks", hint: "FOOD_AND_DRINK_COFFEE" }), ctx)).toEqual({ cat: "coffee", how: "hint" });
    expect(sortOf(txn("x", -10, "2026-10-01", { merchant: "Some Shop", hint: "GENERAL_MERCHANDISE_SUPERSTORES" }), ctx)).toEqual({ cat: null, how: null });
  });
  test("the rule is tried on Plaid's merchant name, then its bank text", () => {
    expect(sortOf(txn("n", -10, "2026-10-01", { merchant: "", name: "POINT OF SALE WITHDRAWAL WINCO FOODS #12" }), ctx).cat).toBe("groceries");
  });
  test("Plaid's category only lands on an envelope that exists (by name)", () => {
    expect(hintEnvelope("TRANSPORTATION_GAS", envelopes)).toBe("fuel");
    expect(hintEnvelope("MEDICAL_DENTAL_CARE", envelopes)).toBe(null);
    expect(hintEnvelope("", envelopes)).toBe(null);
  });
});

describe("the month's plan", () => {
  const plans = [{ month: "2026-10", amounts: { groceries: 500, internet: 6.29, rent: 1700 } }];
  test("a month he planned is used as it is", () => {
    expect(planFor("2026-10", plans, bills)).toEqual({ amounts: { groceries: 500, internet: 6.29, rent: 1700 }, carry: {}, own: true });
  });
  test("a new month carries the last plan over, with bill envelopes at their bills", () => {
    const p = planFor("2026-11", plans, bills);
    expect(p.own).toBe(false);
    expect(p.amounts).toEqual({ groceries: 500, internet: 65, rent: 1670 });
  });
});

describe("the summary from Nest's own data", () => {
  const d = {
    envelopes, groups: [], bills, plans: [{ month: "2026-10", amounts: { groceries: 500, dining: 250, internet: 65, rent: 1670 } }],
    labels: [{ key: "winco foods", categoryId: "groceries" }], sorts: new Map([["moved", SKIP]]), accounts: new Set(["chk"]),
    txns: [
      txn("r", -1670, "2026-10-02", { merchant: "Landlord", hint: "RENT_AND_UTILITIES_RENT" }),
      txn("g", -152.36, "2026-10-27", { merchant: "WinCo Foods" }),
      txn("biz", -400, "2026-10-20", { account_id: "business", merchant: "WinCo Foods" }),
      txn("moved", -500, "2026-10-15", { merchant: "", name: "Transfer to savings" }),
      txn("mystery", -20, "2026-10-28", { merchant: "Some Shop" }),
      txn("p", 1573.7, "2026-10-16", { name: "PAYROLL", hint: "INCOME_WAGES" }),
    ],
  };
  const s = nestSummary(d, "2026-10-29");
  test("only the budget account counts; groceries left from the bank", () => {
    expect(s.source).toBe("nest");
    expect(s.groceries.spent).toBe(152.36);
    expect(s.groceries.left).toBe(347.64);
  });
  test("'not spending' is left out, and what's unsorted is counted", () => {
    expect(s.to_sort).toBe(1);
    expect(s.left.spent).toBe(1822.36);
  });
  test("a bill is paid when its envelope has the payment; the bank copy is up to date", () => {
    expect(s.paid_this_month.count).toBe(1);
    expect(s.bank_through).toBe("2026-10-28");
    expect(s.sorted).toEqual({ you: 1, rule: 1, hint: 2 });
  });
});

describe("the one-time move from Bird Budgeting", () => {
  const bb = {
    categories: [{ id: "groceries", name: "Groceries", group: "food", order: 0 }, { id: "gas", name: "Household Gas", group: "housing", order: 3 }, { id: "chase", name: "Chase Card", group: "debtsave" }, { id: "x", name: "Debt (split up)", group: "debtsave", archived: true }],
    groups: [{ id: "g1", name: "Salt and Light", isIncome: false }],
    budgets: [{ id: "2026-08", allocations: { groceries: 400 } }, { id: "2026-09", allocations: { groceries: 450 } }, { id: "2026-10", allocations: { groceries: 500, nope: 5 }, carryover: {} }],
    recurring: [
      { id: "a1", type: "expense", name: "Avista Utilities", amount: 34.33, dueDay: 2, cadence: "monthly", categoryId: "gas" },
      { id: "a2", type: "expense", name: "Avista Utilities", amount: 33.11, dueDay: 2, categoryId: "gas" },
      { id: "c1", type: "expense", name: "Chase Credit Card (...9690)", amount: 85, dueDay: 7, cadence: "monthly", categoryId: "chase" },
      { id: "c2", type: "expense", name: "Chase Prime Visa", amount: 172.65, dueDay: 7, cadence: "monthly", categoryId: "chase" },
      { id: "p", type: "income", name: "Pay", amount: 1500, cadence: "biweekly", anchorDate: "2026-04-03" },
    ],
    billMarks: [{ recurringId: "a2", month: "2026-10", kind: "manual" }],
    labelRules: [{ key: "winco foods", categoryId: "groceries" }, { key: "anchored coffee", categoryId: "" }],
    transactions: [
      { payee: "Fred Meyer", categoryId: "groceries" }, { bankPayee: "Point Of Sale Withdrawal Fred Meyer", payee: "Fred Meyer", categoryId: "groceries" },
      { payee: "Venmo Tommy Greene", categoryId: "groceries" }, { payee: "WinCo Foods", categoryId: "gas" },
    ],
  };
  const s = buildSetup(bb, "2026-10-29T00:00:00Z");
  test("envelopes, groups and the two latest plans (only known envelopes)", () => {
    expect(s.envelopes.map((e) => e.key)).toEqual(["groceries", "gas", "chase", "x"]);
    expect(s.envelopes[3].archived).toBe(true);
    expect(s.groups).toEqual([{ id: "g1", name: "Salt and Light", isIncome: false }]);
    expect(s.plans.map((p) => p.month)).toEqual(["2026-10", "2026-09"]);
    expect(s.plans[0].amounts).toEqual({ groceries: 500 });
  });
  test("twin bills merge: the one marked paid, else the monthly one, else the bigger one", () => {
    expect(s.bills.map((b) => b.id).sort()).toEqual(["a2", "c2", "p"]);
  });
  test("store rules: its saved labels with an envelope, then what the ledger agrees on (never Venmo)", () => {
    expect(s.labels).toEqual([{ key: "winco foods", categoryId: "groceries" }, { key: "fred meyer", categoryId: "groceries" }]);
  });
  test("no transactions are copied", () => {
    expect(JSON.stringify(s)).not.toMatch(/Tommy|Point Of Sale/);
  });
});
