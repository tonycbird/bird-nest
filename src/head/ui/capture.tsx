import { useEffect, useMemo, useRef, useState } from "react";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { Area, HeadData, HeadSettings, Task } from "../types";
import { closeOverlay, go, nav, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { ic, Seg } from "./bits";
import { openSheet } from "./sheets";
import { ContextPicker, DatePicker, MovePicker, type MoveResult, type WhenResult } from "./pickers";

/* Clearhead's capture (src/ui/capture.js): Quick Add with live parsing, Brain dump, Groceries. */

export function parseCtx(data: HeadData, s: HeadSettings, ignore?: Set<string>) {
  return {
    weekStart: s.weekStart ?? 1,
    projects: [...data.projects.values()].filter((p) => p.status !== "done" && p.status !== "archived").map((p) => ({ id: p.id, name: p.name })),
    areas: C.areaList(data).map((a) => ({ id: a.id, name: a.name })),
    contexts: s.contexts || [],
    ignore,
  };
}

export function defaultsForRoute(data: HeadData): Partial<Task> {
  const r = nav.get();
  if (r.view === "today") return { when: C.today() };
  if (r.view === "project" && r.id && data.projects.get(r.id)) return { projectId: r.id };
  if (r.view === "area" && r.id && data.areas.get(r.id)) return { areaId: r.id };
  if (r.view === "someday") return { someday: true };
  return {};
}

function destLabel(f: Partial<Task>, data: HeadData) {
  if (f.projectId) { const p = data.projects.get(f.projectId); return p ? { text: p.name, icon: "📁" } : { text: "Inbox", icon: "📥" }; }
  if (f.areaId) { const a = data.areas.get(f.areaId); return a ? { text: a.name, icon: ic(a.icon) } : { text: "Inbox", icon: "📥" }; }
  if (f.someday) return { text: "Someday", icon: "💤" };
  return { text: "Inbox", icon: "📥" };
}

function Mirror(props: { text: string; tokens: C.ParseToken[] }) {
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const t of props.tokens) {
    if (t.start > i) parts.push(props.text.slice(i, t.start));
    parts.push(<mark key={t.start} className={t.type}>{props.text.slice(t.start, t.end)}</mark>);
    i = t.end;
  }
  parts.push(props.text.slice(i) + " ");
  return <div className="qa-mirror" aria-hidden="true">{parts}</div>;
}

/* Voice: Web Speech if the phone has it inside the installed app, else the keyboard's mic. */
type SR = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void; onend: () => void; start: () => void; stop: () => void };
export function useSpeech(onText: (s: string) => void) {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const rec = useRef<SR | null>(null);
  const start = () => {
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.lang = navigator.language || "en-US";
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(" "));
      r.onerror = () => { setOn(false); toast("🎙 Use the mic on your keyboard instead."); };
      r.onend = () => setOn(false);
      r.start();
      rec.current = r;
      setOn(true);
    } catch { toast("🎙 Use the mic on your keyboard instead."); }
  };
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } setOn(false); };
  return { supported: !!Ctor, on, start, stop };
}

function ModeSwitch(props: { mode: string; onMode: (m: string) => void; hasGroceries: boolean }) {
  const opts = [{ id: "task", name: "Task" }, { id: "dump", name: "Dump" }];
  if (props.hasGroceries) opts.push({ id: "grocery", name: "🛒" });
  return <Seg label="Capture" value={props.mode} onChange={props.onMode} options={opts} />;
}

export function QuickAdd(props: { mode?: string; defaults?: Partial<Task> }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [mode, setMode] = useState(props.mode || "task");
  const [defaults] = useState(() => props.defaults || defaultsForRoute(data));
  const [text, setText] = useState("");
  const [extra, setExtra] = useState<Partial<Task>>({});
  const [base, setBase] = useState<Partial<Task>>(defaults);
  const [ignore, setIgnore] = useState<Set<string>>(new Set());
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const groceryArea = C.areaList(data).find((a) => a.listMode === "groceries");
  const parsed = useMemo(() => C.parseQuickAdd(text, parseCtx(data, s, ignore)), [text, ignore, data, s]);
  useEffect(() => { ta.current?.focus(); }, [mode]);
  const speech = useSpeech((said) => setText((t) => (t ? t + " " : "") + said));

  const fields: Partial<Task> = { ...base, ...parsed.fields, ...extra };
  if (parsed.fields.projectId || extra.projectId) {
    delete fields.areaId;
    if (extra.areaId && !extra.projectId) fields.areaId = extra.areaId;
  }
  if (fields.projectId) { const p = data.projects.get(fields.projectId); if (p) fields.areaId = p.areaId; }
  if (parsed.fields.when || extra.when) delete fields.someday;
  const dest = destLabel(fields, data);

  const removeToken = (tok: C.ParseToken) => {
    if (tok.symbol) setText((x) => (x.slice(0, tok.start) + x.slice(tok.end)).replace(/\s{2,}/g, " "));
    else setIgnore(new Set([...ignore, tok.raw.toLowerCase().trim()]));
    setTimeout(() => ta.current?.focus(), 0);
  };
  const save = async () => {
    const title = parsed.title || text.trim();
    if (!title) return;
    const f = { ...fields, title };
    const t = await H.createTask(f);
    const where = destLabel(f, data).text;
    const when = f.when ? (f.when === C.today() ? "Today" : C.relLabel(f.when)) : null;
    toast(`＋ ${when && where === "Inbox" ? when : where}${when && where !== "Inbox" ? " · " + when : ""}`, () => H.deleteTask(t.id));
    closeOverlay();
  };
  const addPhoto = async (f: File) => {
    const d = new Date();
    const title = parsed.title || text.trim() || `Photo ${C.MON_SHORT[d.getMonth()]} ${d.getDate()}`;
    const t = await H.createTask({ ...fields, title });
    closeOverlay();
    try { await H.addPhoto({ kind: "task", id: t.id }, f); toast("📷 Added"); openTask(t.id); }
    catch (e) { toast("✕ " + (e as Error).message); }
  };
  const pickDate = async () => {
    const r = await openSheet<WhenResult>(DatePicker, { value: fields.when ?? null, mode: "when" });
    if (r !== undefined) setExtra({ ...extra, when: r.when, tod: r.tod ?? null, someday: r.someday });
  };
  const pickMove = async () => {
    const r = await openSheet<MoveResult>(MovePicker, {});
    if (r !== undefined) { setBase({}); setExtra({ ...extra, areaId: r.areaId, projectId: r.projectId, sectionId: r.sectionId, list: null }); }
  };
  const pickCtx = async () => {
    const r = await openSheet<string[]>(ContextPicker, { value: fields.contexts || [] });
    if (r !== undefined) setExtra({ ...extra, contexts: r });
  };
  const onMode = (m: string) => (m === "dump" ? setMode("dump") : setMode(m));

  if (mode === "dump") return <BrainDump onMode={setMode} hasGroceries={!!groceryArea} />;
  if (mode === "grocery") return <GroceryAdd onMode={onMode} area={groceryArea} />;
  return (
    <div className="qa">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <ModeSwitch mode={mode} onMode={onMode} hasGroceries={!!groceryArea} />
        <button className="iconbtn" aria-label="Close" onClick={closeOverlay}>✕</button>
      </div>
      <div className="qa-wrap">
        <Mirror text={text} tokens={parsed.tokens} />
        <textarea ref={ta} className="qa-input" rows={2} value={text} aria-label="New task" placeholder="What's on your mind?"
          onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }} />
      </div>
      {(parsed.tokens.length > 0 || Object.keys(extra).length > 0) && (
        <div className="chips" style={{ marginTop: 10 }}>
          {parsed.tokens.map((tok) => (
            <span key={tok.start + tok.type} className={"chip tok " + tok.type + (tok.unresolved ? " unresolved" : "")}>
              {tok.label}<button aria-label={(tok.symbol ? "Remove " : "Keep as text: ") + tok.raw} onClick={() => removeToken(tok)}>✕</button>
            </span>
          ))}
          {extra.when && <span className="chip tok when">{C.relLabel(extra.when)}{extra.tod ? " " + extra.tod : ""}<button aria-label="Remove date" onClick={() => setExtra({ ...extra, when: undefined, tod: undefined })}>✕</button></span>}
          {extra.someday && <span className="chip tok">💤<button aria-label="Remove" onClick={() => setExtra({ ...extra, someday: undefined })}>✕</button></span>}
          {(extra.contexts || []).map((c) => <span key={c} className="chip tok context">{c}<button aria-label={"Remove " + c} onClick={() => setExtra({ ...extra, contexts: extra.contexts!.filter((x) => x !== c) })}>✕</button></span>)}
          {extra.important && <span className="chip tok important">⚑<button aria-label="Remove" onClick={() => setExtra({ ...extra, important: undefined })}>✕</button></span>}
        </div>
      )}
      {!text && <div className="qa-hint detail">tomorrow · due fri · +Project · ^Area · @errands · ~30m · ! · every monday</div>}
      <div className="qa-tools">
        <button className="chip" onClick={pickMove} aria-label={"Destination: " + dest.text}>{dest.icon} {dest.text}</button>
        <span style={{ flex: 1 }} />
        <button className="iconbtn" aria-label="When" onClick={pickDate}>📅</button>
        <button className="iconbtn" aria-label="Contexts" onClick={pickCtx}>@</button>
        <button className={"iconbtn" + (fields.important ? " on" : "")} aria-label="Important" onClick={() => setExtra({ ...extra, important: !fields.important || undefined })}>⚑</button>
        <button className="iconbtn" aria-label="Photo" onClick={() => file.current?.click()}>📷</button>
        {speech.supported && <button className={"iconbtn" + (speech.on ? " rec" : "")} aria-label={speech.on ? "Stop" : "Speak"} onClick={speech.on ? speech.stop : speech.start}>🎙</button>}
        <button className="btn primary sm" disabled={!text.trim()} onClick={save}>✓</button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); }} />
      </div>
    </div>
  );
}

export function BrainDump(props: { onMode?: (m: string) => void; hasGroceries?: boolean; onDone?: (ids: string[]) => void; standalone?: boolean }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [text, setText] = useState("");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const save = async () => {
    const ctx = parseCtx(data, s);
    const ids: string[] = [];
    for (const l of lines) {
      const p = C.parseQuickAdd(l, ctx);
      ids.push((await H.createTask({ ...p.fields, title: p.title || l })).id);
    }
    toast(`📥 ${ids.length} to Inbox`, async () => { for (const id of ids) await H.deleteTask(id); });
    if (props.onDone) props.onDone(ids);
    else closeOverlay();
  };
  return (
    <div className="qa">
      {!props.standalone && (
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <ModeSwitch mode="dump" onMode={props.onMode || (() => {})} hasGroceries={!!props.hasGroceries} />
          <button className="iconbtn" aria-label="Close" onClick={closeOverlay}>✕</button>
        </div>
      )}
      <textarea className="dump" autoFocus aria-label="Brain dump" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One thing per line\nCall Smith about the vanity\nGreek reading ch. 4 due fri\nBuy furnace filter @errands"} />
      <div className="qa-hint detail">Each line → Inbox. Dates and @tags work. The keyboard mic works well here.</div>
      {!props.standalone && <button className="linkbtn" onClick={() => openOverlay("ramble")}>🗣 Ramble about one thing instead</button>}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="quiet" style={{ flex: 1 }}>{lines.length ? `${lines.length} item${lines.length === 1 ? "" : "s"}` : ""}</span>
        <button className="btn primary" disabled={!lines.length} onClick={save}>📥 Add</button>
      </div>
    </div>
  );
}

export function GroceryAdd(props: { onMode: (m: string) => void; area?: Area }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState<{ id: string; title: string; cat: string }[]>([]);
  const inp = useRef<HTMLInputElement>(null);
  if (!props.area) return <div className="qa"><p>No grocery list yet. Turn on 🛒 for an area.</p></div>;
  const area = props.area;
  const add = async () => {
    const v = text.trim();
    if (!v) return;
    const made: { id: string; title: string; cat: string }[] = [];
    for (const title of v.split(/\s*,\s*/).filter(Boolean)) {
      const t = await H.addGrocery(title, area.id);
      if (t) made.push({ id: t.id, title: t.title, cat: t.grocery!.cat });
    }
    setAdded([...made, ...added]);
    setText("");
    inp.current?.focus();
  };
  const catName = (id: string) => C.GROCERY_CATS.find((c) => c.id === id)?.name;
  return (
    <div className="qa">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <ModeSwitch mode="grocery" onMode={props.onMode} hasGroceries />
        <button className="iconbtn" aria-label="Close" onClick={closeOverlay}>✕</button>
      </div>
      <div className="row">
        <input ref={inp} autoFocus className="field" placeholder="Milk, eggs, 2x4s…" value={text} aria-label="Add to shopping list"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button className="btn primary" onClick={add} disabled={!text.trim()}>＋</button>
      </div>
      <div className="qa-hint detail">Commas for several.</div>
      <div style={{ marginTop: 10 }}>
        {added.map((a) => (
          <div key={a.id} className="row" style={{ minHeight: 36 }}>
            <span>✓</span><span style={{ flex: 1 }}>{a.title}</span><span className="quiet">{catName(a.cat)}</span>
            <button className="iconbtn" aria-label={"Remove " + a.title} onClick={async () => { await H.deleteTask(a.id); setAdded(added.filter((x) => x.id !== a.id)); }}>✕</button>
          </div>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={() => { closeOverlay(); go("area", area.id); }}>🛒 Open list</button>
        <button className="btn primary" onClick={closeOverlay}>✓ Done</button>
      </div>
    </div>
  );
}
