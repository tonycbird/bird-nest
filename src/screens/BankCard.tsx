import { useEffect, useState } from "react";
import { bankWhy, connectBank, pullNow, reconnectBank, refreshStatus, removePractice, useBank, type BankItem, type PlaidEnv } from "../lib/bank";
import { toggleBudgetAccount, useBudgetAccounts } from "../lib/budget";
import { fmtMoney } from "../lib/money";
import { CLOUD } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { I } from "../ui/Icon";

function ago(ms: number): string {
  if (!ms) return "not yet";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
function itemLine(it: BankItem): string {
  if (it.status === "login") return "Sign in again";
  if (it.status === "error") return "Couldn't pull";
  if (it.update_status && it.update_status !== "HISTORICAL_UPDATE_COMPLETE") return "Getting history…";
  return ago(it.last_sync);
}
/** Short names for the card (Plaid gives the long ones). */
const short = (name: string) => (/idaho central credit union/i.test(name) ? "ICCU" : name || "Bank");

/** Settings → Bank: link ICCU through Plaid; purchases then come in by themselves. */
export function BankCard() {
  const { status } = useBank();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [why, setWhy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const budgetIds = useBudgetAccounts();
  useEffect(() => { if (CLOUD) void refreshStatus().catch(() => undefined); }, []);
  if (!CLOUD) return null;

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label); setWhy("");
    try { await f(); } catch (e) { setWhy(bankWhy(e)); }
    setBusy("");
  }
  const connect = (env: PlaidEnv) => run(env, async () => {
    setConfirm(false);
    const r = await connectBank(env);
    if (r === "ok") toast(env === "sandbox" ? "✓ Practice bank linked" : "✓ Bank linked");
  });

  const items = status?.items ?? [];
  const real = items.filter((i) => i.env === "production");
  const used = status?.prod_used ?? 0, limit = status?.prod_limit ?? 10;

  return (
    <>
      <div className="lbl">Bank</div>
      <div className="card">
        {items.length === 0 && <p className="quiet" style={{ marginBottom: 10 }}>Purchases come in by themselves, a few times a day.</p>}

        {items.map((it) => (
          <div key={it.item_id} className="bank-item">
            <div className="kv"><span><I n="coin" /> {short(it.inst_name)}{it.env === "sandbox" && <span className="muted"> · practice</span>}</span>
              <span className="muted" style={it.status !== "ok" ? { color: "var(--warn-ink)", fontWeight: 700 } : undefined}>{itemLine(it)}</span></div>
            {(() => {
              // The budget account (Joint Checking) shows; the rest (business, savings, cards) fold behind one line.
              // Open, a tap on an account counts it in the budget or takes it out.
              const all = (status?.accounts ?? []).filter((a) => a.item_id === it.item_id);
              const isOpen = open.has(it.item_id);
              const main = all.filter((a) => budgetIds?.has(a.account_id));
              const shown = isOpen ? all : main.length ? main : all.slice(0, 1);
              const more = all.length - shown.length;
              return <>
                {shown.map((a) => {
                  const inBudget = !!budgetIds?.has(a.account_id);
                  const row = <><span>{a.name}{a.mask ? ` ··${a.mask}` : ""}{inBudget && <span className="mtag">Budget</span>}</span><span className="muted mnum">{a.current == null ? "—" : fmtMoney(a.type === "credit" || a.type === "loan" ? -a.current : a.current)}</span></>;
                  return isOpen && a.type === "depository"
                    ? <button key={a.account_id} className="kv linkish" aria-pressed={inBudget} onClick={() => void toggleBudgetAccount(a.account_id)}>{row}</button>
                    : <div key={a.account_id} className="kv">{row}</div>;
                })}
                {more > 0 && <button className="kv linkish" onClick={() => setOpen(new Set([...open, it.item_id]))}><span className="muted">＋{more} more account{more === 1 ? "" : "s"}</span><I n="chevD" /></button>}
                {isOpen && <p className="quiet" style={{ marginTop: 6 }}>Tap a bank account to count it in the budget.</p>}
              </>;
            })()}
            {(it.status === "login" || it.env === "sandbox") && (
              <div className="sheet-actions" style={{ marginTop: 8 }}>
                {it.status === "login" && <button className="btn primary" disabled={!!busy} onClick={() => void run("re", async () => { if ((await reconnectBank(it.item_id)) === "ok") toast("✓ Signed in again"); })}><I n="key" /> Sign in again</button>}
                {it.env === "sandbox" && <button className="btn" disabled={!!busy} onClick={() => void run("rm", async () => { await removePractice(it.item_id); toast("Practice bank removed"); })}><I n="trash" /> Remove</button>}
              </div>
            )}
          </div>
        ))}

        {items.length > 0 && <div className="kv"><span>Purchases</span><span className="muted">{status?.count ?? 0}{status?.newest ? ` · newest ${status.newest.slice(5).replace("-", "/")}` : ""}</span></div>}

        {confirm && (
          <div className="card" style={{ marginTop: 10 }}>
            <p><strong>Link ICCU?</strong></p>
            <p className="quiet" style={{ marginTop: 4 }}>Uses 1 of your {limit} free bank links ({used} used). Search for ICCU on the next screen and sign in there. Nest never sees your login.</p>
            <div className="sheet-actions">
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void connect("production")}><I n="key" /> Continue</button>
            </div>
          </div>
        )}

        {!confirm && (
          <div className="stack" style={{ marginTop: 10 }}>
            {items.length > 0 && <button className="btn" disabled={!!busy} onClick={() => void run("pull", async () => { const n = await pullNow(); toast(n ? `↓ ${n} new` : "Up to date"); })}><I n="refresh" /> {busy === "pull" ? "Pulling…" : "Pull now"}</button>}
            {real.length === 0 && <button className="btn primary" disabled={!!busy || used >= limit} onClick={() => setConfirm(true)}><I n="coin" /> {busy === "production" ? "Opening…" : "Connect ICCU"}</button>}
            {items.length === 0 && <button className="btn" disabled={!!busy} onClick={() => void connect("sandbox")}><I n="play" /> {busy === "sandbox" ? "Opening…" : "Try the practice bank"}</button>}
          </div>
        )}
        {why && <p className="quiet" style={{ marginTop: 8, color: "var(--warn-ink)" }}>{why}</p>}
      </div>
    </>
  );
}
