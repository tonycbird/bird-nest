import { useEffect, useState } from "react";
import { setPlanAmount, SKIP, sortPurchase, useBudget, type Purchase } from "../lib/budget";
import { fmtMoney } from "../lib/money";
import { storeKeyFor, tidyPayee } from "../lib/money-core.js";
import { useToast } from "../lib/toast";
import { I, Icon } from "../ui/Icon";

/* Money (Phase 7): the two sheets behind the Money screen. One sorts purchases one at a time with a
   tap; the other shows an envelope's month and lets him change what it gets. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const titleOf = (p: Pick<Purchase, "merchant" | "name">) => (p.merchant || tidyPayee(p.name) || p.name || "Purchase").slice(0, 40);
const amt = (n: number) => (n > 0 ? "+" : "") + fmtMoney(Math.abs(n));

function Frame(props: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="scrim" onClick={props.onClose}>
      <div className="sheet has-x msheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={props.label}>
        <button className="sheet-x" aria-label="Close" onClick={props.onClose}><Icon n="close" size={18} tone={false} /></button>
        {props.children}
      </div>
    </div>
  );
}

/** Sort purchases with one tap each. `ids` = just these (re-sorting); otherwise everything still unsorted, newest first. */
export function SortSheet(props: { ids?: string[]; onClose: () => void }) {
  const b = useBudget();
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [remember, setRemember] = useState(true);
  const [done, setDone] = useState<string[]>([]);
  const queue = !b ? [] : props.ids ? b.purchases.filter((p) => props.ids!.includes(p.id) && !done.includes(p.id)) : b.purchases.filter((p) => !p.cat && !done.includes(p.id));
  const p = queue[0];
  useEffect(() => { if (b && !p) props.onClose(); }, [b, p]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMore(false); setRemember(true); }, [p?.id]);
  if (!b || !p) return null;

  const incomeGroups = new Set(["income", ...b.groups.filter((g) => g.isIncome).map((g) => g.id)]);
  const pool = b.envelopes.filter((e) => !e.archived && (p.amount > 0 ? true : !incomeGroups.has(e.group)));
  const use = new Map<string, number>();
  for (const x of b.purchases) if (x.cat && x.cat !== SKIP) use.set(x.cat, (use.get(x.cat) ?? 0) + 1);
  const ranked = [...pool].sort((a, c) => (use.get(c.key) ?? 0) - (use.get(a.key) ?? 0) || a.order - c.order);
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
      {store && <label className="kv mremember"><span>Remember {titleOf(p)}</span><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /></label>}
    </Frame>
  );
}

/** One envelope this month: what it gets (tap to change), what's gone, and its purchases. */
export function EnvelopeSheet(props: { envKey: string; onClose: () => void; onSort: (ids: string[]) => void }) {
  const b = useBudget();
  const toast = useToast();
  const env = b?.envelopes.find((e) => e.key === props.envKey);
  const planned = b?.plan.amounts[props.envKey] ?? 0;
  const [val, setVal] = useState<string | null>(null);
  if (!b || !env) return null;
  const items = b.purchases.filter((p) => p.cat === props.envKey);
  const spent = Math.round(-items.reduce((a, p) => a + p.amount, 0) * 100) / 100;
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
      <div className="kv"><span>This month</span>
        <span className="mamt">$<input aria-label={`${env.name} this month`} inputMode="decimal" value={shown} onChange={(e) => setVal(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></span></div>
      <div className="kv"><span className="muted">Spent</span><span className="muted mnum">{fmtMoney(spent, true)}</span></div>
      <div className="kv"><span>Left</span><b className={"mnum" + (planned - spent < 0 ? " mneg" : "")}>{fmtMoney(planned - spent, true)}</b></div>
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
