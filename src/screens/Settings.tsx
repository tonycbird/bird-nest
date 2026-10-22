import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { counts, download, exportAll, markBackedUp, restoreAll, saveJSON, validate, type Backup } from "../lib/backup";
import { restoreBlock, trash } from "../lib/river";
import { DEFAULT_TZ } from "../lib/dayKey";
import { keyLabel } from "../lib/time";
import { CLOUD } from "../lib/supabase";
import { cloud, cloudCounts, restoreFromCloud, signOut as cloudSignOut, syncNow } from "../lib/sync";
import SignIn from "./SignIn";
import { TestingSettings } from "./Testing";
import { useToast } from "../lib/toast";
import { go, goTab } from "../head/useHead";
import { getMode, setMode, onTheme, resolve, sunLabel, type ThemeMode } from "../lib/theme";
import { setSetting, useSetting } from "../lib/settings";
import { fitApi, fitCounts, importFitness, readFitnessBackup, resetFitCache, type FitnessBackup } from "../body/host";
import { I, Icon } from "../ui/Icon";

function ago(iso: string | undefined): string {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export default function Settings(props: { email: string; online: boolean }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const last = useLiveQuery(async () => (await db.settings.get("last_backup"))?.value as string | undefined, []);
  const stats = useLiveQuery(async () => ({
    blocks: await db.blocks.filter((b) => !b.deleted_at).count(),
    steps: await db.steps.filter((s) => !s.deleted_at).count(),
    tasks: await db.tasks.count(),
  }), [], { blocks: 0, steps: 0, tasks: 0 });
  const bin = useLiveQuery(() => trash(), [], []);
  const [pending, setPending] = useState<Backup | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const fitFile = useRef<HTMLInputElement>(null);
  const [fitPending, setFitPending] = useState<FitnessBackup | null>(null);
  const fit = useLiveQuery(() => fitCounts(), [], { docs: 0, months: 0 });
  const stale = !last || Date.now() - Date.parse(last) > 7 * 864e5;

  async function backup() {
    const b = await exportAll();
    download(b);
    await markBackedUp();
    toast("⬇ Backup saved");
  }
  async function pick(f: File | undefined) {
    if (!f) return;
    try { setPending(validate(JSON.parse(await f.text()))); }
    catch (e) { toast("✕ " + (e as Error).message); }
    if (file.current) file.current.value = "";
  }
  async function restore() {
    if (!pending) return;
    const safety = await restoreAll(pending);
    setPending(null);
    await resetFitCache();
    toast("⬆ Restored", async () => { await restoreAll(safety); await resetFitCache(); });
  }
  async function pickFit(f: File | undefined) {
    if (!f) return;
    try { setFitPending(readFitnessBackup(JSON.parse(await f.text()))); }
    catch (e) { toast("✕ " + (e as Error).message); }
    if (fitFile.current) fitFile.current.value = "";
  }
  async function importFit() {
    if (!fitPending) return;
    const safety = await exportAll();
    const r = await importFitness(fitPending);
    setFitPending(null);
    toast(`🏋 Imported · ${r.sessions} workouts`, async () => { await restoreAll(safety); await resetFitCache(); });
  }
  return (
    <>
      <header className="top">
        <div><div className="date">Settings</div><h1 className="sentence">Nest</h1></div>
        <button className="gear" aria-label="Back to Today" onClick={() => goTab("today")}><Icon n="close" size={20} tone={false} /></button>
      </header>

      <Look />
      <TestingSettings />

      <div className="lbl">Your data</div>
      <div className="card">
        <div className="kv"><span>Stored</span><span className="muted">On this phone</span></div>
        <div className="kv"><span>Blocks · steps</span><span className="muted">{stats.blocks} · {stats.steps}</span></div>
        <div className="kv"><span>Tasks</span><span className="muted">{stats.tasks}</span></div>
        <div className="kv"><span>Last backup</span><span className="muted" style={stale ? { color: "var(--warn)", fontWeight: 700 } : undefined}>{ago(last)}</span></div>
      </div>
      {stale && <p className="quiet" style={{ marginTop: 8 }}>Back up weekly. Save it to Files or iCloud.</p>}
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={backup}><I n="download" /> Back up now</button>
        <button className="btn" onClick={() => file.current?.click()}><I n="upload" /> Restore from file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="card" style={{ marginTop: 10 }}>
          <p><strong>Replace everything on this phone?</strong></p>
          <p className="quiet" style={{ marginTop: 4 }}>Backup from {pending.exported_at.slice(0, 10)} · {counts(pending).blocks} blocks · {counts(pending).tasks ?? 0} tasks</p>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn primary" onClick={restore}><I n="upload" /> Restore</button>
          </div>
        </div>
      )}

      <div className="lbl">Head</div>
      <button className="btn" style={{ width: "100%" }} onClick={() => { go("settings"); goTab("head"); }}><I n="settings" /> Head settings · <I n="upload" /> Clearhead import</button>

      <div className="lbl">Body</div>
      <div className="card">
        <div className="kv"><span>Fitness data</span><span className="muted">{fit.docs ? `${fit.months} months of logs` : "Not set up yet"}</span></div>
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => fitFile.current?.click()}><I n="upload" /> Import Bird Fitness backup</button>
        <input ref={fitFile} type="file" accept="application/json,.json" hidden onChange={(e) => void pickFit(e.target.files?.[0])} />
        {fit.docs > 0 && <button className="btn" onClick={() => { const b = fitApi()?.exportAll(); if (b) saveJSON(b, `bird-fitness-backup-${new Date().toISOString().slice(0, 10)}.json`); }}><I n="download" /> Fitness-only backup</button>}
      </div>
      {fitPending && (
        <div className="card" style={{ marginTop: 10 }}>
          <p><strong>Replace Body data with this backup?</strong></p>
          <p className="quiet" style={{ marginTop: 4 }}>From {String((fitPending as { exportedAt?: string }).exportedAt || "").slice(0, 10) || "an older export"} · {Object.values(fitPending.logs || {}).reduce((n, m) => n + Object.keys((m as { sessions?: object }).sessions || {}).length, 0)} workouts · {Object.keys(fitPending.logs || {}).length} months</p>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setFitPending(null)}>Cancel</button>
            <button className="btn primary" onClick={importFit}><I n="upload" /> Import</button>
          </div>
        </div>
      )}

      <div className="lbl">River trash · {bin.length}</div>
      <button className="btn" style={{ width: "100%" }} onClick={() => setShowTrash(!showTrash)}>{showTrash ? "Hide" : "Show"}</button>
      {showTrash && (
        <div className="card" style={{ marginTop: 8 }}>
          {bin.length === 0 && <p className="quiet">Empty.</p>}
          {bin.slice(0, 30).map((b) => (
            <div key={b.id} className="kv">
              <span>{b.icon} {b.title} <span className="quiet">· {keyLabel(b.day)}</span></span>
              <button className="btn sm" onClick={async () => { await restoreBlock(b.id); toast("↺ Restored"); }}><I n="undo" /></button>
            </div>
          ))}
        </div>
      )}

      <CloudCard />

      <div className="lbl">App</div>
      <div className="card">
        <div className="kv"><span>Time zone</span><span className="muted">{DEFAULT_TZ}</span></div>
        <div className="kv"><span>Network</span><span className="muted">{props.online ? "Online" : "Offline"}</span></div>

        <div className="kv"><span>Version</span><span className="muted">{__BUILD__}</span></div>
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => location.reload()}><I n="refresh" /> Check for update</button>

      </div>
    </>
  );
}

function since(iso: string): string {
  if (!iso) return "Not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

/** ☁ Claude: sign in once so Claude can read the plan and send suggestions. Nest works the same without it. */
function CloudCard() {
  const c = cloud.use();
  const toast = useToast();
  const [connecting, setConnecting] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  if (!CLOUD) return null;
  return (
    <>
      <div className="lbl">Claude</div>
      <div className="card">
        <div className="kv"><span>Connected</span><span className="muted">{c.signedIn ? c.email : "No"}</span></div>
        {c.signedIn && <>
          <div className="kv"><span>Claude's door</span><span className="muted">{c.claimed ? "Open" : "Waiting"}</span></div>
          <div className="kv"><span>Last sync</span><span className="muted">{c.busy ? "Syncing…" : since(c.lastSync)}</span></div>
          <div className="kv"><span>Waiting to go up</span><span className="muted">{c.pending}</span></div>
          {c.error && <div className="kv"><span>Problem</span><span className="muted" style={{ color: "var(--warn)" }}>{c.error}</span></div>}
        </>}
      </div>
      {!c.signedIn && !connecting && <p className="quiet" style={{ marginTop: 8 }}>Sign in once so Claude can plan your mornings. Nest works the same without it.</p>}
      <div className="stack" style={{ marginTop: 10 }}>
        {!c.signedIn && !connecting && <button className="btn primary" onClick={() => setConnecting(true)}><I n="sync" /> Connect Claude</button>}
        {!c.signedIn && connecting && <div className="card"><SignIn compact onDone={() => { setConnecting(false); toast("☁ Connected"); }} /></div>}
        {c.signedIn && <button className="btn" disabled={c.busy} onClick={async () => toast((await syncNow()) ? "☁ Synced" : "☁ Couldn't sync")}><I n="refresh" /> Sync now</button>}
        {c.signedIn && !counts && <button className="btn" onClick={async () => setCounts(await cloudCounts())}><I n="sync" /> What's in the cloud?</button>}
        {c.signedIn && counts && <div className="card">
          <div className="kv"><span>Tasks</span><span className="muted">{counts.tasks}</span></div>
          <div className="kv"><span>Blocks</span><span className="muted">{counts.blocks}</span></div>
          <div className="kv"><span>Fitness docs</span><span className="muted">{counts.fit}</span></div>
          <button className="btn" style={{ marginTop: 8, width: "100%" }} onClick={async () => { const n = await restoreFromCloud(); toast(`⬇ Added ${n} rows from the cloud`); }}><I n="download" /> Add missing rows to this phone</button>
        </div>}
        {c.signedIn && <button className="btn" onClick={async () => { await cloudSignOut(); toast("⎋ Signed out"); }}><I n="signout" /> Sign out</button>}
      </div>
    </>
  );
}

/** Light by day, dark at night, or pinned to one. */
function Look() {
  const [mode, setM] = useState<ThemeMode>(getMode());
  const [, redraw] = useState(0);
  useEffect(() => onTheme(() => redraw((n) => n + 1)), []);
  const details = useSetting<boolean>("details", false);
  const sun = sunLabel();
  const opts: [ThemeMode, string][] = [["auto", "Follow the sun"], ["light", "Light"], ["dark", "Dark"]];
  return (
    <>
      <div className="lbl">Look</div>
      <div className="card">
        <div className="seg" role="radiogroup" aria-label="Look" style={{ width: "100%", display: "flex" }}>
          {opts.map(([m, l]) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} style={{ flex: 1 }} onClick={() => { setMode(m); setM(m); }}>{l}</button>
          ))}
        </div>
        <p className="quiet" style={{ marginTop: 10 }}>
          {mode === "auto" ? `Light from ${sun.rise} to ${sun.set}, dark the rest. Now: ${resolve() === "light" ? "light" : "dark"}.` : mode === "light" ? "Always light." : "Always dark."}
        </p>
        <label className="kv" style={{ marginTop: 6 }}><span>Show details</span><input type="checkbox" checked={details} onChange={(e) => void setSetting("details", e.target.checked)} /></label>
      </div>
    </>
  );
}
