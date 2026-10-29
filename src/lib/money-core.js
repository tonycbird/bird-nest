/* Money in Nest (Phase 7): the pure money rules, shared by the app and Claude's tools.
   The summary part (txnLines … summarize) is Bird Budgeting's own rules, copied unchanged from
   claude/tools/money.mjs (a test keeps the two identical). Below it: Nest's own pieces —
   merchant keys and label rules (ported from Bird Budgeting's Smart Labels), Plaid's category hints,
   sorting a purchase, the month's plan, and the one-time setup from Bird Budgeting. No DOM, no Node. */
const BILL_PERIOD = { quarterly: 3, semiannual: 6, yearly: 12 };
const BUILT_IN_INCOME = new Set(["income"]);
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isTransfer = (t) => !!(t && t.transfer);
export function txnLines(t) {
  if (isTransfer(t)) return [];
  if (t && Array.isArray(t.splits) && t.splits.length) return t.splits.map((sp) => ({ categoryId: sp.categoryId || "", amount: Number(sp.amount) || 0 }));
  return [{ categoryId: (t && t.categoryId) || "", amount: Number(t && t.amount) || 0 }];
}
export function needsCategory(t) {
  if (!t || isTransfer(t)) return false;
  if (Array.isArray(t.splits) && t.splits.length) return txnLines(t).some((l) => !l.categoryId);
  return !t.categoryId;
}

const isBiweekly = (r) => r && r.cadence === "biweekly" && /^\d{4}-\d{2}-\d{2}$/.test(String(r.anchorDate || ""));
function biweeklyDays(r, y, m) {
  if (!isBiweekly(r)) return [];
  const anchor = dateOf(r.anchorDate), first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const steps = Math.floor((first - anchor) / 864e5 / 14);
  let d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + steps * 14);
  while (d < first) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14);
  const out = [];
  while (d <= last) { out.push(d.getDate()); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14); }
  return out;
}
/** Which days of a month a bill (or a paycheck) lands on. */
export function billDaysInMonth(r, y, m) {
  if (!r) return [];
  if (isBiweekly(r)) return biweeklyDays(r, y, m);
  const d = Number(r.dueDay);
  if (!d) return [];
  const per = BILL_PERIOD[r.cadence];
  if (per) { const dm = Number(r.dueMonth) || 1; if (((m + 1 - dm) % per + per) % per !== 0) return []; }
  return [Math.min(d, new Date(y, m + 1, 0).getDate())];
}
export function nextDueDate(r, from) {
  const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let k = 0; k < 14; k++) {
    const probe = new Date(f.getFullYear(), f.getMonth() + k, 1);
    for (const day of billDaysInMonth(r, probe.getFullYear(), probe.getMonth())) {
      const d = new Date(probe.getFullYear(), probe.getMonth(), day);
      if (d >= f) return d;
    }
  }
  return null;
}
export function nextPayday(recurring, today) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let best = null;
  for (let k = 0; k < 3 && !best; k++) {
    const probe = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const map = {};
    for (const r of recurring.filter((x) => x.type === "income")) {
      const days = isBiweekly(r) ? biweeklyDays(r, probe.getFullYear(), probe.getMonth()) : Number(r.dueDay) ? [Number(r.dueDay)] : [];
      for (const d of days) (map[d] = map[d] || []).push(Number(r.amount) || 0);
    }
    for (const [day, amts] of Object.entries(map)) {
      const d = new Date(probe.getFullYear(), probe.getMonth(), Number(day));
      if (d < start) continue;
      if (!best || d < best.date) best = { date: d, amount: amts.reduce((a, b) => a + b, 0) };
    }
  }
  return best;
}
const dayGap = (a, b) => { const g = Math.abs(a - b); return Math.min(g, 31 - g); };

/** Paid / overdue / upcoming for each bill due this month (Bird Budgeting's billStatusesFor, with the bill's own amount as the estimate). */
export function billStatuses(bills, monthTxns, marks, monthStr, today) {
  const perCat = {};
  for (const t of monthTxns) for (const ln of txnLines(t)) {
    if (!(ln.amount < 0) || !ln.categoryId) continue;
    (perCat[ln.categoryId] = perCat[ln.categoryId] || []).push({ date: t.date, amount: -ln.amount });
  }
  const outflows = monthTxns.filter((t) => !isTransfer(t) && Number(t.amount) < 0);
  const byCat = {};
  bills.forEach((r, i) => { const k = r.categoryId || "__" + i; (byCat[k] = byCat[k] || []).push(i); });
  const claimed = {};
  for (const [cid, idxs] of Object.entries(byCat)) {
    claimed[cid] = (perCat[cid] || []).map((pay) => {
      if (idxs.length === 1) return idxs[0];
      const payDay = pay.date ? Number(String(pay.date).split("-")[2]) || 1 : 1;
      let best = idxs[0], score = Infinity;
      for (const i of idxs) {
        const s = dayGap(payDay, Number(bills[i].dueDay) || 1) * 1000 + Math.abs(pay.amount - (Number(bills[i].amount) || 0));
        if (s < score) { score = s; best = i; }
      }
      return best;
    });
  }
  const isCurrent = monthStr === isoOf(today).slice(0, 7);
  return bills.map((r, i) => {
    const mark = marks.find((m) => m.recurringId === r.id && m.month === monthStr);
    if (mark && mark.kind === "linked") {
      const txn = outflows.find((t) => t.id === mark.txnId);
      if (txn) return { r, status: "paid", amount: Math.abs(Number(txn.amount) || 0), day: Number(String(txn.date || "").split("-")[2]) || Number(r.dueDay) || 1 };
    }
    if (mark && mark.kind === "manual") return { r, status: "paid", amount: Number(mark.amount) || 0, day: Number(String(mark.date || "").split("-")[2]) || Number(r.dueDay) || 1 };
    const cid = r.categoryId || "__" + i;
    const mine = (perCat[cid] || []).filter((_, k) => claimed[cid][k] === i);
    const dueDay = Number(r.dueDay) || 1;
    if (mine.length) return { r, status: "paid", amount: mine.reduce((a, h) => a + h.amount, 0), day: dueDay };
    const status = isCurrent ? (dueDay < today.getDate() ? "overdue" : "upcoming") : monthStr < isoOf(today).slice(0, 7) ? "missed" : "upcoming";
    return { r, status, amount: Number(r.amount) || 0, day: dueDay };
  });
}

const shortName = (s) => String(s || "Bill").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);

/** The whole summary. `data` = {recurring, categories, groups, budget, transactions, billMarks}; ids on every doc. */
export function summarize(data, todayISO) {
  const today = dateOf(todayISO);
  const month = todayISO.slice(0, 7);
  const recurring = data.recurring || [], categories = (data.categories || []).filter((c) => !c.archived);
  const incomeGroups = new Set([...BUILT_IN_INCOME, ...(data.groups || []).filter((g) => g.isIncome).map((g) => g.id)]);
  const budget = data.budget || {};
  const txns = (data.transactions || []).filter((t) => t.month === month || String(t.date || "").startsWith(month));
  const alloc = budget.allocations || {}, carry = budget.carryover || {};

  // Left to spend, per expense category
  const spent = {};
  for (const t of txns) for (const ln of txnLines(t)) if (ln.amount < 0 && ln.categoryId) spent[ln.categoryId] = (spent[ln.categoryId] || 0) + -ln.amount;
  const expenseCats = categories.filter((c) => !incomeGroups.has(c.group));
  const billCats = new Set(recurring.filter((r) => r.type === "expense" && r.categoryId).map((r) => r.categoryId));
  const rows = expenseCats.map((c) => {
    const avail = (Number(alloc[c.id]) || 0) + (Number(carry[c.id]) || 0);
    return { id: c.id, name: c.name, budget: money(avail), spent: money(spent[c.id] || 0), left: money(avail - (spent[c.id] || 0)) };
  });
  const isGroceries = (r) => r.id === "groceries" || /grocer/i.test(r.name);
  const everyday = rows.filter((r) => r.budget > 0 && !billCats.has(r.id));
  const key = [...everyday.filter(isGroceries), ...everyday.filter((r) => !isGroceries(r)).sort((a, b) => b.budget - a.budget)].slice(0, 6);
  const totalAvail = rows.reduce((a, r) => a + r.budget, 0), totalSpent = rows.reduce((a, r) => a + r.spent, 0);

  // Bills
  const expense = recurring.filter((r) => r.type === "expense");
  const dueThisMonth = expense.filter((r) => billDaysInMonth(r, today.getFullYear(), today.getMonth()).length);
  const statuses = billStatuses(dueThisMonth, txns, (data.billMarks || []).filter((m) => m.month === month), month, today);
  const pay = nextPayday(recurring, today);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // The bank copy only goes up to its newest transaction. A bill due after that isn't late, it just isn't in yet.
  const bankThrough = (data.transactions || []).map((t) => String(t.date || "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() || null;
  const before = [];
  for (const s of statuses) if (s.status === "overdue") {
    const date = isoOf(new Date(today.getFullYear(), today.getMonth(), s.day));
    before.push({ id: s.r.id, name: shortName(s.r.name), date, amount: money(s.amount), late: !!bankThrough && date <= bankThrough, unseen: !bankThrough || date > bankThrough });
  }
  for (const r of expense) {
    const d = nextDueDate(r, start);
    if (!d || !pay || d >= pay.date) continue;
    const s = statuses.find((x) => x.r.id === r.id && x.day === d.getDate());
    if (s && s.status === "paid") continue;
    if (before.some((b) => b.id === r.id && (b.late || b.unseen))) continue;
    before.push({ id: r.id, name: shortName(r.name), date: isoOf(d), amount: money(s ? s.amount : r.amount), late: false, unseen: false });
  }
  before.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const paid = statuses.filter((s) => s.status === "paid");

  return {
    v: 1,
    as_of: new Date().toISOString(),
    month,
    today: todayISO,
    left: { total: money(totalAvail - totalSpent), budget: money(totalAvail), spent: money(totalSpent) },
    categories: key,
    groceries: key.find(isGroceries) ?? null,
    payday: pay ? { date: isoOf(pay.date), amount: money(pay.amount) } : null,
    before_payday: { total: money(before.reduce((a, b) => a + b.amount, 0)), bills: before.slice(0, 12) },
    bank_through: bankThrough,
    overdue: before.filter((b) => b.late).length,
    unseen: before.filter((b) => b.unseen).length,
    due_today: before.filter((b) => b.date === todayISO && !b.late && !b.unseen).map((b) => ({ id: b.id, name: b.name, amount: b.amount })),
    paid_this_month: { count: paid.length, total: money(paid.reduce((a, s) => a + s.amount, 0)) },
    to_sort: txns.filter(needsCategory).length,
  };
}


/* ---------- merchant keys and label rules (Bird Budgeting's Smart Labels, ported as-is) ---------- */

const LABEL_PREFIX_NOISE = /^(point of sale (withdrawal|purchase|debit)|pos (purchase|withdrawal|debit)|debit card (purchase|withdrawal)|recurring (debit|payment)|purchase( authorized)?( on \d{1,2}\/\d{1,2})?|ach (debit|credit|withdrawal|deposit)|external (withdrawal|deposit)|electronic (withdrawal|deposit)|withdrawal|deposit)\s*[-:]?\s*/i;
const STATE_US = /^(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)us$/;

/** Bank text minus processor scaffolding (terminal ids, phone numbers, store numbers, "…IDUS"). "" when nothing changed. */
export function tidyPayee(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  const before = t;
  t = t.replace(/^XX\d+\s+/i, "");
  t = t.replace(/^(SQ|TST|MED|DD)\s*\*\s*/i, "");
  t = t.replace(/\s*\*\s*/g, " ");
  t = t.replace(/\b\d{3}-\d{3}-\d{4}\b/g, "");
  t = t.replace(/\b[A-Z0-9]{9,}\b/g, "");
  t = t.replace(/\b(ID|WA|CA|MO|IL|ON|NY)US\b/g, "");
  t = t.replace(/\b(CA|ON)CA\b/g, "");
  t = t.replace(/#\d+\b/g, "");
  t = t.replace(/\s{2,}/g, " ").replace(/[\s,-]+$/, "").trim();
  if (t.length < 3 || /^[^A-Za-z]*$/.test(t)) return "";
  return t === before ? "" : t;
}

/** The forgiving key for a store: "XX3360 Sq *Stoked Roasters + Chood River Orus" → "stoked roasters chood". */
export function merchantKey(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(LABEL_PREFIX_NOISE, "");
  let t = tidyPayee(s) || s;
  t = t.toLowerCase().replace(/[^a-z&' ]+/g, " ")
    .replace(/\b(xx|sq|tst|ctlp|inc|llc|co|com|www|the|des|id|indn|web|ppd|ccd)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return t.split(" ").filter((w) => w.length > 1 && !STATE_US.test(w)).slice(0, 3).join(" ");
}
export const labelSlug = (key) => String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

/** The longest rule whose key is this key or a leading part of it ("fred meyer" covers "fred meyer coeur"). */
export function ruleFor(key, labels) {
  if (!key) return null;
  let best = null;
  for (const r of labels || []) {
    if (!r || !r.key) continue;
    if (key === r.key || key.startsWith(r.key + " ")) if (!best || r.key.length > best.key.length) best = r;
  }
  return best;
}

/** Store → envelope from a ledger, only where 3 in 4 of that store's rows agree (Venmo is never guessed). */
export function learnMerchants(list, textOf) {
  const counts = {};
  for (const t of list || []) {
    if (!t || !t.categoryId || isTransfer(t) || (Array.isArray(t.splits) && t.splits.length)) continue;
    const k = merchantKey(textOf(t));
    if (!k) continue;
    (counts[k] = counts[k] || {})[t.categoryId] = (counts[k][t.categoryId] || 0) + 1;
  }
  const mem = {};
  for (const [k, c] of Object.entries(counts)) {
    let total = 0, best = null, bestN = 0;
    for (const [cid, n] of Object.entries(c)) { total += n; if (n > bestN) { bestN = n; best = cid; } }
    if (best && bestN / total >= 0.75) mem[k] = best;
  }
  return mem;
}

/* ---------- sorting a purchase ---------- */

/** "Not spending": money moved between his own accounts, a refund he's tracking elsewhere… */
export const SKIP = "_skip";

/** Plaid's own category, when it's clear enough to sort by itself, → the envelope with a matching name. */
const HINTS = [
  [/^FOOD_AND_DRINK_GROCERIES$/, /grocer/i],
  [/^FOOD_AND_DRINK_COFFEE$/, /coffee/i],
  [/^FOOD_AND_DRINK_(RESTAURANT|FAST_FOOD)$/, /dining|restaurant|eating out/i],
  [/^TRANSPORTATION_GAS$/, /^fuel$|^gas$|gasoline/i],
  [/^RENT_AND_UTILITIES_INTERNET_AND_CABLE$/, /internet/i],
  [/^RENT_AND_UTILITIES_TELEPHONE$/, /phone/i],
  [/^RENT_AND_UTILITIES_(WATER|SEWAGE_AND_WASTE_MANAGEMENT)$/, /water|sewer/i],
  [/^(RENT_AND_UTILITIES_RENT|LOAN_PAYMENTS_MORTGAGE_PAYMENT)$/, /mortgage|rent/i],
  [/^LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT$/, /student loan/i],
  [/^GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES$/, /clothing/i],
  [/^HOME_IMPROVEMENT_/, /household/i],
  [/^MEDICAL_/, /medical|dental/i],
  [/^ENTERTAINMENT_/, /entertainment/i],
  [/^GOVERNMENT_AND_NON_PROFIT_DONATIONS$/, /charit|giving/i],
  [/^BANK_FEES_OVERDRAFT_FEES$/, /overdraft|bank fee/i],
  [/^PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS$/, /^gym/i],
  [/^INCOME_/, /^income$/i],
];
export function hintEnvelope(hint, envelopes) {
  if (!hint) return null;
  for (const [h, name] of HINTS) {
    if (!h.test(hint)) continue;
    const e = (envelopes || []).find((x) => !x.archived && name.test(x.name));
    return e ? e.key : null;
  }
  return null;
}

/** Keys that name a person or a money move, not a store: sorting one of these sorts only that purchase. */
const ONE_OFF = /^(venmo|zelle|paypal|cash app|transfer|online transfer|check|atm|mobile deposit|deposit|withdrawal|payment)\b/;
export function storeKeyFor(t) {
  const k = merchantKey(t.merchant) || merchantKey(t.name);
  return k && !ONE_OFF.test(k) ? k : null;
}

/** How a purchase is sorted: his own pick → a store rule → Plaid's category → not yet. */
export function sortOf(t, ctx) {
  const own = ctx.sorts.get(t.id);
  if (own) return { cat: own, how: "you" };
  for (const text of [t.merchant, t.name]) {
    const r = ruleFor(merchantKey(text), ctx.labels);
    if (r && r.categoryId && (r.categoryId === SKIP || ctx.keys.has(r.categoryId))) return { cat: r.categoryId, how: "rule" };
  }
  const h = hintEnvelope(t.hint, ctx.envelopes);
  if (h) return { cat: h, how: "hint" };
  return { cat: null, how: null };
}

/* ---------- the month's plan ---------- */

/** What each envelope gets this month: the plan he set, else last month's carried over, with bill
    envelopes at the total of their bills due that month. */
export function planFor(month, plans, bills) {
  const own = (plans || []).find((p) => p.month === month);
  if (own) return { amounts: { ...(own.amounts || {}) }, carry: { ...(own.carry || {}) }, own: true };
  const prev = (plans || []).filter((p) => p.month < month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  const amounts = { ...(prev?.amounts || {}) };
  const [y, m] = month.split("-").map(Number);
  const byCat = {};
  for (const b of bills || []) {
    if (b.type !== "expense" || !b.categoryId) continue;
    const n = billDaysInMonth(b, y, m - 1).length;
    if (n) byCat[b.categoryId] = (byCat[b.categoryId] || 0) + n * (Number(b.amount) || 0);
  }
  for (const [c, v] of Object.entries(byCat)) amounts[c] = money(v);
  return { amounts, carry: {}, own: false };
}

/* ---------- the summary, from Nest's own data ---------- */

/** Bird Budgeting's summary, worked out from Nest: the budget accounts' purchases, sorted as above. */
export function nestSummary(d, todayISO) {
  const envelopes = d.envelopes || [];
  const ctx = { sorts: d.sorts || new Map(), labels: d.labels || [], envelopes, keys: new Set(envelopes.filter((e) => !e.archived).map((e) => e.key)) };
  const month = todayISO.slice(0, 7);
  const how = { you: 0, rule: 0, hint: 0 };
  const txns = (d.txns || []).filter((t) => d.accounts.has(t.account_id)).map((t) => {
    const s = sortOf(t, ctx);
    if (s.how && t.month === month) how[s.how]++;
    return { id: t.id, month: t.month, date: t.date, amount: t.amount, categoryId: s.cat && s.cat !== SKIP ? s.cat : "", transfer: s.cat === SKIP };
  });
  const plan = planFor(month, d.plans, d.bills);
  const s = summarize({
    recurring: d.bills || [],
    categories: envelopes.map((e) => ({ id: e.key, name: e.name, group: e.group, archived: e.archived })),
    groups: d.groups || [],
    budget: { month, allocations: plan.amounts, carryover: plan.carry },
    transactions: txns,
    billMarks: d.marks || [],
  }, todayISO);
  return { ...s, source: "nest", sorted: how, plan_own: plan.own };
}

/* ---------- the one-time move from Bird Budgeting ---------- */

/** Bird Budgeting → Nest: envelopes, groups, the latest plans, bills (duplicates merged) and store rules
    (its saved labels, plus what its ledger agrees on three times in four). Only setup: no transactions. */
export function buildSetup(bb, made = new Date().toISOString()) {
  const textOf = (t) => {
    if (t.bankPayee) return String(t.bankPayee);
    const m = String(t.notes || "").match(/^Bank description:\s*([\s\S]+)$/);
    return m ? m[1].trim() : String(t.payee || "");
  };
  const envelopes = (bb.categories || []).map((c) => ({ key: c.id, name: String(c.name || "").slice(0, 60), group: c.group || "", order: Number(c.order) || 0, archived: !!c.archived }));
  const keys = new Set(envelopes.map((e) => e.key));
  const groups = (bb.groups || []).map((g) => ({ id: g.id, name: String(g.name || "").slice(0, 60), isIncome: !!g.isIncome }));
  const plans = (bb.budgets || []).filter((b) => /^\d{4}-\d{2}$/.test(b.id || b.month || "")).sort((a, b) => ((a.id || a.month) < (b.id || b.month) ? 1 : -1)).slice(0, 2)
    .map((b) => ({ month: b.id || b.month, amounts: Object.fromEntries(Object.entries(b.allocations || {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, money(v)])), carry: b.carryover || {} }));
  // Bills: Bird Budgeting has a few twins (same envelope, same day, same first word). Keep the one marked paid, else the monthly one, else the bigger one.
  const marked = new Set((bb.billMarks || []).map((m) => m.recurringId));
  const first = (s) => String(s || "").toLowerCase().split(/\W+/).find(Boolean) || "";
  const seen = new Map();
  const score = (r) => (marked.has(r.id) ? 2 : 0) + (r.cadence === "monthly" ? 1 : 0);
  for (const r of bb.recurring || []) {
    const twin = r.type === "expense" ? `${r.categoryId}|${r.dueDay}|${first(r.name)}` : r.id;
    const had = seen.get(twin);
    if (!had || score(r) > score(had) || (score(r) === score(had) && (Number(r.amount) || 0) > (Number(had.amount) || 0))) seen.set(twin, r);
  }
  const bills = [...seen.values()].map((r) => ({ id: r.id, type: r.type === "income" ? "income" : "expense", name: String(r.name || "").slice(0, 80), amount: money(r.amount),
    dueDay: Number(r.dueDay) || 0, cadence: r.cadence || "", dueMonth: r.dueMonth ?? null, anchorDate: r.anchorDate || "", categoryId: keys.has(r.categoryId) ? r.categoryId : "" }));
  const labels = [];
  const have = new Set();
  for (const r of bb.labelRules || []) {
    if (!r.key || !r.categoryId || !keys.has(r.categoryId) || have.has(r.key)) continue;
    labels.push({ key: String(r.key).slice(0, 60), categoryId: r.categoryId });
    have.add(r.key);
  }
  for (const [k, cid] of Object.entries(learnMerchants(bb.transactions || [], textOf))) {
    if (have.has(k) || !keys.has(cid) || ONE_OFF.test(k)) continue;
    labels.push({ key: k.slice(0, 60), categoryId: cid });
    have.add(k);
  }
  return { v: 1, from: "bird-budgeting", made, envelopes, groups, plans, bills, labels };
}
