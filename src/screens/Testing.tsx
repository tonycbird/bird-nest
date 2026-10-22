import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Report } from "../lib/db";
import { setSetting, useSetting } from "../lib/settings";
import { reportText, saveReport, setReportStatus, shrinkPhoto, snapshot, type Snapshot } from "../lib/testing";
import { schedule } from "../lib/sync";
import { toast } from "../lib/toast";
import { I, Icon, type IconName } from "../ui/Icon";

/* Testing mode: a flag on every screen. Tap it, say what's wrong, done.
   The screen, the last taps and any errors are saved with it, so nothing needs explaining. */

const KINDS: [Report["kind"], string, IconName][] = [["design", "Looks wrong", "edit"], ["stuck", "Stuck", "lock"], ["bug", "Broken", "warn"], ["idea", "Idea", "idea"]];
const POS = "nest:flag-pos";
const k = (c: string) => ({ ["--k" as string]: c }) as CSSProperties;

function loadPos() {
  try { const p = JSON.parse(localStorage.getItem(POS) || "null"); if (p && typeof p.x === "number") return p as { x: number; y: number }; } catch { /* none yet */ }
  return { x: 8, y: Math.max(80, innerHeight - 240) };
}
const clamp = (p: { x: number; y: number }) => ({ x: Math.min(Math.max(4, p.x), innerWidth - 48), y: Math.min(Math.max(40, p.y), innerHeight - 140) });

/** The flag. Drag it anywhere; tap it to report. It sits above every screen and sheet. */
export function TestFlag() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [pos, setPos] = useState(() => clamp(loadPos()));
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const moved = useRef(false);
  useEffect(() => { const f = () => setPos((p) => clamp(p)); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return (
    <>
      {!snap && (
        <button className="tflag" style={{ left: pos.x, top: pos.y }} aria-label="Report a problem"
          onPointerDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moved: false }; moved.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            const dx = e.clientX - d.px, dy = e.clientY - d.py;
            if (!d.moved && Math.hypot(dx, dy) < 6) return;
            d.moved = true; moved.current = true;
            setPos(clamp({ x: d.x + dx, y: d.y + dy }));
          }}
          onPointerUp={() => { if (drag.current?.moved) { try { localStorage.setItem(POS, JSON.stringify(pos)); } catch { /* blocked */ } } drag.current = null; }}
          onClick={() => { if (moved.current) { moved.current = false; return; } setSnap(snapshot()); }}>
          <Icon n="flag" size={20} />
        </button>
      )}
      {snap && <ReportSheet snap={snap} onClose={() => setSnap(null)} />}
    </>
  );
}

function ReportSheet({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const [kind, setKind] = useState<Report["kind"]>("design");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const c = snap.ctx as Record<string, unknown>;
  const where = [String(c.tab), c.overlay ? String(c.overlay) : "", ...((c.open as string[] | undefined) ?? []).slice(0, 2)].filter(Boolean).join(" › ");

  async function save(escape: boolean) {
    setBusy(true);
    await saveReport(snap, kind, text, photo);
    schedule(800);
    const open = await db.reports.where("status").equals("open").count();
    toast(`⚑ Saved · ${open} open`);
    onClose();
    if (escape) window.setTimeout(() => location.reload(), 400);
  }
  return (
    <div className="scrim tscrim" onClick={onClose}>
      <div className="sheet tsheet" role="dialog" aria-label="Report a problem" onClick={(e) => e.stopPropagation()}>
        <h2><span className="ring on" style={k("var(--c-warm)")}><Icon n="flag" size={16} /></span>Report</h2>
        <div className="chips">
          {KINDS.map(([id, label, icon]) => (
            <button key={id} className={"chip" + (kind === id ? " on" : "")} aria-pressed={kind === id} onClick={() => setKind(id)}><Icon n={icon} size={16} />{label}</button>
          ))}
        </div>
        <textarea className="field" rows={3} autoFocus style={{ marginTop: 12, resize: "none" }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={kind === "stuck" ? "Where are you stuck?" : kind === "idea" ? "What would make it better?" : "What's wrong?"} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => file.current?.click()}><I n="camera" /> {photo ? "Change" : "Add screenshot"}</button>
          {photo && <img className="tthumb" src={photo} alt="Screenshot" />}
          <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { setPhoto(await shrinkPhoto(f)); } catch (err) { toast("✕ " + (err as Error).message); }
          }} />
        </div>
        <p className="quiet tctx">Saved with it: {where} · {String(c.look)} · {snap.trail.length} taps{snap.errors.length ? ` · ${snap.errors.length} errors` : ""}</p>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (!text.trim() && !photo)} onClick={() => void save(kind === "stuck")}>{kind === "stuck" ? "Save + get me out" : "Save"}</button>
        </div>
        <button className="linkbtn" style={{ display: "block", margin: "10px auto 0" }} onClick={() => location.reload()}>Stuck? Back to Today</button>
      </div>
    </div>
  );
}

/** Settings → Testing: the switch and the list of reports. */
export function TestingSettings() {
  const on = useSetting<boolean>("testing", false);
  const reports = useLiveQuery(() => db.reports.orderBy("created_at").reverse().filter((r) => !r.deleted_at).toArray(), [], [] as Report[]);
  const open = reports.filter((r) => r.status === "open");
  const [show, setShow] = useState<string | null>(null);
  async function copy() {
    const txt = open.map(reportText).join("\n\n");
    try { await navigator.clipboard.writeText(txt); toast("⧉ Copied. Paste it to Claude."); } catch { toast("✕ Couldn't copy"); }
  }
  return (
    <>
      <div className="lbl">Testing</div>
      <div className="card">
        <label className="kv"><span>Testing mode</span><input type="checkbox" checked={on} onChange={(e) => void setSetting("testing", e.target.checked)} /></label>
        <p className="quiet" style={{ marginTop: 6 }}>Puts a flag on every screen. Tap it when something looks wrong or you're stuck. Drag it out of the way.</p>
      </div>
      {reports.length > 0 && (
        <>
          <div className="lbl">Reports · {open.length} open</div>
          <div className="card trep">
            {reports.slice(0, 40).map((r) => {
              const kd = KINDS.find((x) => x[0] === r.kind);
              const c = r.ctx as Record<string, unknown>;
              return (
                <div key={r.id} className={"trow" + (r.status !== "open" ? " done" : "")}>
                  <button className="trow-main" onClick={() => setShow(show === r.id ? null : r.id)}>
                    <Icon n={kd?.[2] ?? "flag"} size={18} />
                    <span className="grow"><b>{r.text || kd?.[1]}</b><small>{String(c.tab)} · {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>
                    <span className={"pill" + (r.status === "open" ? " warn" : "")}>{r.status === "open" ? "Open" : r.status === "fixed" ? "Fixed" : "Later"}</span>
                  </button>
                  {show === r.id && (
                    <div className="trow-more">
                      {r.fix_note && <p className="quiet">Claude: {r.fix_note}</p>}
                      {r.photo && <img className="tthumb" src={r.photo} alt="Screenshot" />}
                      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {r.status === "open"
                          ? <button className="btn sm" onClick={() => void setReportStatus(r.id, "fixed")}><I n="tick" /> Fixed</button>
                          : <button className="btn sm" onClick={() => void setReportStatus(r.id, "open")}><I n="undo" /> Reopen</button>}
                        {r.status === "open" && <button className="btn sm" onClick={() => void setReportStatus(r.id, "later")}>Later</button>}
                        <button className="btn sm" onClick={() => void db.reports.update(r.id, { deleted_at: new Date().toISOString() })}><I n="trash" /> Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {open.length > 0 && <div className="stack" style={{ marginTop: 10 }}><button className="btn" onClick={() => void copy()}><I n="copy" /> Copy open reports</button></div>}
        </>
      )}
    </>
  );
}
