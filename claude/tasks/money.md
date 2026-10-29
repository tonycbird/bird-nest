# Money sync · daily, right after the morning plan (or say "sync money" in any Claude chat)

You are Bird Nest's money reader for Anthony. Bird Budgeting is READ-ONLY here: never set, update, str_replace, delete or batch.
Work in /tmp/nest-money. Only the summary leaves this run: never send transactions, payees or amounts per transaction anywhere.

1. Today's month, Pacific time: `TZ=America/Los_Angeles date +%Y-%m` → MONTH (e.g. 2026-10). Start clean: `rm -rf /tmp/nest-money && mkdir -p /tmp/nest-money`.
2. With the ArtifactData tool (if it's listed as deferred, load it with ToolSearch first), url `https://claude.ai/code/artifact/edb46b38-b8d7-4236-838f-5f9ad2f1f7cd`, out_dir `/tmp/nest-money` on every call:
   - `list` collection `recurring`, query `{"limit": 500}`
   - `list` collection `categories`, query `{"limit": 500}`
   - `list` collection `groups`, query `{"limit": 100}`
   - `get` collection `budgets`, doc_id MONTH
   - `query` collection `transactions`, query `{"where": [["month", "==", MONTH]], "limit": 1000}` (if a next_cursor comes back, repeat with it)
   - `query` collection `billMarks`, query `{"where": [["month", "==", MONTH]], "limit": 500}`
   If no ArtifactData tool can be loaded in this run, stop and reply one line: "Money: no ArtifactData tool in this run."
3. Write the script exactly as below, then check it. If the check fails, stop and say so.
```
cat > /tmp/nest-money.mjs <<'NESTMONEY'
#!/usr/bin/env node
/* Bird Nest money summary (Phase 6). Reads a read-only copy of Bird Budgeting's data and works out
   the few numbers Nest shows. The rules are ported from Bird Budgeting itself (txnLines, billStatusesFor,
   billDaysInMonth, nextDueDate, nextPayday, beforePaydayCard) so both apps agree.

     node claude/tools/money.mjs <dir> [--today YYYY-MM-DD]   → prints the summary as JSON

   <dir> is what Claude's ArtifactData tool writes with out_dir: <dir>/<collection>/<doc id>.json for
   recurring, categories, groups, budgets (this month's doc), transactions (this month) and billMarks (this month).
   Only the summary leaves this machine: no transactions, no payees. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

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

/* ---------- reading the dump ---------- */
export function readDump(dir) {
  const read = (col) => {
    const p = join(dir, col);
    if (!existsSync(p)) return [];
    return readdirSync(p).filter((f) => f.endsWith(".json")).map((f) => {
      const raw = JSON.parse(readFileSync(join(p, f), "utf8"));
      const doc = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) && raw.version ? raw.data : raw;
      return { id: basename(f, ".json"), ...doc };
    });
  };
  const budgets = read("budgets");
  return { recurring: read("recurring"), categories: read("categories"), groups: read("groups"), budget: budgets[0] || null, budgets, transactions: read("transactions"), billMarks: read("billMarks") };
}

export const todayPacific = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node money.mjs <dir> [--today YYYY-MM-DD]"); process.exit(2); }
  const ti = process.argv.indexOf("--today");
  const today = ti > 0 ? process.argv[ti + 1] : todayPacific();
  const data = readDump(dir);
  data.budget = data.budgets.find((b) => b.id === today.slice(0, 7) || b.month === today.slice(0, 7)) || null;
  process.stdout.write(JSON.stringify(summarize(data, today)) + "\n");
}
NESTMONEY
echo "c3588a874be3f849eb4898bd81ebe3a8f87cd3942edd3c8f73b44f1c7d822ce1  /tmp/nest-money.mjs" | sha256sum -c -
```
4. `node /tmp/nest-money.mjs /tmp/nest-money > /tmp/nest-money.json` and make sure it printed one JSON object.
5. Send it (one POST):
```
python3 - <<'PY'
import json, urllib.request
s = json.load(open('/tmp/nest-money.json'))
body = json.dumps({"token": "<TOKEN>", "action": "put", "args": {"summary": s}}).encode()
req = urllib.request.Request("<SUPABASE_URL>/rest/v1/rpc/nest_money", data=body, method="POST",
      headers={"apikey": "<ANON_KEY>", "Content-Type": "application/json"})
print(urllib.request.urlopen(req).read().decode())
PY
```
   The reply must have `"ok": true`. If not, stop and say why in one line.
6. Reply in 2 short lines: groceries left and the next payday; anything odd (e.g. bank copy older than 5 days).
