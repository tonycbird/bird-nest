import { useState, type CSSProperties } from "react";
import { useBank } from "../lib/bank";
import { BUDGET_URL, fmtMoney, useMoney, type MoneyCategory } from "../lib/money";
import { useBudget } from "../lib/budget";
import { GROUP_NAMES, SKIP, type Paycheck } from "../lib/money-core.js";
import { EnvelopeSheet, PurchasesSheet, SortSheet } from "./MoneySheets";
import { goTab } from "../head/useHead";
import { keyLabel, today } from "../lib/time";
import { I, Icon } from "../ui/Icon";

/* Money: what's left, the next payday, and the bills before it. Brass is the only color here.
   Phase 7: once Nest works the numbers out from the bank itself (source "nest"), an envelope opens
   to change what it gets, and "To sort" sorts purchases with a tap. Until then it's Bird Budgeting's
   read-only summary (Phase 6). */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const pct = (c: { budget: number; spent: number }) => (c.budget > 0 ? Math.min(1, Math.max(0, c.spent / c.budget)) : 0);
const at = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toDateString() === new Date().toDateString() ? "Today" : `${MON[d.getMonth()]} ${d.getDate()}`;
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

const span = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${short(a)} – ${Number(b.slice(8, 10))}` : `${short(a)} – ${short(b)}`);

/** This paycheck (Bird Budgeting's Plan page in one card): what's left after its bills and everything
    else, per day; and whether the next paycheck covers its own bills, or needs some held back. */
function PaycheckCard({ p }: { p: Paycheck }) {
  const [open, setOpen] = useState(false);
  const short_ = -p.next.left;
  const big = [...p.next.bills].filter((b) => !b.optional).sort((a, b) => b.amount - a.amount)[0];
  return (
    <>
      <div className="lbl">This paycheck</div>
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

/** Every envelope, by group, with what's left (tap one to open it). */
function AllEnvelopes({ onOpen }: { onOpen: (key: string) => void }) {
  const b = useBudget();
  if (!b) return null;
  const spent = new Map<string, number>();
  for (const p of b.purchases) if (p.cat && p.cat !== SKIP && p.amount < 0) spent.set(p.cat, (spent.get(p.cat) ?? 0) - p.amount);
  const custom = new Map(b.groups.map((g) => [g.id, g.name]));
  const rows = b.envelopes.filter((e) => !e.archived && !b.income.has(e.key)).map((e) => {
    const budget = (b.plan.amounts[e.key] ?? 0) + (b.plan.carry[e.key] ?? 0), sp = Math.round((spent.get(e.key) ?? 0) * 100) / 100;
    return { e, budget, spent: sp, left: Math.round((budget - sp) * 100) / 100 };
  }).filter((r) => r.budget > 0 || r.spent > 0);
  const groups = [...new Set(rows.map((r) => r.e.group))];
  return (
    <div className="mall">
      {groups.map((g) => (
        <div key={g}>
          <div className="mgroup">{custom.get(g) ?? GROUP_NAMES[g] ?? "Other"}</div>
          {rows.filter((r) => r.e.group === g).map((r) => (
            <button key={r.e.key} className="kv mtx" onClick={() => onOpen(r.e.key)}><span>{r.e.name}</span><b className={"mnum" + (r.left < 0 ? " mneg" : "")}>{fmtMoney(r.left, true)}</b></button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Bar({ c, big }: { c: MoneyCategory; big?: boolean }) {
  return <div className={"mbar" + (big ? " big" : "")} aria-hidden="true"><span style={{ width: `${Math.round((1 - pct(c)) * 100)}%` } as CSSProperties} /></div>;
}

export default function Money() {
  const { summary: s, updated, ready } = useMoney();
  const { status } = useBank();
  const [env, setEnv] = useState<string | null>(null);
  const [sort, setSort] = useState<{ ids?: string[] } | null>(null);
  const [all, setAll] = useState(false);
  const [list, setList] = useState(false);
  const day = today();
  const close = <button className="gear" aria-label="Back to Today" onClick={() => goTab("today")}><Icon n="close" size={20} tone={false} /></button>;
  if (!ready) return null;
  if (!s) {
    return (
      <>
        <header className="top"><div><div className="date">Money</div><h1 className="sentence">Bird Budgeting</h1></div>{close}</header>
        <div className="empty"><div className="big money-ic"><Icon n="coin" size={36} /></div><h2>Coming with Claude's morning</h2>
          <p className="detail">A read-only summary of Bird Budgeting.</p>
          <a className="btn" href={BUDGET_URL} target="_blank" rel="noreferrer" style={{ marginTop: 14 }}><I n="arrow" /> Open Bird Budgeting</a>
        </div>
      </>
    );
  }
  const fresh = s.month === day.slice(0, 7);
  const nest = s.source === "nest";
  const pulled = Math.max(0, ...(status?.items ?? []).map((i) => i.last_sync || 0));
  const open = (id: string) => (nest ? () => setEnv(id) : undefined);
  const g = s.groceries;
  const others = s.categories.filter((c) => !g || c.id !== g.id);
  const late = s.before_payday.bills.filter((b) => b.late).length;
  return (
    <div className="money">
      <header className="top">
        <div><div className="date">Money{fresh ? "" : ` · ${MON[Number(s.month.slice(5, 7)) - 1]}`}</div>
          <h1 className="sentence">{g ? <>{fmtMoney(g.left, true)} <span className="soft">for groceries</span></> : <>{fmtMoney(s.left.total, true)} <span className="soft">left</span></>}</h1></div>
        {close}
      </header>

      {g && (
        <div className={"card mhero" + (nest ? " tap" : "")} onClick={open(g.id)} role={nest ? "button" : undefined}>
          <div className="kv"><span>Groceries</span><span className="muted">{fmtMoney(g.spent, true)} of {fmtMoney(g.budget, true)}</span></div>
          <Bar c={g} big />
        </div>
      )}

      {others.length > 0 && <>
        <div className="lbl">Left this month</div>
        <div className="card">
          {others.map((c) => (
            <div key={c.id} className={"mrow" + (nest ? " tap" : "")} onClick={open(c.id)} role={nest ? "button" : undefined}>
              <div className="kv"><span>{c.name}</span><b className={c.left < 0 ? "mneg" : ""}>{fmtMoney(c.left, true)}</b></div>
              <Bar c={c} />
            </div>
          ))}
          {nest
            ? <button className="kv mtx" aria-expanded={all} onClick={() => setAll((a) => !a)}><span className="muted">All envelopes</span><span className="muted">{fmtMoney(s.left.total, true)} left <I n={all ? "chevU" : "chevD"} /></span></button>
            : <div className="kv"><span className="muted">All envelopes</span><span className="muted">{fmtMoney(s.left.total, true)} left</span></div>}
          {nest && all && <AllEnvelopes onOpen={(k) => setEnv(k)} />}
        </div>
      </>}

      {nest && s.paycheck && <PaycheckCard p={s.paycheck} />}

      {!nest && s.payday && <>
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
        {(late > 0 || (s.unseen > 0 && s.bank_through && !nest)) && (
          <p className="quiet mnote">
            {late > 0 && <><span className="mflag">!</span> not seen paid yet. </>}
            {s.bank_through && !nest && <>Bank copy through {short(s.bank_through)}.</>}
          </p>
        )}
      </>}

      <div className="lbl">This month</div>
      <div className="card">
        <div className="kv"><span><I n="check" /> Bills paid</span><span className="muted">{s.paid_this_month.count} · {fmtMoney(s.paid_this_month.total, true)}</span></div>
        {nest && s.to_sort > 0
          ? <button className="kv mtx" onClick={() => setSort({})}><span><I n="sort" /> To sort</span><span className="mcount">{s.to_sort} <I n="chevR" /></span></button>
          : <div className="kv"><span><I n="sort" /> To sort</span><span className="muted">{nest ? "All sorted" : s.to_sort}</span></div>}
        {nest && <button className="kv mtx" onClick={() => setList(true)}><span><I n="search" /> Purchases</span><span className="muted">Search <I n="chevR" /></span></button>}
      </div>
      {!nest && <div className="stack" style={{ marginTop: 12 }}>
        <a className="btn" href={BUDGET_URL} target="_blank" rel="noreferrer"><I n="arrow" /> Open Bird Budgeting</a>
      </div>}
      <p className="quiet" style={{ textAlign: "center", marginTop: 14 }}>{nest ? <>Bank · {pulled ? at(new Date(pulled).toISOString()) : "not yet"}</> : <>Updated {at(updated)}</>}</p>
      {env && <EnvelopeSheet envKey={env} onClose={() => setEnv(null)} onSort={(ids) => setSort({ ids })} />}
      {list && <PurchasesSheet onClose={() => setList(false)} onSort={(ids) => setSort({ ids })} />}
      {sort && <SortSheet ids={sort.ids} onClose={() => setSort(null)} />}
    </div>
  );
}
