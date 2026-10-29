import { sameTask } from "../same";
import { useEffect, useRef, useState } from "react";
import { once } from "../../lib/once";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { Area, ChecklistItem, HeadData, Task } from "../types";
import { closeOverlay, go, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { Check, ic, Ring, Seg } from "./bits";
import { FlowShell } from "./flows";
import { openSheet } from "./sheets";
import { DatePicker, type WhenResult } from "./pickers";
import { I } from "../../ui/Icon";

/* Clearhead's Ramble (src/flows/ramble.js): talk about ONE thing, get to-dos, materials and notes.
   Sorting runs on the phone (splitRamble). Claude's smarter sort returns in Phase 4 via the scheduled tasks. */

type Focus = { kind: "project" | "task"; id: string } | { kind: "new"; name: string };
interface Todo { id: string; title: string; when: string | null; due: string | null; contexts: string[]; est: number | null; waitingOn: string | null; phase: string | null; note: string | null; keep: boolean; }

const DRAFT = "nest-ramble-draft";
const loadDraft = (): { focus: Focus; text: string; at: number } | null => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || "null"); return d && Date.now() - d.at < 3 * 864e5 ? d : null; } catch { return null; }
};
const saveDraft = (d: { focus: Focus; text: string } | null) => {
  try { if (d) localStorage.setItem(DRAFT, JSON.stringify({ ...d, at: Date.now() })); else localStorage.removeItem(DRAFT); } catch { /* private mode */ }
};

function focusInfo(f: Focus | null, data: HeadData): { name: string; area: Area | null } | null {
  if (!f) return null;
  if (f.kind === "project") { const p = data.projects.get(f.id); return p ? { name: p.name, area: p.areaId ? data.areas.get(p.areaId) ?? null : null } : null; }
  if (f.kind === "task") { const t = data.tasks.get(f.id); return t ? { name: t.title, area: C.areaOfTask(t, data) } : null; }
  return { name: (f as { name: string }).name, area: null };
}

function Pick({ onPick }: { onPick: (f: Focus) => void }) {
  const { data } = useHeadData();
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const projects = C.activeProjects(data).filter((p) => !ql || p.name.toLowerCase().includes(ql));
  const tasks = ql ? [...data.tasks.values()].filter((t) => C.isOpen(t) && !t.grocery && !t.list && t.title.toLowerCase().includes(ql)).slice(0, 6) : [];
  const exact = projects.some((p) => p.name.toLowerCase() === ql) || tasks.some((t) => t.title.toLowerCase() === ql);
  return (
    <>
      <h2>What's on your mind?</h2>
      <p className="lede detail">Pick one thing. Ramble about it. Get the to-dos.</p>
      <input className="field" autoFocus placeholder="Backyard redo, Smith bath, midterm…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { const p = projects.find((x) => x.name.toLowerCase() === ql); onPick(p ? { kind: "project", id: p.id } : { kind: "new", name: q.trim() }); } }} />
      <div className="qd" style={{ marginTop: 10 }}>
        {q.trim() && !exact && <button onClick={() => onPick({ kind: "new", name: q.trim() })}><span><I n="plus" /></span><span className="grow" style={{ textAlign: "left" }}>New: <b>{q.trim()}</b></span><span className="side" /></button>}
        {projects.slice(0, ql ? 8 : 6).map((p) => <button key={p.id} onClick={() => onPick({ kind: "project", id: p.id })}><span><Ring pct={C.projectStats(data, p).pct} size={20} /></span>{p.name}<span className="side">{p.areaId ? data.areas.get(p.areaId)?.name : ""}</span></button>)}
        {tasks.map((t) => <button key={t.id} onClick={() => onPick({ kind: "task", id: t.id })}><span>○</span>{t.title}<span className="side">{(C.homeOf(t, data).project || C.homeOf(t, data).area)?.name || "Inbox"}</span></button>)}
      </div>
      <div className="row" style={{ justifyContent: "center", marginTop: 16 }}><button className="linkbtn" onClick={() => openOverlay("dump")}>Dump everything instead</button></div>
    </>
  );
}

/* Continuous dictation where the phone supports it; otherwise the keyboard mic. */
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SR = { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { resultIndex: number; results: ArrayLike<SRResult> }) => void; onerror: () => void; onend: () => void; start: () => void; stop: () => void };
export function useDictation(onFinal: (s: string) => void) {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<SR | null>(null);
  const want = useRef(false);
  const start = () => {
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let fin = "", mid = "";
        for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript; else mid += e.results[i][0].transcript; }
        if (fin) onFinal(fin.trim());
        setInterim(mid);
      };
      r.onerror = () => { want.current = false; setOn(false); toast("🎙 Use the mic on your keyboard instead."); };
      r.onend = () => { if (want.current) { try { r.start(); } catch { setOn(false); } } else setOn(false); };
      want.current = true;
      r.start();
      rec.current = r;
      setOn(true);
    } catch { toast("🎙 Use the mic on your keyboard instead."); }
  };
  const stop = () => { want.current = false; try { rec.current?.stop(); } catch { /* stopped */ } setOn(false); setInterim(""); };
  useEffect(() => () => { want.current = false; try { rec.current?.stop(); } catch { /* stopped */ } }, []);
  return { supported: !!Ctor, on, interim, start, stop };
}

function TodoRow({ t, onChange, estimates }: { t: Todo; onChange: (t: Todo) => void; estimates: boolean }) {
  const set = (p: Partial<Todo>) => onChange({ ...t, ...p });
  return (
    <div className="ramble-row">
      <Check square on={t.keep} onToggle={(v) => set({ keep: v })} label={t.keep ? "Leave out" : "Keep"} />
      <div className="grow" style={t.keep ? undefined : { opacity: 0.45 }}>
        <textarea className="ramble-title" rows={1} value={t.title} aria-label="To-do" onChange={(e) => set({ title: e.target.value })} />
        <div className="chips" style={{ gap: 5 }}>
          {t.when && <span className="chip tok when"><button onClick={async () => { const r = await openSheet<WhenResult>(DatePicker, { value: t.when, mode: "when" }); if (r !== undefined) set({ when: r.when }); }}><I n="calendar" /> {C.relLabel(t.when)}</button><button aria-label="Remove date" onClick={() => set({ when: null })}><I n="close" /></button></span>}
          {t.due && <span className="chip tok due"><I n="flag" /> {C.relLabel(t.due)}<button aria-label="Remove deadline" onClick={() => set({ due: null })}><I n="close" /></button></span>}
          {t.waitingOn && <span className="chip tok"><I n="waiting" /> {t.waitingOn}<button aria-label="Remove" onClick={() => set({ waitingOn: null })}><I n="close" /></button></span>}
          {t.est && estimates && <span className="chip tok"><I n="timer" /> {C.fmtMinutes(t.est)}<button aria-label="Remove" onClick={() => set({ est: null })}><I n="close" /></button></span>}
          {t.contexts.map((c) => <span key={c} className="chip tok context">{c}<button aria-label={"Remove " + c} onClick={() => set({ contexts: t.contexts.filter((x) => x !== c) })}><I n="close" /></button></span>)}
          {t.phase && <span className="chip tok">≡ {t.phase}<button aria-label="Remove" onClick={() => set({ phase: null })}><I n="close" /></button></span>}
          {!t.when && !t.due && t.keep && <button className="linkbtn sm" onClick={async () => { const r = await openSheet<WhenResult>(DatePicker, { value: null, mode: "when" }); if (r !== undefined) set({ when: r.when }); }}><I n="plus" /> date</button>}
        </div>
        {t.note && <div className="quiet">{t.note}</div>}
      </div>
    </div>
  );
}

export function Ramble(props: { focus?: Focus }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [draft] = useState(() => (props.focus ? null : loadDraft()));
  const [focus, setFocus] = useState<Focus | null>(props.focus || draft?.focus || null);
  const [text, setText] = useState(() => {
    const d = loadDraft();
    return d && props.focus && JSON.stringify(d.focus) === JSON.stringify(props.focus) ? d.text : draft ? draft.text : "";
  });
  const [step, setStep] = useState<"pick" | "ramble" | "review">(focus ? "ramble" : "pick");
  const [rows, setRows] = useState<Todo[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"project" | "steps">("steps");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [matToGroceries, setMatToGroceries] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [newMat, setNewMat] = useState("");
  const info = focusInfo(focus, data);
  const dict = useDictation((said) => setText((x) => (x && !/\s$/.test(x) ? x + " " : x) + said));
  useEffect(() => { if (focus && text) saveDraft({ focus, text }); }, [text, focus]);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const groceryArea = C.areaList(data).find((a) => a.listMode === "groceries");
  const firstPlainArea = () => C.areaList(data).find((a) => !a.listMode)?.id || null;

  const pick = (f: Focus) => { setFocus(f); if (f.kind === "new") setAreaId(firstPlainArea()); setStep("ramble"); };
  const sort = () => {
    const ctx = { weekStart: s.weekStart ?? 1, contexts: s.contexts || [], projects: [], areas: [] };
    const r = C.splitRamble(text, ctx);
    // Don't repeat what's already on the list (Clearhead told Claude the same thing).
    const existing = new Set((focus!.kind === "project"
      ? C.projectTasks(data, focus!.id).filter(C.isOpen).map((t) => t.title)
      : focus!.kind === "task" ? (data.tasks.get(focus!.id)?.checklist || []).filter((c) => !c.done).map((c) => c.text) : []).map((x) => x.toLowerCase().trim()));
    setRows(r.todos.map((t) => ({ ...t, id: C.uid("r"), keep: ![...existing].some((x) => sameTask(x, t.title)) })));
    setMaterials(r.materials);
    setNotes(r.notes.map((n) => "- " + n).join("\n"));
    const n = r.todos.length;
    setMode(focus!.kind === "project" ? "project" : focus!.kind === "task" ? (n >= 5 || r.todos.some((t) => t.when || t.due) ? "project" : "steps") : n >= 4 ? "project" : "steps");
    if (focus!.kind === "new" && !areaId) setAreaId(firstPlainArea());
    setStep("review");
  };
  const kept = rows.filter((r) => r.keep && r.title.trim());

  const save = async () => {
    if (!focus) return;
    // The draft was about a project or task that's since been deleted: say so and let him pick again.
    if (!info) { toast("That project or task is gone. Pick where this goes."); setFocus(null); setStep("pick"); return; }
    const d = new Date();
    const stamp = `From a ramble · ${C.MON_SHORT[d.getMonth()]} ${d.getDate()}`;
    const noteLines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
    const notesBlock = noteLines.length ? `### ${stamp}\n${noteLines.map((l) => (/^[-*] /.test(l) ? l : "- " + l)).join("\n")}` : "";
    const appendNotes = (old: string) => [old || "", notesBlock].filter(Boolean).join("\n\n");
    const undos: (() => Promise<unknown>)[] = [];
    const created: string[] = [];
    const t0 = C.today();
    let dest: { project?: string; task?: string; name: string } | null = null;
    const makeTasks = async (pid: string, byPhase: Record<string, string>) => {
      let order = Date.now();
      for (const r of kept) {
        const t = await H.createTask({
          title: r.title.trim(), projectId: pid, sectionId: r.phase ? byPhase[r.phase.toLowerCase()] || null : null,
          when: r.when, due: r.due, contexts: r.contexts, est: r.est, notes: r.note || "", order: order++,
          waiting: r.waitingOn ? { who: r.waitingOn, since: t0, followUp: C.addDays(t0, 3) } : null,
        });
        created.push(t.id);
      }
      if (materials.length) {
        if (matToGroceries && groceryArea) for (const m of materials) { const g = await H.addGrocery(m, groceryArea.id); if (g) created.push(g.id); }
        else created.push((await H.createTask({ title: "Buy materials", projectId: pid, contexts: (s.contexts || []).includes("@Errands") ? ["@Errands"] : [], order: order++, checklist: materials.map((m) => ({ id: C.uid("c"), text: m, done: false })) })).id);
      }
    };
    const phaseSections = (existing: { id: string; name: string }[]) => {
      const phases = [...new Set(kept.map((r) => r.phase).filter(Boolean) as string[])];
      const map: Record<string, string> = {};
      const secs = [...(existing || [])];
      if (phases.length >= 2 || secs.length) for (const ph of phases) {
        let sec = secs.find((x) => x.name.toLowerCase() === ph.toLowerCase());
        if (!sec) { sec = { id: C.uid("sec"), name: ph }; secs.push(sec); }
        map[ph.toLowerCase()] = sec.id;
      }
      return { secs, map };
    };
    if (focus.kind === "project") {
      const p = data.projects.get(focus.id)!;
      const { secs, map } = phaseSections(p.sections);
      const before = { notes: p.notes, sections: p.sections };
      if (secs.length !== (p.sections || []).length) await H.updateSections(p.id, secs);
      if (notesBlock) await H.updateProject(p.id, { notes: appendNotes(p.notes) });
      await makeTasks(p.id, map);
      undos.push(() => H.updateProject(p.id, before));
      dest = { project: p.id, name: p.name };
    } else if (mode === "project") {
      const t = focus.kind === "task" ? data.tasks.get(focus.id) ?? null : null;
      const area = t ? C.areaOfTask(t, data) : areaId ? data.areas.get(areaId) ?? null : null;
      const { secs, map } = phaseSections([]);
      const pid = await H.createProject({ name: info.name, areaId: area ? area.id : null, sections: secs, notes: appendNotes(t ? t.notes : "") });
      await makeTasks(pid, map);
      undos.push(() => H.deleteProject(pid));
      if (t) undos.push(await H.deleteTask(t.id));
      dest = { project: pid, name: info.name };
    } else {
      let t: Task | null = focus.kind === "task" ? data.tasks.get(focus.id) ?? null : null;
      const steps: ChecklistItem[] = kept.map((r) => ({ id: C.uid("c"), text: r.title.trim(), done: false }));
      const handyArea = t && /handyman|business/i.test(C.areaOfTask(t, data)?.name || "");
      if (t) {
        const before = { checklist: t.checklist, notes: t.notes, handy: t.handy };
        const patch: Partial<Task> = { checklist: [...(t.checklist || []), ...steps] };
        if (notesBlock) patch.notes = appendNotes(t.notes);
        if (materials.length) {
          if (matToGroceries && groceryArea) for (const m of materials) { const g = await H.addGrocery(m, groceryArea.id); if (g) created.push(g.id); }
          else if (handyArea || t.handy) patch.handy = { ...(t.handy || {}), materials: [...(t.handy?.materials || []), ...materials.map((m) => ({ id: C.uid("c"), text: m, done: false }))] };
          else patch.checklist = [...patch.checklist!, ...materials.map((m) => ({ id: C.uid("c"), text: "Buy " + m, done: false }))];
        }
        await H.updateTask(t.id, patch);
        const tid = t.id;
        undos.push(() => H.updateTask(tid, before));
      } else {
        const area = areaId ? data.areas.get(areaId) : null;
        if (materials.length && matToGroceries && groceryArea) for (const m of materials) { const g = await H.addGrocery(m, groceryArea.id); if (g) created.push(g.id); }
        const mats = materials.length && !(matToGroceries && groceryArea) ? materials.map((m) => ({ id: C.uid("c"), text: "Buy " + m, done: false })) : [];
        const earliestDue = kept.map((r) => r.due).filter(Boolean).sort()[0] || null;
        const whenNew = C.parseQuickAdd(info.name, { today: C.today() }).fields.when || kept.map((r) => r.when).filter(Boolean).sort()[0] || null;
        t = await H.createTask({ title: info.name, areaId: area ? area.id : null, checklist: [...steps, ...mats], notes: notesBlock, due: earliestDue, when: whenNew });
        created.push(t.id);
      }
      dest = { task: t.id, name: t.title || info.name };
    }
    undos.push(async () => { for (const id of created) await H.deleteTask(id); });
    saveDraft(null);
    closeOverlay();
    if (dest.project) go("project", dest.project);
    else if (dest.task) openTask(dest.task);
    toast(`✓ ${kept.length} to ${dest.name}`, async () => { for (const u of undos.reverse()) await u(); });
  };

  if (step === "pick") return <FlowShell title="🗣 Ramble"><Pick onPick={pick} /></FlowShell>;
  const chip = info && (
    <div className="ramble-focus">
      <span>{focus!.kind === "project" ? "📁" : focus!.kind === "task" ? "○" : "✦"}</span>
      <span className="grow"><span className="quiet">{focus!.kind === "project" ? "Project" : focus!.kind === "task" ? "Task" : "New"}</span> <b>{info.name}</b></span>
      <button className="linkbtn" onClick={() => setStep("pick")}>Change</button>
    </div>
  );
  if (step === "ramble") {
    return (
      <FlowShell title="🗣 Ramble" onBack={() => setStep("pick")} foot={<><span className="quiet grow">{draft && text === draft.text && text ? "Picked up where you left off" : ""}</span><button className="btn primary" disabled={words < 3} onClick={sort}><I n="sort" /> Sort it</button></>}>
        {chip}
        <h2>Ramble about it</h2>
        <p className="lede detail">What to do, buy, call, worry about. Don't organize. That's the app's job.</p>
        <textarea className="dump ramble-box" autoFocus aria-label="Your ramble" value={text} onChange={(e) => setText(e.target.value)} placeholder={focus?.kind === "project" ? "Okay so for this one… first I need to…" : "Just start talking…"} />
        {dict.interim && <div className="quiet" style={{ fontStyle: "italic" }}>{dict.interim}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          {dict.supported && <button className={"btn sm" + (dict.on ? " rec" : "")} onClick={dict.on ? dict.stop : dict.start}><I n="mic" /> {dict.on ? "Listening · stop" : "Talk"}</button>}
          <span className="quiet">{dict.supported ? "Or the" : "Tip: the"} keyboard mic works.</span>
        </div>
      </FlowShell>
    );
  }
  const datesLost = mode === "steps" && kept.some((r) => r.when || r.due || r.waitingOn);
  return (
    <FlowShell title="🗣 Ramble" onBack={() => setStep("ramble")} foot={<>
      <button className="btn" onClick={() => setStep("ramble")}><I n="edit" /> More</button><span style={{ flex: 1 }} />
      <button className="btn primary" disabled={!kept.length && !materials.length && !notes.trim()} onClick={() => void once("ramble-save", save)}>{focus!.kind === "project" ? "＋ To project" : mode === "project" ? "📁 Create project" : focus!.kind === "task" ? "＋ To task" : "＋ Create task"}</button>
    </>}>
      {chip}
      <h2>Here's what I heard</h2>
      <p className="lede detail">Edit, uncheck what you don't want. Nothing is added until you say so.</p>
      {!rows.length && <div className="card quiet">No to-dos stood out. Add your own, or keep rambling.</div>}
      <div className="ramble-list">{rows.map((r) => <TodoRow key={r.id} t={r} estimates={s.features.estimates} onChange={(nr) => setRows(rows.map((x) => (x.id === nr.id ? nr : x)))} />)}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="field sm" placeholder="Add a to-do" value={newTodo} onChange={(e) => setNewTodo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTodo.trim()) { setRows([...rows, { id: C.uid("r"), title: newTodo.trim(), keep: true, contexts: [], when: null, due: null, est: null, waitingOn: null, phase: null, note: null }]); setNewTodo(""); } }} />
      </div>
      <section className="hsec"><div className="sec-head"><span><I n="box" /></span><span className="grow">Materials</span></div>
        {materials.length ? <div className="chips">{materials.map((m, i) => <span className="chip" key={m + i}>{m}<button aria-label={"Remove " + m} onClick={() => setMaterials(materials.filter((_, j) => j !== i))}><I n="close" /></button></span>)}</div> : <div className="quiet">None mentioned.</div>}
        <input className="field sm" style={{ marginTop: 8 }} placeholder="Add a material" value={newMat} onChange={(e) => setNewMat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newMat.trim()) { setMaterials([...materials, newMat.trim()]); setNewMat(""); } }} />
        {materials.length > 0 && groceryArea && <label className="row" style={{ marginTop: 8, fontSize: 14 }}><input type="checkbox" checked={matToGroceries} onChange={(e) => setMatToGroceries(e.target.checked)} /><I n="groceries" /> On the {groceryArea.name} list instead</label>}
      </section>
      <section className="hsec"><div className="sec-head"><span><I n="edit" /></span><span className="grow">Notes worth keeping</span></div>
        <textarea className="field sm" rows={4} value={notes} placeholder="Measurements, prices, names…" onChange={(e) => setNotes(e.target.value)} />
      </section>
      {focus!.kind !== "project" && (
        <section className="hsec"><div className="sec-head"><span className="grow">Where it goes</span></div>
          <Seg label="How to add" value={mode} onChange={setMode} options={focus!.kind === "task" ? [{ id: "steps", name: "Steps in this task" }, { id: "project", name: "Make a project" }] : [{ id: "project", name: "New project" }, { id: "steps", name: "One task + steps" }]} />
          {focus!.kind === "new" && (
            <select className="field sm" style={{ marginTop: 8 }} value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value || null)}>
              <option value="">Inbox</option>{C.areaList(data).map((a) => <option key={a.id} value={a.id}>{ic(a.icon)} {a.name}</option>)}
            </select>
          )}
          {datesLost && <p className="quiet" style={{ marginTop: 6 }}>Steps can't hold dates. Pick “project” to keep them.</p>}
        </section>
      )}
    </FlowShell>
  );
}
