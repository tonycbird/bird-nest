// @ts-nocheck — plain JS modules on both sides
import { describe, expect, test } from "vitest";
import * as bird from "../claude/tools/money.mjs";
import {
  SKIP, budgetMonth, buildSetup, hintEnvelope, monthBills, monthIncome, payMonth, planOf, suggestPlan, usualSpend, isBankAdjustment, keywordEnvelope, learnMerchants, makeCtx, matchHistory, merchantKey, mixedFor, nestSummary, payPeriod, paydays,
  planFor, ruleFor, sortOf, storeKeyFor, summarize, tidyPayee, trends,
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
    categories: [{ id: "groceries", name: "Groceries", group: "food", order: 0, keywords: ["Walmart", "winco"] }, { id: "gas", name: "Household Gas", group: "housing", order: 3 }, { id: "chase", name: "Chase Card", group: "debtsave", target: 90, priority: "payoff" }, { id: "x", name: "Debt (split up)", group: "debtsave", archived: true }],
    groups: [{ id: "g1", name: "Salt and Light", isIncome: false }],
    budgets: [{ id: "2026-08", allocations: { groceries: 400 } }, { id: "2026-09", allocations: { groceries: 450 } }, { id: "2026-10", allocations: { groceries: 500, nope: 5 }, carryover: {} }],
    recurring: [
      { id: "a1", type: "expense", name: "Avista Utilities", amount: 34.33, dueDay: 2, cadence: "monthly", categoryId: "gas" },
      { id: "a2", type: "expense", name: "Avista Utilities", amount: 33.11, dueDay: 2, categoryId: "gas" },
      { id: "c1", type: "expense", name: "Chase Credit Card (...9690)", amount: 85, dueDay: 7, cadence: "monthly", categoryId: "chase" },
      { id: "c2", type: "expense", name: "Chase Prime Visa", amount: 172.65, dueDay: 7, cadence: "monthly", categoryId: "chase" },
      { id: "p", type: "income", name: "Pay", amount: 1500, cadence: "biweekly", anchorDate: "2026-04-03" },
    ],
    billMarks: [{ recurringId: "a2", month: "2026-10", kind: "linked", txnId: "av" }],
    labelRules: [{ key: "winco foods", categoryId: "groceries" }, { key: "anchored coffee", categoryId: "" }],
    transactions: [
      { payee: "Fred Meyer", categoryId: "groceries" }, { bankPayee: "Point Of Sale Withdrawal Fred Meyer", payee: "Fred Meyer", categoryId: "groceries" },
      { payee: "Venmo Tommy Greene", categoryId: "groceries" }, { payee: "WinCo Foods", categoryId: "gas" },
      { id: "av", date: "2026-10-03", amount: -31.91, payee: "Payment to Avista", categoryId: "gas" },
      { date: "2026-10-01", amount: -1500, payee: "Rent" },
      { date: "2026-09-02", amount: -20, payee: "Walmart", categoryId: "groceries" }, { date: "2026-09-09", amount: -30, payee: "Walmart", categoryId: "gas" },
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
    // Walmart (filed two ways) and Venmo are never learned; "Payment to Avista" is a store and is.
    expect(s.labels).toEqual([{ key: "winco foods", categoryId: "groceries" }, { key: "fred meyer", categoryId: "groceries" }, { key: "payment to avista", categoryId: "gas" }]);
  });
  test("history: date, cents, envelope and a short name only (never the bank's full text)", () => {
    expect(s.history).toContainEqual(["2026-10-01", -150000, "", "Rent"]);
    expect(JSON.stringify(s.history)).not.toMatch(/Point Of Sale/);
    expect(s.history.every((h) => h.length === 4 && h[3].length <= 28)).toBe(true);
  });
  test("keywords, target and priority come along; a linked paid mark becomes the payment it found", () => {
    expect(s.envelopes[0].keywords).toEqual(["walmart", "winco"]);
    expect(s.envelopes[2]).toMatchObject({ target: 90, priority: "payoff" });
    expect(s.marks).toEqual([{ billId: "a2", month: "2026-10", kind: "manual", amount: 31.91, date: "2026-10-03" }]);
  });
  test("a store filed more than one way is listed as mixed, with his picks", () => {
    expect(s.mixed).toEqual({ walmart: { groceries: 1, gas: 1 } });
  });
});

describe("sorting guards (no wrong envelopes)", () => {
  const env = [
    { key: "fees", name: "Overdraft Fees", group: "debtsave", order: 0, archived: false },
    { key: "electric", name: "Electric", group: "housing", order: 0, archived: false, keywords: ["avista"] },
    { key: "rent", name: "Mortgage / Rent", group: "housing", order: 1, archived: false, keywords: ["rent"] },
    { key: "fuel", name: "Fuel", group: "transport", order: 0, archived: false, keywords: ["shell"] },
    { key: "groceries", name: "Groceries", group: "food", order: 0, archived: false, keywords: ["walmart"] },
    { key: "petty", name: "Petty Cash", group: "income", order: 0, archived: false, keywords: ["venmo"] },
  ];
  const ctx = makeCtx({ envelopes: env, labels: [{ key: "avista", categoryId: "electric" }], mixed: { walmart: { groceries: 3, household: 12 } } });
  const t = (o) => ({ id: "x", account_id: "a", month: "2026-10", date: "2026-10-05", amount: -10, merchant: "", name: "", hint: "", ...o });
  test("a bank fee goes to the fee envelope, never to the store it names", () => {
    expect(isBankAdjustment("Overdraft Fee For 08/05 $34.95 Point Of Sale Withdrawal AVISTA")).toBe(true);
    expect(sortOf(t({ merchant: "Avista", name: "Overdraft Fee For 08/05 $34.95 Point Of Sale Withdrawal 2735 AVISTA" }), ctx)).toEqual({ cat: "fees", how: "rule" });
    expect(sortOf(t({ merchant: "Avista", hint: "BANK_FEES_INSUFFICIENT_FUNDS" }), ctx).cat).toBe("fees");
    expect(sortOf(t({ merchant: "Avista", name: "AVISTA UTILITIES" }), ctx).cat).toBe("electric");
  });
  test("keywords match whole words: 'rent' doesn't catch Current, 'shell' does catch SHELL OIL", () => {
    expect(keywordEnvelope(["Current Inc"], env)).toBe(null);
    expect(sortOf(t({ merchant: "SHELL OIL 57444" }), ctx).cat).toBe("fuel");
  });
  test("spending never sorts itself into an income envelope (Venmo stays to sort)", () => {
    expect(sortOf(t({ merchant: "Venmo", amount: -40 }), ctx).cat).toBe(null);
    expect(sortOf(t({ merchant: "Venmo", amount: 40 }), ctx).cat).toBe("petty");
  });
  test("a store he files more than one way is asked, even with a keyword", () => {
    expect(mixedFor({ merchant: "Walmart Supercenter", name: "" }, ctx.mixed)).toEqual({ groceries: 3, household: 12 });
    expect(sortOf(t({ merchant: "Walmart Supercenter" }), ctx)).toEqual({ cat: null, how: null });
  });
});

describe("Bird Budgeting's history onto the bank's copy", () => {
  const hist = [
    { date: "2026-10-02", cents: -167000, cat: "rent", name: "Rent" },
    { date: "2026-10-03", cents: -3191, cat: "gas", name: "Avista" },
    { date: "2026-10-04", cents: -1000, cat: "dining", name: "Coffee" },
    { date: "2026-10-04", cents: -1000, cat: "fuel", name: "Gas" },
    { date: "2026-10-06", cents: -2500, cat: "gifts", name: "Cash gift" },
  ];
  const bank = [
    { id: "b1", date: "2026-10-02", amount: -1670 }, { id: "b2", date: "2026-10-05", amount: -31.91 },
    { id: "b3", date: "2026-10-04", amount: -10 }, { id: "b4", date: "2026-10-04", amount: -10 },
    { id: "b5", date: "2026-10-05", amount: -77.7 }, { id: "p", date: "2026-10-03", amount: -31.91, pending: true },
  ];
  const m = matchHistory(hist, bank);
  test("same cents within 3 days, closest first; pending rows are never matched", () => {
    expect(m.pairs.map((p) => p.txn + ":" + p.cat)).toEqual(["b1:rent", "b2:gas", "b3:dining", "b4:fuel"]);
  });
  test("what doesn't line up is listed, both ways, over the dates both have", () => {
    expect(m.matched).toBe(4);
    expect(m.total).toBe(5);
    expect(m.onlyBird.map((e) => e.name)).toEqual(["Cash gift"]);
    expect(m.onlyBank.map((t) => t.id)).toEqual(["b5"]);
  });
});

describe("this paycheck", () => {
  const pay = [
    { id: "a", type: "income", name: "Anthony", amount: 1573.7, variesBy: 100, dueDay: 0, cadence: "biweekly", dueMonth: null, anchorDate: "2026-04-03", categoryId: "" },
    { id: "b", type: "income", name: "Abigail", amount: 402.82, dueDay: 0, cadence: "biweekly", dueMonth: null, anchorDate: "2026-04-03", categoryId: "" },
  ];
  const bills = [...pay,
    { id: "rent", type: "expense", name: "Mortgage / Rent", amount: 1670, dueDay: 2, cadence: "", dueMonth: null, anchorDate: "", categoryId: "rent" },
    { id: "net", type: "expense", name: "Internet", amount: 65, dueDay: 28, cadence: "", dueMonth: null, anchorDate: "", categoryId: "internet" },
    { id: "visa", type: "expense", name: "Visa Platinum", amount: 500, dueDay: 11, cadence: "", dueMonth: null, anchorDate: "", categoryId: "visa" },
    { id: "water", type: "expense", name: "Water", amount: 165.83, dueDay: 11, cadence: "", dueMonth: null, anchorDate: "", categoryId: "water" },
  ];
  test("paydays: both paychecks on the same Friday add up", () => {
    expect(paydays(bills, "2026-10-01", "2026-10-31")).toEqual([
      { date: "2026-10-02", amount: 1976.52, upside: 100 }, { date: "2026-10-16", amount: 1976.52, upside: 100 }, { date: "2026-10-30", amount: 1976.52, upside: 100 }]);
  });
  const sorted = [
    { id: "pay", date: "2026-10-16", amount: 1976.52, cat: "income", hint: "" },
    { id: "net", date: "2026-10-28", amount: -65, cat: "internet" },
    { id: "g", date: "2026-10-20", amount: -152.36, cat: "groceries" },
    { id: "u", date: "2026-10-22", amount: -20, cat: null },
    { id: "s", date: "2026-10-23", amount: -300, cat: SKIP },
  ];
  const p = payPeriod({ bills, income: new Set(["income"]), optional: new Set(["visa"]) }, "2026-10-27", sorted, (r) => r.id === "net");
  test("from payday to the day before the next: in, its bills, everything else spent, left per day", () => {
    expect(p.start).toBe("2026-10-16");
    expect(p.end).toBe("2026-10-29");
    expect(p.in).toBe(1976.52);
    expect(p.bills).toEqual([{ id: "net", name: "Internet", date: "2026-10-28", amount: 65, optional: false, paid: true }]);
    expect(p.spent).toBe(172.36); // groceries + the unsorted one; not the bill, not 'not spending'
    expect(p.left).toBe(1739.16);
    expect(p.daysLeft).toBe(3);
    expect(p.perDay).toBe(579.72);
  });
  test("the next paycheck against its own bills: rent shows short; an extra payoff isn't counted", () => {
    expect(p.next.start).toBe("2026-10-30");
    expect(p.next.bills.map((b) => b.name)).toEqual(["Mortgage / Rent", "Visa Platinum", "Water"]);
    expect(p.next.billsTotal).toBe(1835.83);
    expect(p.next.extra).toBe(500);
    expect(p.next.left).toBe(140.69);
  });
});

describe("compared with usual", () => {
  const env = [
    { key: "groceries", name: "Groceries", group: "food", order: 0, archived: false },
    { key: "dining", name: "Dining Out", group: "food", order: 1, archived: false },
    { key: "coffee", name: "Coffee Shops", group: "food", order: 2, archived: false },
    { key: "rent", name: "Rent", group: "housing", order: 0, archived: false },
  ];
  const row = (date, amount, cat) => ({ date, amount, cat });
  const sorted = [
    row("2026-07-05", -300, "groceries"), row("2026-08-05", -320, "groceries"), row("2026-09-05", -280, "groceries"), row("2026-10-05", -100, "groceries"),
    row("2026-07-05", -50, "dining"), row("2026-09-05", -900, "dining"), row("2026-10-03", -120, "dining"),
    row("2026-10-04", -12, "coffee"), row("2026-10-02", -1670, "rent"), row("2026-10-06", -40, SKIP), row("2026-10-07", 500, "groceries"),
  ];
  const t = trends(sorted, env, new Set(["rent"]), "2026-10-10");
  const by = Object.fromEntries(t.rows.map((r) => [r.id, r]));
  test("usual is the middle of the last 3 full months (an empty month counts as nothing)", () => {
    expect(t.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(by.groceries.usual).toBe(300);
    expect(by.dining.usual).toBe(50); // 50, 0, 900 → 50: one big month can't set the usual
  });
  test("by now = usual × the share of the month gone; ahead only when clearly past it", () => {
    expect(by.groceries).toMatchObject({ now: 100, byNow: 96.77, ahead: false });
    expect(by.dining).toMatchObject({ now: 120, byNow: 16.13, ahead: true });
    expect(by.coffee).toMatchObject({ usual: 0, now: 12, ahead: false }); // new this month, not "ahead"
  });
  test("bills, 'not spending' and money coming in are left out", () => {
    expect(by.rent).toBeUndefined();
    expect(t.total.now).toBe(232);
  });
});

describe("the month's budget (EveryDollar)", () => {
  const pay = [
    { id: "a", type: "income", name: "Anthony", amount: 1573.7, dueDay: 0, cadence: "biweekly", dueMonth: null, anchorDate: "2026-04-03", categoryId: "" },
    { id: "b", type: "income", name: "Abigail", amount: 402.82, dueDay: 0, cadence: "biweekly", dueMonth: null, anchorDate: "2026-04-03", categoryId: "" },
  ];
  const bills = [...pay,
    { id: "rent", type: "expense", name: "Mortgage / Rent", amount: 1670, dueDay: 2, cadence: "", dueMonth: null, anchorDate: "", categoryId: "rent" },
    { id: "net", type: "expense", name: "Internet", amount: 65, dueDay: 28, cadence: "", dueMonth: null, anchorDate: "", categoryId: "internet" },
    { id: "visa", type: "expense", name: "Visa Platinum", amount: 500, dueDay: 11, cadence: "", dueMonth: null, anchorDate: "", categoryId: "visa" },
  ];
  const env = [
    { key: "rent", name: "Mortgage / Rent", group: "housing", order: 0, archived: false },
    { key: "internet", name: "Internet", group: "housing", order: 1, archived: false },
    { key: "groceries", name: "Groceries", group: "food", order: 0, archived: false },
    { key: "dining", name: "Dining Out", group: "food", order: 1, archived: false },
    { key: "gifts", name: "Gifts", group: "fun", order: 0, archived: false },
    { key: "fees", name: "Overdraft Fees", group: "debtsave", order: 0, archived: false },
    { key: "visa", name: "Visa Platinum", group: "debtsave", order: 1, archived: false, priority: "payoff" },
    { key: "ef", name: "Emergency Fund", group: "debtsave", order: 2, archived: false },
    { key: "income", name: "Income", group: "income", order: 0, archived: false },
  ];
  const r = (date, amount, cat, hint = "") => ({ id: date + cat + amount, date, amount, cat, hint });
  const history = [
    ...["07", "08", "09"].flatMap((m, i) => [r(`2026-${m}-05`, -[800, 900, 850][i], "groceries"), r(`2026-${m}-09`, -[100, 300, 200][i], "dining"), r(`2026-${m}-12`, -35, "fees")]),
    r("2026-05-20", -240, "gifts"), r("2026-06-01", -10, "groceries"),
  ];
  const d = { envelopes: env, groups: [], bills, income: new Set(["income"]) };

  test("a paycheck counts for the month most of its two weeks fall in (Oct 30 pays November)", () => {
    expect(payMonth("2026-10-30")).toBe("2026-11");
    expect(payMonth("2026-10-16")).toBe("2026-10");
    expect(monthIncome(bills, "2026-11", [], new Set(["income"])).paychecks.map((p) => p.date)).toEqual(["2026-10-30", "2026-11-13"]);
    expect(monthIncome(bills, "2027-01", [], new Set(["income"])).paychecks.length).toBe(3); // Dec 25, Jan 8, Jan 22
  });
  test("money in: what landed near payday, else what's expected; anything else that came in is extra", () => {
    const sorted = [r("2026-10-16", 1580.5, "income"), r("2026-10-17", 402.82, null, "INCOME_WAGES"), r("2026-10-23", 300, "income"), r("2026-10-24", 50, SKIP)];
    const m = monthIncome(bills, "2026-10", sorted, new Set(["income"]), "2026-10-29");
    expect(m.paychecks).toEqual([
      { date: "2026-10-02", expected: 1976.52, landed: 0, amount: 1976.52 },
      { date: "2026-10-16", expected: 1976.52, landed: 1983.32, amount: 1983.32 },
    ]);
    expect(m.extra).toBe(300);
    expect(m.total).toBe(4259.84);
  });
  test("a reimbursement that lands on payday is extra, not part of the paycheck", () => {
    const envs = [{ key: "income", name: "Income", group: "income" }, { key: "petty", name: "Petty Cash & Reimbursements", group: "income" }];
    const sorted = [r("2026-10-02", 1500, "petty"), r("2026-10-02", 1573.7, "income"), r("2026-10-02", 402.82, "income")];
    const m = monthIncome(bills, "2026-10", sorted, new Set(["income", "petty"]), "2026-10-29", envs);
    expect(m.paychecks[0]).toMatchObject({ date: "2026-10-02", landed: 1976.52 });
    expect(m.extra).toBe(1500);
  });
  test("usual: the middle of the last 3 full months, or the year's monthly average if more (gifts)", () => {
    const u = usualSpend(history, "2026-10-29", new Set(["income"])).by;
    expect(u.groceries).toBe(850);
    expect(u.dining).toBe(200);
    expect(u.gifts).toBe(48); // $240 once, over the 5 months the bank has
  });
  test("suggested: bills as they are, everyday at usual (rounded up), no bank fees; over → wants trimmed up to a quarter", () => {
    const sg = suggestPlan(d, "2026-11", "2026-10-29", history);
    expect(sg.income).toBe(3953.04);
    expect(sg.amounts.rent).toBe(1670);
    expect(sg.amounts.internet).toBe(65);
    expect(sg.amounts.groceries).toBe(850);
    expect(sg.amounts.fees).toBe(0);
    expect(sg.why.fees).toBe("zero");
    expect(sg.why.visa).toBe("bill");
    expect(sg.to).toBe("ef"); // two paychecks cover it: the rest has a job
    expect(sg.amounts.ef).toBeGreaterThan(0);
    expect(sg.left).toBe(0);
    // a thin month: everything else squeezed
    const lean = suggestPlan({ ...d, bills: [pay[0], ...bills.slice(2)] }, "2026-11", "2026-10-29", history);
    expect(lean.why.visa).toBe("trim");
    expect(lean.amounts.visa).toBe(375); // a quarter off, no more
    expect(lean.amounts.dining).toBe(150);
    expect(lean.amounts.groceries).toBe(850); // needs aren't trimmed
    expect(lean.over).toBeGreaterThan(0); // and what's still over is shown, not hidden
    expect(lean.to).toBe(null);
    // only a little over: the trims are just enough, and rounding never turns into "extra"
    const near = suggestPlan({ ...d, envelopes: env.filter((e) => e.key !== "groceries") }, "2026-11", "2026-10-29", [...history, r("2026-09-20", -2000, "dining"), r("2026-08-20", -2000, "dining"), r("2026-07-20", -2000, "dining")]);
    const total = Math.round(Object.values(near.amounts).reduce((a, x) => a + x, 0) * 100) / 100;
    expect(near.why.dining).toBe("trim");
    expect(near.why.ef).toBeUndefined();
    expect(total).toBe(near.income);
  });
  test("this month: never less than what's already gone", () => {
    const sg = suggestPlan(d, "2026-10", "2026-10-20", [...history, r("2026-10-03", -61.5, "gifts"), r("2026-10-04", -500, "dining")]);
    expect(sg.amounts.gifts).toBe(65);
    expect(sg.why.gifts).toBe("spent");
    expect(sg.amounts.dining).toBe(500); // not trimmed below it either
  });
  test("a 3-paycheck month: the extra goes to the Emergency Fund, and the month adds up to $0", () => {
    const sg = suggestPlan(d, "2027-01", "2026-12-20", history);
    expect(sg.why.ef).toBe("extra");
    const total = Object.values(sg.amounts).reduce((a, x) => a + x, 0);
    expect(Math.round(total * 100) / 100).toBe(sg.income);
  });
  test("the month: plan, spent (refunds count back), left; bills with dates and ✓; left to budget", () => {
    const sorted = [r("2026-11-02", -1670, "rent"), r("2026-11-05", -120, "groceries"), r("2026-11-06", 20, "groceries"), r("2026-11-07", -9, null), r("2026-11-08", -40, SKIP)];
    const plan = { amounts: { rent: 1670, internet: 65, groceries: 850, dining: 150 }, carry: { dining: 25 } };
    const bm = budgetMonth(d, "2026-11", "2026-11-09", sorted, plan, (b) => b.id === "rent");
    const by = Object.fromEntries(bm.rows.map((x) => [x.key, x]));
    expect(by.groceries).toMatchObject({ planned: 850, spent: 100, left: 750 });
    expect(by.dining).toMatchObject({ planned: 150, avail: 175, left: 175 });
    expect(by.rent).toMatchObject({ paid: true, bills: [{ id: "rent", date: "2026-11-02", paid: true }] });
    expect(by.internet.paid).toBe(false);
    expect(bm.planned).toBe(2735);
    expect(bm.toBudget).toBe(1218.04);
    expect(bm.toSort).toBe(1);
    expect(bm.rows.map((x) => x.group)[0]).toBe("housing"); // EveryDollar order: home before food
    expect(bm.rows.some((x) => x.key === "income")).toBe(false);
  });
  test("the month's bills by date, paydays in between", () => {
    const list = monthBills(bills, "2026-11", (b) => b.id === "rent");
    expect(list.map((x) => `${x.date.slice(8)} ${x.kind} ${x.name}${x.paid ? " ✓" : ""}`)).toEqual([
      "02 bill Mortgage / Rent ✓", "11 bill Visa Platinum", "13 pay Paycheck", "27 pay Paycheck", "28 bill Internet"]);
  });
  test("a month he planned is his; a month he hasn't is the suggested one", () => {
    expect(planOf("2026-10", { ...d, plans: [{ month: "2026-10", amounts: { groceries: 500 } }] }, "2026-10-29", history)).toEqual({ amounts: { groceries: 500 }, carry: {}, own: true });
    const p = planOf("2026-11", { ...d, plans: [] }, "2026-10-29", history);
    expect(p.own).toBe(false);
    expect(p.amounts.rent).toBe(1670);
  });
});
