import type { CSSProperties } from "react";
import { BUDGET_URL, fmtMoney, useMoney, type MoneyCategory } from "../lib/money";
import { goTab } from "../head/useHead";
import { keyLabel, today } from "../lib/time";
import { I, Icon } from "../ui/Icon";

/* Money (Phase 6): what's left, the next payday, and the bills before it. Read-only: brass is the
   only color here, and changes still happen in Bird Budgeting. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const pct = (c: { budget: number; spent: number }) => (c.budget > 0 ? Math.min(1, Math.max(0, c.spent / c.budget)) : 0);
const at = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toDateString() === new Date().toDateString() ? "Today" : `${MON[d.getMonth()]} ${d.getDate()}`;
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

function Bar({ c, big }: { c: MoneyCategory; big?: boolean }) {
  return <div className={"mbar" + (big ? " big" : "")} aria-hidden="true"><span style={{ width: `${Math.round((1 - pct(c)) * 100)}%` } as CSSProperties} /></div>;
}

export default function Money() {
  const { summary: s, updated, ready } = useMoney();
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
        <div className="card mhero">
          <div className="kv"><span>Groceries</span><span className="muted">{fmtMoney(g.spent, true)} of {fmtMoney(g.budget, true)}</span></div>
          <Bar c={g} big />
        </div>
      )}

      {others.length > 0 && <>
        <div className="lbl">Left this month</div>
        <div className="card">
          {others.map((c) => (
            <div key={c.id} className="mrow">
              <div className="kv"><span>{c.name}</span><b className={c.left < 0 ? "mneg" : ""}>{fmtMoney(c.left, true)}</b></div>
              <Bar c={c} />
            </div>
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
            {late > 0 && <><span className="mflag">!</span> not seen paid yet. </>}
            {s.bank_through && <>Bank copy through {short(s.bank_through)}.</>}
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
