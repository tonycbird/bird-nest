import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { counts, download, exportAll, markBackedUp, restoreAll, validate, type Backup } from "../lib/backup";
import { restoreBlock, trash } from "../lib/river";
import { DEFAULT_TZ } from "../lib/dayKey";
import { keyLabel } from "../lib/time";
import { CLOUD, supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { go, goTab } from "../head/useHead";

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
    toast("⬆ Restored", async () => { await restoreAll(safety); });
  }
  async function signOut() {
    await supabase.auth.signOut();
    location.reload();
  }

  return (
    <>
      <header className="top"><div><div className="date">Settings</div><h1 className="sentence">⚙ Nest</h1></div></header>

      <div className="lbl">💾 Your data</div>
      <div className="card">
        <div className="kv"><span>📱 Stored</span><span className="muted">On this phone</span></div>
        <div className="kv"><span>🌊 Blocks · steps</span><span className="muted">{stats.blocks} · {stats.steps}</span></div>
        <div className="kv"><span>🧠 Tasks</span><span className="muted">{stats.tasks}</span></div>
        <div className="kv"><span>⬇ Last backup</span><span className="muted" style={stale ? { color: "var(--warn)", fontWeight: 700 } : undefined}>{ago(last)}</span></div>
      </div>
      {stale && <p className="quiet" style={{ marginTop: 8 }}>Back up weekly. Save it to Files or iCloud.</p>}
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={backup}>⬇ Back up now</button>
        <button className="btn" onClick={() => file.current?.click()}>⬆ Restore from file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="card" style={{ marginTop: 10 }}>
          <p><strong>Replace everything on this phone?</strong></p>
          <p className="quiet" style={{ marginTop: 4 }}>Backup from {pending.exported_at.slice(0, 10)} · {counts(pending).blocks} blocks · {counts(pending).tasks ?? 0} tasks</p>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn primary" onClick={restore}>⬆ Restore</button>
          </div>
        </div>
      )}

      <div className="lbl">🧠 Head</div>
      <button className="btn" style={{ width: "100%" }} onClick={() => { go("settings"); goTab("head"); }}>⚙ Head settings · ⬆ Clearhead import</button>

      <div className="lbl">🗑 River trash · {bin.length}</div>
      <button className="btn" style={{ width: "100%" }} onClick={() => setShowTrash(!showTrash)}>{showTrash ? "Hide" : "Show"}</button>
      {showTrash && (
        <div className="card" style={{ marginTop: 8 }}>
          {bin.length === 0 && <p className="quiet">Empty.</p>}
          {bin.slice(0, 30).map((b) => (
            <div key={b.id} className="kv">
              <span>{b.icon} {b.title} <span className="quiet">· {keyLabel(b.day)}</span></span>
              <button className="btn sm" onClick={async () => { await restoreBlock(b.id); toast("↺ Restored"); }}>↺</button>
            </div>
          ))}
        </div>
      )}

      <div className="lbl">ⓘ App</div>
      <div className="card">
        {CLOUD && <div className="kv"><span>👤</span><span className="muted">{props.email}</span></div>}
        <div className="kv"><span>🕓 Time zone</span><span className="muted">{DEFAULT_TZ}</span></div>
        <div className="kv"><span>📶</span><span className="muted">{props.online ? "Online" : "Offline"}</span></div>
        <div className="kv"><span>☁ Cloud sync</span><span className="muted">{CLOUD ? "On" : "Phase 4"}</span></div>
        <div className="kv"><span>🏷 Version</span><span className="muted">{__BUILD__}</span></div>
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => location.reload()}>↻ Check for update</button>
        {CLOUD && <button className="btn" onClick={signOut}>⎋ Sign out</button>}
      </div>
    </>
  );
}
