import { useState, type CSSProperties } from "react";
import { useBank } from "../lib/bank";
import { BUDGET_URL, fmtMoney, useMoney, type MoneyCategory, type MoneySummary } from "../lib/money";
import { useBudget, type BudgetView } from "../lib/budget";
import { GROUP_NAMES, type BudgetRowOut, type Paycheck } from "../lib/money-core.js";
import { BillSheet, EnvelopeSheet, PaychecksSheet, PurchasesSheet, SortSheet, SuggestSheet, TrendsSheet } from "./MoneySheets";
import { goTab } from "../head/useHead";
import { keyLabel, today } from "../lib/time";
import { I, Icon, type IconName } from "../ui/Icon";

/* Money: the family budget, EveryDollar style. Every dollar of the month's paychecks gets a job
   (left to budget → $0), then each envelope shows what's left. Bills sit under Bills, by date, with the
   paydays in between. Brass is the only color here; words are few. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const addMonth = (m: string, n: number) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const at = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toDateString() === new Date().toDateString() ? "Today" : `${MON[d.getMonth()]} ${d.getDate()}`;
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
const span = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${short(a)} – ${Number(b.slice(8, 10))}` : `${short(a)} – ${short(b)}`);
const zero = (n: number) => Math.abs(n) < 0.5;
const GROUP_ICONS: Record<string, IconName> = { giving: "church", housing: "home", transport: "drive", food: "groceries", personal: "person", insurance: "heart", fun: "star", debtsave: "target" };

export default function Money() {
  const { summary: s, ready } = useMoney();
  if (!ready) return null;
  if (!s) {
    return (
      <>
        <header className="top"><div><div className="date">Money</div><h1 className="sentence">Money</h1></div></header>
        <div className="empty"><div className="big money-ic"><Icon n="coin" size={36} /></div><h2>Your money shows here</h2>
          <p className="detail">Link your bank in Settings → Bank.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => goTab("settings")}><I n="settings" /> Open Settings</button>
        </div>
      </>
    );
  }
  return s.source === "nest" ? <Budget s={s} /> : <BirdSummary s={s} />;
}

/* ---------------- the budget ---------------- */

function Budget({ s }: { s: MoneySummary }) {
  const now = today().slice(0, 7);
  const [month, setMonth] = useState(now);
  const b = useBudget(month);
  const { status } = useBank();
  const [view, setView] = useState<"budget" | "bills">("budget");
  const [env, setEnv] = useState<string | null>(null);
  const [sort, setSort] = useState<{ ids?: string[] } | null>(null);
  const [sheet, setSheet] = useState<"suggest" | "trends" | "list" | "pay" | null>(null);
  const [bill, setBill] = useState<{ id?: string; cat?: string; income?: boolean } | null>(null);
  const [inOpen, setInOpen] = useState(false);
  const [empty, setEmpty] = useState(false);
  if (!b) return null;
  const bm = b.bm;
  const first = b.months[0] ?? now;
  const canBack = month > first, canFwd = month < addMonth(now, 1);
  const pulled = Math.max(0, ...(status?.items ?? []).map((i) => i.last_sync || 0));
  const spendRows = bm.rows.filter((r) => !r.bills.length && r.group !== "debtsave" && r.avail > 0);
  const toSpend = spendRows.reduce((a, r) => a + r.left, 0);
  const balanced = zero(bm.toBudget);

  return (
    <div className="money">
      <header className="top">
        <div>
          <div className="date mmonth">
            <button className="mmonth-b" aria-label="Previous month" disabled={!canBack} onClick={() => setMonth(addMonth(month, -1))}><I n="chevL" /></button>
            <span>{monthName(month)}{month.slice(0, 4) !== now.slice(0, 4) ? ` ${month.slice(0, 4)}` : ""}</span>
            <button className="mmonth-b" aria-label="Next month" disabled={!canFwd} onClick={() => setMonth(addMonth(month, 1))}><I n="chevR" /></button>
          </div>
          <h1 className="sentence">
            {balanced
              ? <>{fmtMoney(toSpend, true)} <span className="soft">left to spend</span></>
              : bm.toBudget > 0
                ? <>{fmtMoney(bm.toBudget, true)} <span className="soft">left to budget</span></>
                : <><span className="mneg">{fmtMoney(-bm.toBudget, true)}</span> <span className="soft">over</span></>}
          </h1>
        </div>
      </header>

      {bm.toSort > 0 && (
        <button className="mtosort" onClick={() => setSort({})}><I n="sort" /> {bm.toSort} to sort <I n="chevR" /></button>
      )}

      <div className="card mhero">
        <button className="kv mtx" aria-expanded={inOpen} onClick={() => setInOpen((o) => !o)}>
          <span><I n="coin" /> In <span className="muted">· {bm.income.paychecks.length} paycheck{bm.income.paychecks.length === 1 ? "" : "s"}</span></span>
          <span className="mnum">{fmtMoney(bm.income.total, true)} <I n={inOpen ? "chevU" : "chevD"} /></span>
        </button>
        {inOpen && <div className="min">
          {bm.income.paychecks.map((p) => (
            <div key={p.date} className="kv mbill"><span><span className="mday">{short(p.date)}</span>Paycheck</span>
              <span className="mnum">{p.landed > 0 ? <I n="check" /> : null} {fmtMoney(p.amount, true)}</span></div>
          ))}
          {bm.income.extra > 0 && <div className="kv mbill"><span><span className="mday" />Extra</span><span className="mnum">{fmtMoney(bm.income.extra, true)}</span></div>}
          <p className="quiet mnote">A paycheck counts for the month most of its two weeks fall in.</p>
        </div>}
        <div className="kv"><span>Planned</span><span className="mnum">{fmtMoney(bm.planned, true)}</span></div>
        <div className="kv mleft"><span>Left to budget</span>
          <b className={"mnum" + (bm.toBudget < -0.5 ? " mneg" : "")}>{balanced ? <><I n="check" /> $0</> : fmtMoney(bm.toBudget, true)}</b></div>
        {!b.plan.own && <p className="quiet mnote">Suggested from your bills and usual spending. Tap any envelope to change it.</p>}
        {bm.toBudget < -0.5 && b.plan.own && <p className="quiet mnote">Planned is {fmtMoney(-bm.toBudget, true)} more than what comes in.</p>}
        <button className="btn sm msuggest" onClick={() => setSheet("suggest")}><I n="idea" /> Suggested budget</button>
      </div>

      <div className="mseg"><div className="seg" role="tablist" aria-label="Money view">
        <button role="tab" aria-selected={view === "budget"} className={view === "budget" ? "on" : ""} onClick={() => setView("budget")}>Budget</button>
        <button role="tab" aria-selected={view === "bills"} className={view === "bills" ? "on" : ""} onClick={() => setView("bills")}>Bills</button>
      </div></div>

      {view === "budget" && <Envelopes b={b} showEmpty={empty} onOpen={setEnv} />}
      {view === "budget" && (() => {
        const hidden = bm.rows.filter((r) => !shown(r)).length;
        return hidden > 0 ? <button className="kv mtx mempty" aria-expanded={empty} onClick={() => setEmpty((e) => !e)}><span className="muted">{empty ? "Hide empty envelopes" : `Empty envelopes · ${hidden}`}</span><I n={empty ? "chevU" : "chevD"} /></button> : null;
      })()}

      {view === "bills" && <Bills b={b} paycheck={month === now ? s.paycheck ?? null : null} onBill={(id) => setBill({ id })} onPay={() => setSheet("pay")} />}

      <div className="card mmore">
        {month === now && s.trends && s.trends.rows.some((r) => r.usual > 0) && <button className="kv mtx" onClick={() => setSheet("trends")}><span><I n="layers" /> Compared with usual</span><I n="chevR" /></button>}
        <button className="kv mtx" onClick={() => setSheet("list")}><span><I n="search" /> Purchases</span><span className="muted">{b.purchases.length} <I n="chevR" /></span></button>
      </div>
      <p className="quiet" style={{ textAlign: "center", marginTop: 14 }}>Bank · {pulled ? at(new Date(pulled).toISOString()) : "not yet"}</p>

      {env && <EnvelopeSheet month={month} envKey={env} onClose={() => setEnv(null)} onSort={(ids) => setSort({ ids })} onBill={(id, cat) => setBill({ id, cat })} />}
      {sheet === "pay" && <PaychecksSheet onClose={() => setSheet(null)} onBill={(id) => setBill({ id, income: true })} />}
      {bill && <BillSheet key={bill.id ?? "new"} id={bill.id} cat={bill.cat} income={bill.income} onClose={() => setBill(null)} />}
      {sheet === "list" && <PurchasesSheet month={month} onClose={() => setSheet(null)} onSort={(ids) => setSort({ ids })} />}
      {sheet === "suggest" && <SuggestSheet month={month} onClose={() => setSheet(null)} />}
      {sheet === "trends" && s.trends && <TrendsSheet t={s.trends} month={month} onClose={() => setSheet(null)} onOpen={(k) => { setSheet(null); setEnv(k); }} />}
      {sort && <SortSheet month={month} ids={sort.ids} onClose={() => setSort(null)} />}
    </div>
  );
}

const shown = (r: BudgetRowOut) => r.planned >= 0.5 || r.avail >= 0.5 || Math.abs(r.spent) > 0.004; // a few cents planned is nothing planned

/** Every envelope, by group: what's left (a bar for spending; a date or ✓ for a bill). */
function Envelopes({ b, showEmpty, onOpen }: { b: BudgetView; showEmpty: boolean; onOpen: (k: string) => void }) {
  const custom = new Map(b.groups.map((g) => [g.id, g.name]));
  const rows = b.bm.rows.filter((r) => showEmpty || shown(r));
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <>
      {groups.map((g) => (
        <section key={g}>
          <div className="lbl"><I n={GROUP_ICONS[g] ?? "briefcase"} /> {custom.get(g) ?? GROUP_NAMES[g] ?? "Other"}</div>
          <div className="card">
            {rows.filter((r) => r.group === g).map((r) => <EnvelopeRow key={r.key} r={r} onOpen={() => onOpen(r.key)} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function EnvelopeRow({ r, onOpen }: { r: BudgetRowOut; onOpen: () => void }) {
  if (r.bills.length) {
    const due = r.bills.filter((x) => !x.paid);
    return (
      <div className="mrow tap" role="button" onClick={onOpen}>
        <div className="kv"><span>{r.name}{due.length > 0 && <span className="mwhen">{short(due[0].date)}</span>}</span>
          {r.paid
            ? <span className="mpaid"><I n="check" /> {r.left < -0.5 ? <b className="mnum mneg">{fmtMoney(r.left, true)}</b> : fmtMoney(r.spent || r.planned, true)}</span>
            : <b className={"mnum" + (r.left < -0.5 ? " mneg" : "")}>{fmtMoney(r.left, true)}</b>}
        </div>
      </div>
    );
  }
  const pct = r.avail >= 0.5 ? Math.min(1, Math.max(0, r.spent / r.avail)) : 1; // nothing planned: an empty bar, never a full one
  return (
    <div className="mrow tap" role="button" onClick={onOpen}>
      <div className="kv"><span>{r.name}</span><span><b className={"mnum" + (r.left < -0.5 ? " mneg" : "")}>{fmtMoney(r.left, true)}</b> <span className="mof">of {fmtMoney(r.avail, true).slice(1)}</span></span></div>
      <div className={"mbar" + (r.left < -0.5 ? " over" : "")} aria-hidden="true"><span style={{ width: `${Math.round((1 - pct) * 100)}%` } as CSSProperties} /></div>
    </div>
  );
}

/** The month's bills by date with the paydays in between, and (this month) the paycheck card. */
function Bills({ b, paycheck, onBill, onPay }: { b: BudgetView; paycheck: Paycheck | null; onBill: (id?: string) => void; onPay: () => void }) {
  const day = b.day;
  const list = b.billLines;
  const bills = list.filter((x) => x.kind === "bill");
  const paid = bills.filter((x) => x.paid);
  return (
    <>
      {paycheck && <PaycheckCard p={paycheck} />}
      <div className="lbl"><I n="bill" /> {monthName(b.month)} bills</div>
      <div className="card">
        {list.map((x) => x.kind === "pay"
          ? <button key={x.id} className="kv mtx mpayline" onClick={onPay}><span><span className="mday">{short(x.date)}</span><I n="coin" /> Payday</span><b className="mnum">+{fmtMoney(x.amount, true)}</b></button>
          : <button key={x.id + x.date} className="kv mtx mbill" onClick={() => onBill(x.id)}>
              <span><span className="mday">{short(x.date)}</span>{!x.paid && x.date < day ? <span className="mflag" aria-label="Not seen paid">!</span> : null}{x.name}</span>
              <span className="mnum">{x.paid ? <I n="check" /> : null} {fmtMoney(x.amount, true)}</span>
            </button>)}
        {bills.length === 0 && <div className="kv"><span className="muted">No bills this month</span></div>}
        {bills.length > 0 && <div className="kv mnext"><span className="muted">Paid {paid.length} of {bills.length}</span>
          <span className="muted mnum">{fmtMoney(paid.reduce((a, x) => a + x.amount, 0), true)} of {fmtMoney(bills.reduce((a, x) => a + x.amount, 0), true)}</span></div>}
      </div>
      <button className="btn sm madd" onClick={() => onBill(undefined)}><I n="plus" tone={false} /> Bill</button>
      {bills.some((x) => !x.paid && x.date < day) && <p className="quiet mnote"><span className="mflag">!</span> not seen paid · sort its payment to the bill</p>}
    </>
  );
}

/** This paycheck: what's left after its bills and everything else, per day; and whether the next
    paycheck covers its own bills, or needs some held back. */
function PaycheckCard({ p }: { p: Paycheck }) {
  const [open, setOpen] = useState(false);
  const short_ = -p.next.left;
  const big = [...p.next.bills].filter((b) => !b.optional).sort((a, b) => b.amount - a.amount)[0];
  return (
    <>
      <div className="lbl"><I n="calendar" /> This paycheck</div>
      <div className="card mpay tap" role="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <div className="kv"><span className="muted">{span(p.start, p.end)}</span><span className="muted">{p.daysLeft === 1 ? "Last day" : `${p.daysLeft} days left`}</span></div>
        <div className="mpay-hero"><b className={p.left < 0 ? "mneg" : ""}>{fmtMoney(p.left, true)}</b> <span className="soft">left</span>
          {p.daysLeft > 1 && p.left > 0 && <span className="soft"> · {fmtMoney(p.perDay, true)}/day</span>}</div>
        <div className="mpay-math">In {fmtMoney(p.in, true)} · Bills {fmtMoney(p.billsTotal, true)} · Spent {fmtMoney(p.spent, true)}</div>
        {open && <div className="mpay-bills">
          {p.bills.map((b) => (
            <div key={b.id + b.date} className={"kv mbill" + (b.optional ? " unseen" : "")}>
              <span><span className="mday">{short(b.date)}</span>{b.name}{b.optional ? " · extra" : ""}</span>
              <span>{b.paid ? <I n="check" /> : null} {fmtMoney(b.amount, true)}</span>
            </div>
          ))}
        </div>}
        <div className="kv mnext"><span><I n="calendar" /> Next · {keyLabel(p.next.start)}</span>
          <b className={short_ > 0 ? "mneg" : ""}>{short_ > 0 ? `Short ${fmtMoney(short_, true)}` : `${fmtMoney(p.next.left, true)} after bills`}</b></div>
        {short_ > 0 && big && <p className="quiet mnote">Keep {fmtMoney(short_, true)} of this paycheck for {big.name} on {short(big.date)}.</p>}
      </div>
    </>
  );
}

/* ---------------- Bird Budgeting's read-only summary (a phone that hasn't moved in yet) ---------------- */

const pct = (c: { budget: number; spent: number }) => (c.budget > 0 ? Math.min(1, Math.max(0, c.spent / c.budget)) : 0);
function Bar({ c, big }: { c: MoneyCategory; big?: boolean }) {
  return <div className={"mbar" + (big ? " big" : "")} aria-hidden="true"><span style={{ width: `${Math.round((1 - pct(c)) * 100)}%` } as CSSProperties} /></div>;
}

function BirdSummary({ s }: { s: MoneySummary }) {
  const { updated } = useMoney();
  const fresh = s.month === today().slice(0, 7);
  const g = s.groceries;
  const others = s.categories.filter((c) => !g || c.id !== g.id);
  const late = s.before_payday.bills.filter((b) => b.late).length;
  return (
    <div className="money">
      <header className="top">
        <div><div className="date">Money{fresh ? "" : ` · ${MON[Number(s.month.slice(5, 7)) - 1]}`}</div>
          <h1 className="sentence">{g ? <>{fmtMoney(g.left, true)} <span className="soft">for groceries</span></> : <>{fmtMoney(s.left.total, true)} <span className="soft">left</span></>}</h1></div>
      </header>
      {g && <div className="card mhero"><div className="kv"><span>Groceries</span><span className="muted">{fmtMoney(g.spent, true)} of {fmtMoney(g.budget, true)}</span></div><Bar c={g} big /></div>}
      {others.length > 0 && <>
        <div className="lbl">Left this month</div>
        <div className="card">
          {others.map((c) => (
            <div key={c.id} className="mrow"><div className="kv"><span>{c.name}</span><b className={c.left < 0 ? "mneg" : ""}>{fmtMoney(c.left, true)}</b></div><Bar c={c} /></div>
          ))}
          <div className="kv"><span className="muted">All envelopes</span><span className="muted">{fmtMoney(s.left.total, true)} left</span></div>
        </div>
      </>}
      {s.payday && <>
        <div className="lbl">Payday</div>
        <div className="card">
          <div className="kv"><span><I n="calendar" /> {keyLabel(s.payday.date)}</span><b>+{fmtMoney(s.payday.amount, true)}</b></div>
          {s.before_payday.bills.length === 0 && <div className="kv"><span className="muted">Nothing due before then</span></div>}
          {s.before_payday.bills.length > 0 && <>
            <div className="kv"><span className="muted">Bills before then</span><span className="muted">{fmtMoney(s.before_payday.total, true)}</span></div>
            {s.before_payday.bills.map((b) => (
              <div key={b.id + b.date} className={"kv mbill" + (b.unseen ? " unseen" : "")}>
                <span><span className="mday">{short(b.date)}</span>{b.late ? <span className="mflag" aria-label="Not seen paid">!</span> : null}{b.name}</span>
                <span>{fmtMoney(b.amount, true)}</span>
              </div>
            ))}
          </>}
        </div>
        {(late > 0 || (s.unseen > 0 && s.bank_through)) && (
          <p className="quiet mnote">
            {late > 0 && <><span className="mflag">!</span> not seen paid yet{s.bank_through ? " · " : ""}</>}
            {s.bank_through && <>Bank copy through {short(s.bank_through)}</>}
          </p>
        )}
      </>}
      <div className="lbl">This month</div>
      <div className="card">
        <div className="kv"><span><I n="check" /> Bills paid</span><span className="muted">{s.paid_this_month.count} · {fmtMoney(s.paid_this_month.total, true)}</span></div>
        <div className="kv"><span><I n="sort" /> To sort</span><span className="muted">{s.to_sort}</span></div>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        <a className="btn" href={BUDGET_URL} target="_blank" rel="noreferrer"><I n="arrow" /> Open Bird Budgeting</a>
      </div>
      <p className="quiet" style={{ textAlign: "center", marginTop: 14 }}>Updated {at(updated)}</p>
    </div>
  );
}
