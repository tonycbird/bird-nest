import { useEffect, useState } from "react";
import { helperReady, pushSupport, setPushPrefs, testPush, turnOffPush, turnOnPush, usePushPrefs, type TurnOnResult } from "../lib/push";
import { useHeadSettings } from "../head/useHead";
import { shortTime } from "../lib/time";
import { useToast } from "../lib/toast";
import { I } from "../ui/Icon";

const WHY: Partial<Record<TurnOnResult, string>> = {
  denied: "Notifications are off for Nest. Turn them on in iPhone Settings → Notifications → Nest.",
  offline: "No connection. Try again with signal.",
  failed: "Couldn't turn it on. Try again in a minute.",
};

/** Settings → Buzz: the rest timer and shutdown, even with the phone locked. */
export function BuzzCard() {
  const p = usePushPrefs();
  const head = useHeadSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const support = pushSupport();
  useEffect(() => { if (p.on) void helperReady().then(setReady); }, [p.on]);

  async function on() {
    setBusy(true); setWhy("");
    const r = await turnOnPush();
    setBusy(false);
    if (r === "ok") toast("🔔 Buzzing on");
    else setWhy(WHY[r] ?? "");
  }

  return (
    <>
      <div className="lbl">Buzz</div>
      <div className="card">
        {support === "install" && <p className="quiet">Open Nest from your Home Screen to turn this on.</p>}
        {support === "browser" && <p className="quiet">This browser can't buzz.</p>}
        {support === "ok" && !p.on && <>
          <p className="quiet" style={{ marginBottom: 10 }}>Rest timer and shutdown, even when your phone is locked.</p>
          <button className="btn primary" style={{ width: "100%" }} disabled={busy} onClick={() => void on()}><I n="bell" /> {busy ? "Turning on…" : "Turn on buzzing"}</button>
          {why && <p className="quiet" style={{ marginTop: 8, color: "var(--warn-ink)" }}>{why}</p>}
        </>}
        {support === "ok" && p.on && <>
          <label className="kv"><span><I n="timer" /> Rest timer done</span><input type="checkbox" checked={p.rest} onChange={(e) => setPushPrefs({ rest: e.target.checked })} /></label>
          <label className="kv"><span><I n="shutdown" /> Shutdown · {shortTime(head.shutdownTime)}</span><input type="checkbox" checked={p.shutdown} onChange={(e) => setPushPrefs({ shutdown: e.target.checked })} /></label>
          {ready === false && <p className="quiet" style={{ marginTop: 8, color: "var(--warn-ink)" }}>Almost: the Cloudflare key isn't in yet.</p>}
          <div className="sheet-actions" style={{ marginTop: 10 }}>
            <button className="btn" onClick={async () => toast((await testPush()) ? "🔔 Sent. Lock your phone to see it." : "⚠ Couldn't send")}><I n="bell" /> Test</button>
            <button className="btn" onClick={async () => { await turnOffPush(); toast("Buzzing off"); }}><I n="quiet" /> Turn off</button>
          </div>
        </>}
      </div>
    </>
  );
}
