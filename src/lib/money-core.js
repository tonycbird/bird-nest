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
  [/^BANK_FEES_/, /overdraft|bank fee|service fee/i],
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
const ONE_OFF = /^(venmo|zelle|paypal|cash app|transfer|online transfer|check|atm|mobile deposit|deposit|withdrawal)\b/;
export function storeKeyFor(t) {
  const k = merchantKey(t.merchant) || merchantKey(t.name);
  return k && !ONE_OFF.test(k) ? k : null;
}

/* Bird Budgeting's hardest-won rule (Version 43): a bank fee names the purchase that caused it
   ("Overdraft Fee For 08/05 $34.95 … AVISTA …") and must never be filed under that store. It's checked on
   the bank's own text before any store rule, because Plaid may well call the merchant "Avista". */
const BANK_ADJUSTMENT_RE = /^\s*(overdraft\s*fee|nsf\b|insufficient\s*funds|returned\s*item|monthly\s*service\s*(fee|charge)|service\s*charge|international\s*transaction\s*fee|foreign\s*transaction\s*fee|xx\d+\s+dp\s+service\s*fee|for\s+\d{1,2}\/\d{1,2}\s+\$)/i;
export const isBankAdjustment = (text) => BANK_ADJUSTMENT_RE.test(String(text || ""));
/** The envelope bank charges go in, found by name; null rather than a guess. */
export function feeEnvelope(envelopes) {
  const e = (envelopes || []).find((x) => !x.archived && /overdraft|bank fee|service fee/i.test(x.name));
  return e ? e.key : null;
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Bird Budgeting's envelope keywords ("walmart", "shell", "t-mobile"…), matched as whole words so
    "rent" never catches "Current". `skip` = envelopes not to use (income ones, for spending). */
export function keywordEnvelope(texts, envelopes, skip) {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  for (const e of envelopes || []) {
    if (e.archived || !Array.isArray(e.keywords) || !e.keywords.length || (skip && skip.has(e.key))) continue;
    for (const k of e.keywords) {
      const w = String(k || "").trim().toLowerCase();
      if (w.length < 3) continue;
      if (new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`).test(hay)) return e.key;
    }
  }
  return null;
}

/** The envelopes in an income group (Income, Petty Cash & Reimbursements…). */
export function incomeKeys(envelopes, groups) {
  const inc = new Set(["income", ...(groups || []).filter((g) => g.isIncome).map((g) => g.id)]);
  return new Set((envelopes || []).filter((e) => inc.has(e.group)).map((e) => e.key));
}
export function makeCtx(d) {
  const envelopes = d.envelopes || [];
  return { sorts: d.sorts || new Map(), labels: d.labels || [], envelopes, keys: new Set(envelopes.filter((e) => !e.archived).map((e) => e.key)), income: incomeKeys(envelopes, d.groups), mixed: d.mixed || {} };
}
/** A store he files more than one way (Walmart: groceries, household, personal…): never guessed. Returns
    his past picks for it ({envelope: times}), or null. Matches like a rule: "walmart" covers "walmart supercenter". */
export function mixedFor(t, mixed) {
  if (!mixed) return null;
  for (const text of [t.merchant, t.name]) {
    const k = merchantKey(text);
    if (!k) continue;
    for (const m of Object.keys(mixed)) if (k === m || k.startsWith(m + " ")) return mixed[m];
  }
  return null;
}

/** How a purchase is sorted: his own pick → the bank-fee guard → a store rule → (a store he files more
    than one way stops here and asks) → an envelope keyword → Plaid's category → not yet. Nothing but his
    own pick puts spending in an income envelope (where it would quietly stop counting). */
export function sortOf(t, ctx) {
  const own = ctx.sorts.get(t.id);
  if (own) return { cat: own, how: "you" };
  const spending = Number(t.amount) < 0;
  const ok = (cat) => !!cat && (cat === SKIP || (ctx.keys.has(cat) && !(spending && ctx.income && ctx.income.has(cat))));
  if (isBankAdjustment(t.name) || isBankAdjustment(t.merchant) || /^BANK_FEES_/.test(t.hint || "")) {
    const f = feeEnvelope(ctx.envelopes);
    return f ? { cat: f, how: "rule" } : { cat: null, how: null };
  }
  for (const text of [t.merchant, t.name]) {
    const r = ruleFor(merchantKey(text), ctx.labels);
    if (r && ok(r.categoryId)) return { cat: r.categoryId, how: "rule" };
  }
  if (mixedFor(t, ctx.mixed)) return { cat: null, how: null };
  const k = keywordEnvelope([t.merchant, t.name], ctx.envelopes, spending ? ctx.income : null);
  if (ok(k)) return { cat: k, how: "rule" };
  const h = hintEnvelope(t.hint, ctx.envelopes);
  if (ok(h)) return { cat: h, how: "hint" };
  return { cat: null, how: null };
}

/* ---------- Bird Budgeting's sorting, carried onto the bank's copy ---------- */

const dayNo = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
/** Each Bird Budgeting row finds its bank twin: the same amount to the cent, within 3 days, closest first
    (payee text is useless here: "Costco" vs "COSTCO WHSE #0773"). `entries` = [{date, cents, cat, name}]. */
export function matchHistory(entries, bankTxns) {
  const posted = (bankTxns || []).filter((t) => !t.pending && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)));
  const pool = new Map();
  for (const t of posted) { const c = Math.round(Number(t.amount) * 100); if (!pool.has(c)) pool.set(c, []); pool.get(c).push(t); }
  const list = [...(entries || [])].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(String(e.date))).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bankFrom = posted.map((t) => t.date).sort()[0] || null;
  const birdFrom = list[0]?.date || null, to = list[list.length - 1]?.date || null;
  const from = bankFrom && birdFrom ? (bankFrom > birdFrom ? bankFrom : birdFrom) : null;
  const used = new Set(), pairs = [], onlyBird = [];
  for (const e of list) {
    let best = null, gap = 99;
    for (const t of pool.get(e.cents) || []) {
      if (used.has(t.id)) continue;
      const g = Math.abs(dayNo(t.date) - dayNo(e.date));
      if (g <= 3 && (g < gap || (g === gap && t.id < best.id))) { best = t; gap = g; }
    }
    if (best) { used.add(best.id); pairs.push({ txn: best.id, cat: e.cat || "", date: e.date }); }
    else if (from && e.date >= from) onlyBird.push(e);
  }
  const inWindow = (d) => !!from && d >= from && d <= to;
  return {
    pairs, onlyBird, from, to,
    total: list.filter((e) => inWindow(e.date)).length,
    matched: pairs.filter((p) => inWindow(p.date)).length,
    onlyBank: posted.filter((t) => !used.has(t.id) && inWindow(t.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

/* ---------- this paycheck (Bird Budgeting's Plan page, in one card) ---------- */

const addDays = (iso, n) => { const d = dateOf(iso); return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
/** Paydays between two dates: [{date, amount, upside}] (both paychecks on one day add up). */
export function paydays(bills, fromISO, toISO) {
  const by = new Map();
  const f = dateOf(fromISO), t = dateOf(toISO);
  for (let d = new Date(f.getFullYear(), f.getMonth(), 1); d <= t; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    for (const r of (bills || []).filter((b) => b.type === "income")) {
      for (const day of billDaysInMonth(r, d.getFullYear(), d.getMonth())) {
        const iso = isoOf(new Date(d.getFullYear(), d.getMonth(), day));
        if (iso < fromISO || iso > toISO) continue;
        const x = by.get(iso) || { date: iso, amount: 0, upside: 0 };
        x.amount = money(x.amount + (Number(r.amount) || 0)); x.upside = money(x.upside + (Number(r.variesBy) || 0));
        by.set(iso, x);
      }
    }
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
function billsBetween(bills, fromISO, toISO) {
  const out = [];
  const f = dateOf(fromISO), t = dateOf(toISO);
  for (let d = new Date(f.getFullYear(), f.getMonth(), 1); d <= t; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    for (const r of (bills || []).filter((b) => b.type === "expense")) {
      for (const day of billDaysInMonth(r, d.getFullYear(), d.getMonth())) {
        const iso = isoOf(new Date(d.getFullYear(), d.getMonth(), day));
        if (iso >= fromISO && iso <= toISO) out.push({ r, date: iso });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** From the last payday to the day before the next: what came in, the bills due in that stretch, what's
    been spent on everything else, and what's left (and per day). Plus the next paycheck against its own
    bills, which is where "rent needs money held back" shows. `sorted` = budget-account purchases with
    their envelope (`cat`); `statusOf(bill, date)` says whether a bill was paid. */
export function payPeriod(d, todayISO, sorted, statusOf) {
  const days = paydays(d.bills, addDays(todayISO, -45), addDays(todayISO, 75));
  let i = -1;
  for (let k = 0; k < days.length; k++) if (days[k].date <= todayISO) i = k;
  if (i < 0 || !days[i + 1] || !days[i + 2]) return null;
  const start = days[i], next = days[i + 1], after = days[i + 2];
  const end = addDays(next.date, -1);
  const billCats = new Set((d.bills || []).filter((b) => b.type === "expense" && b.categoryId).map((b) => b.categoryId));
  const income = d.income || new Set();
  const landed = money((sorted || []).filter((t) => t.amount > 0 && t.date >= addDays(start.date, -1) && t.date <= addDays(start.date, 2) && (income.has(t.cat) || /^INCOME_/.test(t.hint || ""))).reduce((a, t) => a + t.amount, 0));
  // An extra payoff (Visa Platinum is "payoff" in Bird Budgeting's ladder) is a choice, not a bill: listed, not counted.
  const optional = d.optional || new Set();
  const line = ({ r, date }) => ({ id: r.id, name: String(r.name || "").replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 32), date, amount: money(r.amount), optional: optional.has(r.categoryId) });
  const bills = billsBetween(d.bills, start.date, end).map((x) => ({ ...line(x), paid: !!statusOf?.(x.r, x.date) }));
  // Everything else spent since payday (bills are counted above; unsorted counts, to be safe).
  const spent = money((sorted || []).filter((t) => t.amount < 0 && t.date >= start.date && t.date <= todayISO && t.cat !== SKIP && !billCats.has(t.cat) && !(income.has(t.cat))).reduce((a, t) => a - t.amount, 0));
  const inAmt = landed > 0 ? landed : start.amount;
  const billsTotal = money(bills.filter((b) => !b.optional).reduce((a, b) => a + b.amount, 0));
  const extra = money(bills.filter((b) => b.optional).reduce((a, b) => a + b.amount, 0));
  const left = money(inAmt - billsTotal - spent);
  const daysLeft = Math.max(1, dayNo(end) - dayNo(todayISO) + 1);
  const nb = billsBetween(d.bills, next.date, addDays(after.date, -1)).map(line);
  const nbTotal = money(nb.filter((b) => !b.optional).reduce((a, b) => a + b.amount, 0));
  const nbExtra = money(nb.filter((b) => b.optional).reduce((a, b) => a + b.amount, 0));
  return {
    start: start.date, end, in: inAmt, expected: start.amount, landed, upside: start.upside,
    bills, billsTotal, extra, spent, left, daysLeft, perDay: money(left / daysLeft),
    next: { start: next.date, end: addDays(after.date, -1), in: next.amount, upside: next.upside, bills: nb, billsTotal: nbTotal, extra: nbExtra, left: money(next.amount - nbTotal) },
  };
}

/* ---------- trends: this month against his usual ---------- */

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };
const monthAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
/** Each everyday envelope this month against its usual: the median of the last three full months (a month
    with nothing counts as nothing, so one big month can't set the usual; Bird Budgeting's rule). "By now"
    is the usual scaled to the day of the month; `ahead` only when clearly past that (15% and $10). */
export function trends(sorted, envelopes, skipCats, todayISO) {
  const month = todayISO.slice(0, 7);
  const prev = [monthAdd(month, -3), monthAdd(month, -2), monthAdd(month, -1)];
  const [y, m] = month.split("-").map(Number);
  const frac = Number(todayISO.slice(8, 10)) / new Date(y, m, 0).getDate();
  const by = new Map();
  for (const t of sorted || []) {
    if (!(t.amount < 0) || !t.cat || t.cat === SKIP || skipCats.has(t.cat)) continue;
    const mm = String(t.date).slice(0, 7);
    if (mm !== month && !prev.includes(mm)) continue;
    const k = t.cat + "|" + mm;
    by.set(k, (by.get(k) || 0) - t.amount);
  }
  const rows = [];
  for (const e of envelopes || []) {
    if (e.archived || skipCats.has(e.key)) continue;
    const usual = money(median(prev.map((mm) => by.get(e.key + "|" + mm) || 0)));
    const now = money(by.get(e.key + "|" + month) || 0);
    if (!usual && !now) continue;
    const byNow = money(usual * frac);
    rows.push({ id: e.key, name: e.name, now, usual, byNow, ahead: usual > 0 && now > byNow * 1.15 && now - byNow > 10 });
  }
  rows.sort((a, b) => (b.now - b.byNow) - (a.now - a.byNow));
  const total = { now: money(rows.reduce((a, r) => a + r.now, 0)), usual: money(rows.reduce((a, r) => a + r.usual, 0)) };
  return { months: prev, frac: Math.round(frac * 100) / 100, rows, total: { ...total, byNow: money(total.usual * frac) } };
}

/** Bird Budgeting's built-in group names (custom ones come from its `groups`). */
export const GROUP_NAMES = { giving: "Giving & Ministry", housing: "Housing & Utilities", food: "Food & Groceries", transport: "Transportation", insurance: "Insurance & Medical", debtsave: "Debt & Savings", personal: "Personal & Family", fun: "Fun & Recreation", income: "Income" };

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

/** Bird Budgeting's summary, worked out from Nest: the budget accounts' purchases, sorted as above,
    plus this paycheck (`paycheck`). */
export function nestSummary(d, todayISO) {
  const envelopes = d.envelopes || [];
  const ctx = makeCtx(d);
  const month = todayISO.slice(0, 7);
  const how = { you: 0, rule: 0, hint: 0 };
  const sorted = (d.txns || []).filter((t) => d.accounts.has(t.account_id)).map((t) => {
    const s = sortOf(t, ctx);
    if (s.how && t.month === month) how[s.how]++;
    return { id: t.id, month: t.month, date: t.date, amount: t.amount, hint: t.hint, cat: s.cat };
  });
  const asBird = (t) => ({ id: t.id, month: t.month, date: t.date, amount: t.amount, categoryId: t.cat && t.cat !== SKIP ? t.cat : "", transfer: t.cat === SKIP });
  const txns = sorted.map(asBird);
  const marks = d.marks || [];
  const plan = planFor(month, d.plans, d.bills);
  const s = summarize({
    recurring: d.bills || [],
    categories: envelopes.map((e) => ({ id: e.key, name: e.name, group: e.group, archived: e.archived })),
    groups: d.groups || [],
    budget: { month, allocations: plan.amounts, carryover: plan.carry },
    transactions: txns,
    billMarks: marks,
  }, todayISO);
  // Paid or not, for any bill in any month the paycheck card looks at (Bird Budgeting's rules, month by month).
  const today = dateOf(todayISO), cache = new Map();
  const statusOf = (r, date) => {
    const m = date.slice(0, 7);
    if (!cache.has(m)) {
      const [y, mm] = m.split("-").map(Number);
      const due = (d.bills || []).filter((b) => b.type === "expense" && billDaysInMonth(b, y, mm - 1).length);
      cache.set(m, billStatuses(due, txns.filter((t) => t.month === m), marks.filter((k) => k.month === m), m, today));
    }
    return cache.get(m).some((x) => x.r.id === r.id && x.status === "paid");
  };
  const optional = new Set(envelopes.filter((e) => e.priority === "payoff").map((e) => e.key));
  const paycheck = payPeriod({ bills: d.bills, income: ctx.income, optional }, todayISO, sorted, statusOf);
  const billCats = new Set((d.bills || []).filter((b) => b.type === "expense" && b.categoryId).map((b) => b.categoryId));
  const trend = trends(sorted, envelopes, new Set([...billCats, ...ctx.income]), todayISO);
  return { ...s, source: "nest", sorted: how, plan_own: plan.own, paycheck, trends: trend };
}

/* ---------- the one-time move from Bird Budgeting ---------- */

/** Bird Budgeting → Nest: envelopes (with their keywords, target, priority), groups, the latest plans,
    bills (duplicates merged, "pay that varies" kept), store rules (its saved labels, plus what its ledger
    agrees on three times in four), its paid-by-hand marks, and its sorting history as
    [date, cents, envelope, short name] — so each past purchase can find its twin in the bank's copy. */
export function buildSetup(bb, made = new Date().toISOString()) {
  const textOf = (t) => {
    if (t.bankPayee) return String(t.bankPayee);
    const m = String(t.notes || "").match(/^Bank description:\s*([\s\S]+)$/);
    return m ? m[1].trim() : String(t.payee || "");
  };
  const envelopes = (bb.categories || []).map((c) => ({
    key: c.id, name: String(c.name || "").slice(0, 60), group: c.group || "", order: Number(c.order) || 0, archived: !!c.archived,
    keywords: (Array.isArray(c.keywords) ? c.keywords : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 12),
    target: Number(c.target) > 0 ? money(c.target) : null, priority: typeof c.priority === "string" ? c.priority : "", rollover: !!c.rollover,
  }));
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
    dueDay: Number(r.dueDay) || 0, cadence: r.cadence || "", dueMonth: r.dueMonth ?? null, anchorDate: r.anchorDate || "", categoryId: keys.has(r.categoryId) ? r.categoryId : "",
    variesBy: Number(r.variesBy) > 0 ? money(r.variesBy) : 0 }));
  const billIds = new Set(bills.map((b) => b.id));
  const labels = [];
  const have = new Set();
  for (const r of bb.labelRules || []) {
    if (!r.key || !r.categoryId || !keys.has(r.categoryId) || have.has(r.key)) continue;
    labels.push({ key: String(r.key).slice(0, 60), categoryId: r.categoryId });
    have.add(r.key);
  }
  // Stores he files more than one way (two or more rows, no envelope 3 times in 4): asked every time.
  const counts = {};
  for (const t of bb.transactions || []) {
    if (!t.categoryId || !keys.has(t.categoryId) || isTransfer(t)) continue;
    const k = merchantKey(textOf(t));
    if (k) (counts[k] = counts[k] || {})[t.categoryId] = (counts[k][t.categoryId] || 0) + 1;
  }
  const mixed = {};
  for (const [k, c] of Object.entries(counts)) {
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    if (n >= 2 && Math.max(...Object.values(c)) / n < 0.75) mixed[k] = c;
  }
  for (const [k, cid] of Object.entries(learnMerchants(bb.transactions || [], textOf))) {
    if (have.has(k) || !keys.has(cid) || ONE_OFF.test(k)) continue;
    labels.push({ key: k.slice(0, 60), categoryId: cid });
    have.add(k);
  }
  // Paid-by-hand marks: a "linked" one pointed at a Bird Budgeting row, so it travels as the payment it found.
  const byId = new Map((bb.transactions || []).map((t) => [t.id, t]));
  const marks = (bb.billMarks || []).filter((m) => billIds.has(m.recurringId) && /^\d{4}-\d{2}$/.test(m.month || "")).map((m) => {
    const t = m.kind === "linked" ? byId.get(m.txnId) : null;
    return { billId: m.recurringId, month: m.month, kind: "manual", amount: money(t ? Math.abs(Number(t.amount)) : m.amount), date: String((t ? t.date : m.date) || "") };
  });
  const history = (bb.transactions || []).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) && Number.isFinite(Number(t.amount)) && !isTransfer(t))
    .map((t) => [String(t.date), Math.round(Number(t.amount) * 100), keys.has(t.categoryId) ? t.categoryId : "", (tidyPayee(textOf(t)) || String(t.payee || "")).slice(0, 28)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { v: 2, from: "bird-budgeting", made, envelopes, groups, plans, bills, labels, marks, history, mixed };
}
