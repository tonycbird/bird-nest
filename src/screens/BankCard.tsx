import { useEffect, useState } from "react";
import { bankWhy, connectBank, pullNow, reconnectBank, refreshStatus, removePractice, useBank, type BankItem, type PlaidEnv } from "../lib/bank";
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
            {(status?.accounts ?? []).filter((a) => a.item_id === it.item_id).map((a) => (
              <div key={a.account_id} className="kv"><span>{a.name}{a.mask ? ` ··${a.mask}` : ""}</span><span className="muted mnum">{a.current == null ? "—" : fmtMoney(a.type === "credit" ? -a.current : a.current)}</span></div>
            ))}
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
