import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { Area, HeadData, HeadSettings, Task } from "../types";
import { closeOverlay, go, nav, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { ic, Seg } from "./bits";
import { openSheet } from "./sheets";
import { ContextPicker, DatePicker, MovePicker, type MoveResult, type WhenResult } from "./pickers";
import { I } from "../../ui/Icon";
import { pieces } from "../dump-sort";
import { sendToDump } from "./dump";

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
  // Head's lists may still be loading on the first draw: trust the page you're on until they arrive.
  if (r.view === "project" && r.id && (!data.projects.size || data.projects.get(r.id))) return { projectId: r.id };
  if (r.view === "area" && r.id && (!data.areas.size || data.areas.get(r.id))) return { areaId: r.id };
  if (r.view === "someday") return { someday: true };
  return {};
}

function destLabel(f: Partial<Task>, data: HeadData) {
  if (f.projectId) { const p = data.projects.get(f.projectId); return p ? { text: p.name, icon: "📁" } : { text: "Inbox", icon: "📥" }; }
  if (f.areaId) { const a = data.areas.get(f.areaId); return a ? { text: a.name, icon: ic(a.icon) } : { text: "Inbox", icon: "📥" }; }
  if (f.someday) return { text: "Someday", icon: "💤" };
  return { text: "Inbox", icon: "📥" };
}

const Mirror = forwardRef<HTMLDivElement, { text: string; tokens: C.ParseToken[] }>(function Mirror(props, ref) {
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const t of props.tokens) {
    if (t.start > i) parts.push(props.text.slice(i, t.start));
    parts.push(<mark key={t.start} className={t.type}>{props.text.slice(t.start, t.end)}</mark>);
    i = t.end;
  }
  parts.push(props.text.slice(i) + " ");
  return <div ref={ref} className="qa-mirror" aria-hidden="true">{parts}</div>;
});

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
  if (props.hasGroceries) opts.push({ id: "grocery", name: "Grocery" });
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
  const mirror = useRef<HTMLDivElement>(null);
  // Grow with what's typed (a long dictation stays readable) and keep the colored marks lined up with the words.
  useLayoutEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px";
    if (mirror.current) mirror.current.scrollTop = el.scrollTop;
  }, [text]);
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
  // Dump has its own full screen (src/head/ui/dump.tsx).
  const onMode = (m: string) => (m === "dump" ? openOverlay("dump") : setMode(m));
  useEffect(() => { if (mode === "dump") openOverlay("dump"); }, [mode]);

  if (mode === "dump") return null;
  if (mode === "grocery") return <GroceryAdd onMode={onMode} area={groceryArea} />;
  return (
    <div className="qa">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <ModeSwitch mode={mode} onMode={onMode} hasGroceries={!!groceryArea} />
        <button className="iconbtn" aria-label="Close" onClick={closeOverlay}><I n="close" /></button>
      </div>
      <div className="qa-wrap">
        <Mirror ref={mirror} text={text} tokens={parsed.tokens} />
        <textarea ref={ta} className="qa-input" rows={2} value={text} aria-label="New task" placeholder="What's on your mind?"
          onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
          onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }} />
      </div>
      {(parsed.tokens.length > 0 || Object.keys(extra).length > 0) && (
        <div className="chips" style={{ marginTop: 10 }}>
          {parsed.tokens.map((tok) => (
            <span key={tok.start + tok.type} className={"chip tok " + tok.type + (tok.unresolved ? " unresolved" : "")}>
              {tok.label}<button aria-label={(tok.symbol ? "Remove " : "Keep as text: ") + tok.raw} onClick={() => removeToken(tok)}><I n="close" /></button>
            </span>
          ))}
          {extra.when && <span className="chip tok when">{C.relLabel(extra.when)}{extra.tod ? " " + extra.tod : ""}<button aria-label="Remove date" onClick={() => setExtra({ ...extra, when: undefined, tod: undefined })}><I n="close" /></button></span>}
          {extra.someday && <span className="chip tok"><I n="sleep" /><button aria-label="Remove" onClick={() => setExtra({ ...extra, someday: undefined })}><I n="close" /></button></span>}
          {(extra.contexts || []).map((c) => <span key={c} className="chip tok context">{c}<button aria-label={"Remove " + c} onClick={() => setExtra({ ...extra, contexts: extra.contexts!.filter((x) => x !== c) })}><I n="close" /></button></span>)}
          {extra.important && <span className="chip tok important"><I n="flag" /><button aria-label="Remove" onClick={() => setExtra({ ...extra, important: undefined })}><I n="close" /></button></span>}
        </div>
      )}
      {manyThings(text) && (
        <button className="linkbtn qa-many" onClick={() => { sendToDump(text.trim()); setText(""); openOverlay("dump"); }}>
          <I n="layers" /> Looks like a few things · Sort them
        </button>
      )}
      {!text && <div className="qa-hint detail">tomorrow · due fri · +Project · ^Area · @errands · ~30m · ! · every monday</div>}
      <div className="qa-tools">
        <button className="chip" onClick={pickMove} aria-label={"Destination: " + dest.text}>{dest.icon} {dest.text}</button>
        <span style={{ flex: 1 }} />
        <button className="iconbtn" aria-label="When" onClick={pickDate}><I n="calendar" /></button>
        <button className="iconbtn" aria-label="Contexts" onClick={pickCtx}>@</button>
        <button className={"iconbtn" + (fields.important ? " on" : "")} aria-label="Important" onClick={() => setExtra({ ...extra, important: !fields.important || undefined })}><I n="flag" /></button>
        <button className="iconbtn" aria-label="Photo" onClick={() => file.current?.click()}><I n="camera" /></button>
        {speech.supported && <button className={"iconbtn" + (speech.on ? " rec" : "")} aria-label={speech.on ? "Stop" : "Speak"} onClick={speech.on ? speech.stop : speech.start}><I n="mic" /></button>}
        <button aria-label="Save" className="btn primary sm" disabled={!text.trim()} onClick={save}><I n="tick" /></button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); }} />
      </div>
    </div>
  );
}

export function GroceryAdd(props: { onMode: (m: string) => void; area?: Area }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState<{ id: string; title: string; cat: string }[]>([]);
  const inp = useRef<HTMLInputElement>(null);
  if (!props.area) return <div className="qa"><p>No grocery list yet. Turn on <I n="groceries" /> for an area.</p></div>;
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
        <button className="iconbtn" aria-label="Close" onClick={closeOverlay}><I n="close" /></button>
      </div>
      <div className="row">
        <input ref={inp} autoFocus className="field" placeholder="Milk, eggs, 2x4s…" value={text} aria-label="Add to shopping list"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button aria-label="Add" className="btn primary" onClick={add} disabled={!text.trim()}><I n="plus" /></button>
      </div>
      <div className="qa-hint detail">Commas for several.</div>
      <div style={{ marginTop: 10 }}>
        {added.map((a) => (
          <div key={a.id} className="row" style={{ minHeight: 36 }}>
            <span><I n="tick" /></span><span style={{ flex: 1 }}>{a.title}</span><span className="quiet">{catName(a.cat)}</span>
            <button className="iconbtn" aria-label={"Remove " + a.title} onClick={async () => { await H.deleteTask(a.id); setAdded(added.filter((x) => x.id !== a.id)); }}><I n="close" /></button>
          </div>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={() => { closeOverlay(); go("area", area.id); }}><I n="groceries" /> Open list</button>
        <button className="btn primary" onClick={closeOverlay}><I n="tick" /> Done</button>
      </div>
    </div>
  );
}

/** More than one thing in a quick add ("…Tuesday. I'll need a tarp and then…"): offer the dump instead. */
function manyThings(text: string): boolean {
  const t = text.trim();
  return t.length > 40 && pieces(t).length >= 2;
}
