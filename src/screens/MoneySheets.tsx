import { useEffect, useState } from "react";
import { setPlanAmount, SKIP, sortPurchase, useBudget, usePlan, type Purchase } from "../lib/budget";
import { fmtMoney } from "../lib/money";
import { GROUP_NAMES, mixedFor, storeKeyFor, tidyPayee, type Trends, type Why } from "../lib/money-core.js";
import { useToast } from "../lib/toast";
import { I, Icon } from "../ui/Icon";
import { Layer } from "../ui/Layer";

/* Money (Phase 7): the two sheets behind the Money screen. One sorts purchases one at a time with a
   tap; the other shows an envelope's month and lets him change what it gets. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
/** A purchase's name, cut at a word (with …) when it's long. */
export const titleOf = (p: Pick<Purchase, "merchant" | "name">) => {
  const t = (p.merchant || tidyPayee(p.name) || p.name || "Purchase").trim();
  if (t.length <= 32) return t;
  const cut = t.slice(0, 32), sp = cut.lastIndexOf(" ");
  return (sp > 16 ? cut.slice(0, sp) : cut).replace(/[\s,.-]+$/, "") + "…";
};
const amt = (n: number) => (n > 0 ? "+" : "") + fmtMoney(Math.abs(n));

function Frame(props: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Layer><div className="scrim" onClick={props.onClose}>
      <div className="sheet has-x msheet money" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={props.label}>
        <button className="sheet-x" aria-label="Close" onClick={props.onClose}><Icon n="close" size={18} tone={false} /></button>
        {props.children}
      </div>
    </div></Layer>
  );
}

/** Sort purchases with one tap each. `ids` = just these (re-sorting); otherwise everything still unsorted, newest first. */
export function SortSheet(props: { month?: string; ids?: string[]; onClose: () => void }) {
  const b = useBudget(props.month);
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [remember, setRemember] = useState(true);
  const [done, setDone] = useState<string[]>([]);
  const queue = !b ? [] : props.ids ? b.purchases.filter((p) => props.ids!.includes(p.id) && !done.includes(p.id)) : b.purchases.filter((p) => !p.cat && !done.includes(p.id));
  const p = queue[0];
  // A store he files more than one way (Walmart…) isn't remembered unless he says so, and his past picks come first.
  const mix = b && p ? mixedFor(p, b.mixed) : null;
  useEffect(() => { if (b && !p) props.onClose(); }, [b, p]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMore(false); setRemember(!mix); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b || !p) return null;

  const incomeGroups = new Set(["income", ...b.groups.filter((g) => g.isIncome).map((g) => g.id)]);
  const pool = b.envelopes.filter((e) => !e.archived && (p.amount > 0 ? true : !incomeGroups.has(e.group)));
  const use = new Map<string, number>();
  for (const x of b.purchases) if (x.cat && x.cat !== SKIP) use.set(x.cat, (use.get(x.cat) ?? 0) + 1);
  const past = (k: string) => (mix?.[k] ?? 0);
  const ranked = [...pool].sort((a, c) => past(c.key) - past(a.key) || (use.get(c.key) ?? 0) - (use.get(a.key) ?? 0) || a.order - c.order);
  const first = p.cat && p.cat !== SKIP ? pool.find((e) => e.key === p.cat) : undefined;
  const top = [...(first ? [first] : []), ...ranked.filter((e) => e !== first)].slice(0, 6);
  const rest = pool.filter((e) => !top.includes(e)).sort((a, c) => a.name.localeCompare(c.name));
  const store = storeKeyFor(p);

  async function pick(key: string, name: string) {
    const undo = await sortPurchase(p, key, remember && !!store);
    setDone((d) => [...d, p.id]);
    toast(key === SKIP ? "✓ Not spending" : `✓ ${name}`, undo);
  }

  return (
    <Frame label="Sort purchases" onClose={props.onClose}>
      <div className="date">{props.ids ? "Sort" : `To sort · ${queue.length}`}</div>
      <div className="msort">
        <div className="muted">{short(p.date)}{p.pending ? " · pending" : ""}</div>
        <h2>{titleOf(p)}</h2>
        <div className={"mbig" + (p.amount > 0 ? " in" : "")}>{amt(p.amount)}</div>
      </div>
      <div className="mchips">
        {top.map((e) => <button key={e.key} className={"mchip" + (e === first ? " on" : "")} onClick={() => void pick(e.key, e.name)}>{e.name}</button>)}
        {more && rest.map((e) => <button key={e.key} className="mchip" onClick={() => void pick(e.key, e.name)}>{e.name}</button>)}
        {!more && rest.length > 0 && <button className="mchip ghost" onClick={() => setMore(true)}>More <I n="chevD" /></button>}
        <button className="mchip ghost" onClick={() => void pick(SKIP, "")}>Not spending</button>
      </div>
      {store && <label className="kv mremember"><span>{mix ? `Always this for ${titleOf(p)}` : `Remember ${titleOf(p)}`}</span><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /></label>}
      {mix && <p className="quiet" style={{ textAlign: "center", marginTop: 6 }}>You've sorted this store more than one way.</p>}
    </Frame>
  );
}

/** One envelope in a month: what it gets (tap to change), what's gone, what's left, its bills and purchases. */
export function EnvelopeSheet(props: { month?: string; envKey: string; onClose: () => void; onSort: (ids: string[]) => void }) {
  const b = useBudget(props.month);
  const toast = useToast();
  const row = b?.bm.rows.find((r) => r.key === props.envKey);
  const env = b?.envelopes.find((e) => e.key === props.envKey);
  const planned = row?.planned ?? 0;
  const [val, setVal] = useState<string | null>(null);
  if (!b || !env) return null;
  const items = b.purchases.filter((p) => p.cat === props.envKey);
  const spent = row?.spent ?? 0, avail = row?.avail ?? planned, left = Math.round((avail - spent) * 100) / 100;
  const carry = Math.round((avail - planned) * 100) / 100;
  const usual = b.usual[props.envKey] ?? 0;
  const shown = val ?? String(planned);

  async function save() {
    if (val == null) return;
    const n = Number(val.replace(/[$,\s]/g, ""));
    setVal(null);
    if (!Number.isFinite(n) || n === planned) return;
    await setPlanAmount(b!.month, props.envKey, n);
    toast(`✓ ${env!.name} · ${fmtMoney(n, true)}`);
  }

  return (
    <Frame label={env.name} onClose={props.onClose}>
      <h2>{env.name}</h2>
      <div className="kv"><span>Planned</span>
        <span className="mamt">$<input aria-label={`${env.name} planned`} inputMode="decimal" value={shown} onChange={(e) => setVal(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></span></div>
      {Math.abs(carry) >= 0.01 && <div className="kv"><span className="muted">From last month</span><span className="muted mnum">{fmtMoney(carry)}</span></div>}
      <div className="kv"><span className="muted">Spent</span><span className="muted mnum">{fmtMoney(spent, true)}</span></div>
      <div className="kv"><span>Left</span><b className={"mnum" + (left < -0.5 ? " mneg" : "")}>{fmtMoney(left, true)}</b></div>
      {usual > 0 && <div className="kv"><span className="muted">Usual month</span><span className="muted mnum">{fmtMoney(usual, true)}</span></div>}
      {row && row.bills.length > 0 && <>
        <div className="lbl">Bills</div>
        {row.bills.map((x) => (
          <div key={x.id + x.date} className="kv mbill"><span><span className="mday">{short(x.date)}</span>{x.name}</span><span className="mnum">{x.paid ? <I n="check" /> : null} {fmtMoney(x.amount)}</span></div>
        ))}
      </>}
      {items.length > 0 && <>
        <div className="lbl">Purchases</div>
        {items.map((p) => (
          <button key={p.id} className="kv mtx" onClick={() => props.onSort([p.id])}>
            <span><span className="mday">{short(p.date)}</span>{titleOf(p)}</span><span className="mnum">{amt(p.amount)}</span>
          </button>
        ))}
      </>}
    </Frame>
  );
}

/** Everything this month on the budget account, searchable by store, envelope or amount; tap one to re-sort. */
export function PurchasesSheet(props: { month?: string; onClose: () => void; onSort: (ids: string[]) => void }) {
  const b = useBudget(props.month);
  const [q, setQ] = useState("");
  if (!b) return null;
  const names = new Map(b.envelopes.map((e) => [e.key, e.name]));
  const qq = q.trim().toLowerCase().replace(/^\$/, "");
  const label = (p: Purchase) => (p.cat === SKIP ? "Not spending" : (p.cat && names.get(p.cat)) || "To sort");
  const rows = b.purchases.filter((p) => !qq || (p.merchant || "").toLowerCase().includes(qq) || titleOf(p).toLowerCase().includes(qq) || p.name.toLowerCase().includes(qq) || label(p).toLowerCase().includes(qq) || Math.abs(p.amount).toFixed(2).includes(qq));
  const out = Math.round(-rows.filter((p) => p.amount < 0 && p.cat !== SKIP).reduce((a, p) => a + p.amount, 0) * 100) / 100;
  return (
    <Frame label="Purchases" onClose={props.onClose}>
      <h2>Purchases</h2>
      <input className="field" type="search" placeholder="Store, envelope or amount" aria-label="Search purchases" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="msum">{rows.length} · {fmtMoney(out, true)} out</div>
      {rows.slice(0, 300).map((p) => (
        <button key={p.id} className="kv mtx" onClick={() => props.onSort([p.id])}>
          <span className="mline"><span className="mday">{short(p.date)}</span><span className="mname">{titleOf(p)}</span><span className={"mcat" + (p.cat ? "" : " todo")}>{label(p)}</span></span>
          <span className="mnum">{amt(p.amount)}</span>
        </button>
      ))}
      {rows.length === 0 && <p className="quiet" style={{ marginTop: 10 }}>Nothing matches.</p>}
    </Frame>
  );
}

const WHY: Record<Why, string> = { bill: "bill", usual: "usual", target: "goal", spent: "spent so far", trim: "trimmed", extra: "extra", zero: "none" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ago = (m: string, n: number) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 - n, 1); return MON[d.getMonth()]; };

/** The suggested budget for a month, next to what's planned now, with why (bill · usual · trimmed · extra). */
export function SuggestSheet(props: { month: string; onClose: () => void }) {
  const b = useBudget(props.month);
  const toast = useToast();
  if (!b) return null;
  const sg = b.suggestion;
  const now = b.plan.amounts;
  const custom = new Map(b.groups.map((g) => [g.id, g.name]));
  const rows = b.bm.rows.filter((r) => (sg.amounts[r.key] ?? 0) > 0 || (now[r.key] ?? 0) > 0 || sg.why[r.key]);
  const groups = [...new Set(rows.map((r) => r.group))];
  const total = Math.round(Object.values(sg.amounts).reduce((a, x) => a + x, 0) * 100) / 100;
  const ref = b.day.slice(0, 7);
  const same = rows.every((r) => Math.abs((sg.amounts[r.key] ?? 0) - (now[r.key] ?? 0)) < 0.01);

  async function use() {
    const undo = await usePlan(props.month, sg.amounts);
    toast(`✓ ${MONTHS[Number(props.month.slice(5, 7)) - 1]} · suggested budget`, undo);
    props.onClose();
  }

  return (
    <Frame label="Suggested budget" onClose={props.onClose}>
      <h2>Suggested budget</h2>
      <p className="quiet">Bills as billed · everyday at your usual ({ago(ref, 3)}–{ago(ref, 1)}){sg.to ? " · the rest to the Emergency Fund" : ""}</p>
      <div className="kv"><span>In</span><span className="mnum">{fmtMoney(sg.income, true)}</span></div>
      <div className="kv"><span>Suggested</span><span className="mnum">{fmtMoney(total, true)}</span></div>
      <div className="kv"><span>Left to budget</span>{sg.over > 0 ? <b className="mnum mneg">−{fmtMoney(sg.over, true)}</b> : sg.left > 0 ? <b className="mnum">{fmtMoney(sg.left, true)}</b> : <b className="mnum"><I n="check" /> $0</b>}</div>
      {sg.over > 0 && <p className="quiet mnote">Wants trimmed up to ¼. The rest is your call.</p>}
      {sg.left > 0 && <p className="quiet mnote">Give the rest a job.</p>}
      {groups.map((g) => (
        <section key={g}>
          <div className="mgroup">{custom.get(g) ?? GROUP_NAMES[g] ?? "Other"}</div>
          {rows.filter((r) => r.group === g).map((r) => {
            const to = sg.amounts[r.key] ?? 0, was = now[r.key] ?? 0, why = sg.why[r.key];
            return (
              <div key={r.key} className="kv msug">
                <span>{r.name}{why && <span className={"mwhy" + (why === "trim" || why === "extra" ? " on" : "")}>{WHY[why]}</span>}</span>
                <span className="mnum">{Math.abs(to - was) >= 0.01 && <s className="mwas">{fmtMoney(was, true)}</s>} <b>{fmtMoney(to, true)}</b></span>
              </div>
            );
          })}
        </section>
      ))}
      <div className="sheet-actions">
        <button className="btn" onClick={props.onClose}>Not now</button>
        <button className="btn primary" disabled={same} onClick={() => void use()}>{same ? <><I n="check" /> In use</> : "Use it"}</button>
      </div>
    </Frame>
  );
}

/** This month against his usual, per everyday envelope: a brass bar for what's gone, a tick for where
    the usual month would be by today. "Ahead" only when clearly past it; nothing red, nothing naggy. */
export function TrendsSheet({ t, month, onClose, onOpen }: { t: Trends; month: string; onClose: () => void; onOpen: (key: string) => void }) {
  const rows = t.rows;
  const label = (r: Trends["rows"][number]) => (r.usual > 0 ? `usual ${fmtMoney(r.usual, true)}` : "new this month");
  return (
    <Frame label="Compared with usual" onClose={onClose}>
      <h2>Compared with usual</h2>
      <div className="kv"><span className="muted">{MONTHS[Number(month.slice(5, 7)) - 1]} so far</span>
        <span className="muted mnum">{fmtMoney(t.total.now, true)} · usual by now {fmtMoney(t.total.byNow, true)}</span></div>
      {rows.map((r) => {
        const top = Math.max(r.usual, r.now, 1);
        return (
          <div key={r.id} className="mrow tap" role="button" onClick={() => onOpen(r.id)}>
            <div className="kv"><span>{r.name}{r.ahead && <span className="mtag">ahead</span>}</span><b className="mnum">{fmtMoney(r.now, true)}</b></div>
            <div className="mtrend" aria-hidden="true"><span style={{ width: `${Math.round((r.now / top) * 100)}%` }} />{r.usual > 0 && <i style={{ left: `${Math.min(99, Math.round((r.byNow / top) * 100))}%` }} />}</div>
            <div className="msub">{label(r)}</div>
          </div>
        );
      })}
      <p className="quiet" style={{ marginTop: 8 }}>Usual = the middle of the last 3 months. The tick is where a usual month is by today.</p>
    </Frame>
  );
}

/** Settings → Bank: Bird Budgeting's rows next to the bank's, over the dates both have. */
export function BirdCheckSheet(props: { check: { matched: number; total: number; from: string | null; to: string | null; onlyBird: { date: string; cents: number; name: string }[]; onlyBank: { date: string; amount: number; merchant: string; name: string }[] }; onClose: () => void }) {
  const c = props.check;
  return (
    <Frame label="Bird Budgeting check" onClose={props.onClose}>
      <h2>Bird Budgeting check</h2>
      <p className="quiet">{c.from && c.to ? `${short(c.from)} – ${short(c.to)}` : ""}: {c.matched} of {c.total} matched by date and exact amount. Matched ones kept your envelope.</p>
      {c.onlyBird.length > 0 && <>
        <div className="lbl">Only in Bird Budgeting · {c.onlyBird.length}</div>
        {c.onlyBird.map((e, i) => <div key={i} className="kv"><span><span className="mday">{short(e.date)}</span>{e.name || "—"}</span><span className="mnum">{amt(e.cents / 100)}</span></div>)}
      </>}
      {c.onlyBank.length > 0 && <>
        <div className="lbl">Only in the bank · {c.onlyBank.length}</div>
        {c.onlyBank.map((t, i) => <div key={i} className="kv"><span><span className="mday">{short(t.date)}</span>{titleOf(t)}</span><span className="mnum">{amt(t.amount)}</span></div>)}
      </>}
      {c.onlyBird.length === 0 && c.onlyBank.length === 0 && <p className="quiet" style={{ marginTop: 10 }}><I n="check" /> Every purchase lines up.</p>}
    </Frame>
  );
}
