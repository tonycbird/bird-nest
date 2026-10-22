import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { db } from "../../lib/db";
import { toast } from "../../lib/toast";
import type { ChecklistItem, Project, Task } from "../types";
import { closeTask, nav, openOverlay, useHeadData, useHeadSettings } from "../useHead";
import { Check, ic } from "./bits";
import * as A from "./actions";
import { putTaskOnRiver } from "../river-bridge";
import { I } from "../../ui/Icon";

/* Clearhead's task detail (src/ui/detail.js): title, notes, checklist, the property rows,
   job details for handyman work, photos and the activity log. Opens as a tall sheet. */

export function DetailHost() {
  const sel = nav.use().selected;
  const task = useLiveQuery(() => (sel ? db.tasks.get(sel) : undefined), [sel]);
  if (!sel || !task) return null;
  return (
    <div className="scrim" style={{ zIndex: 35 }} onClick={closeTask}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Task">
        <TaskDetail key={task.id} task={task} />
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

export function NotesEditor(props: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value || "");
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setDraft(props.value || ""); }, [props.value, editing]);
  useEffect(() => { if (editing) { autosize(ta.current); ta.current?.focus(); } }, [editing]);
  if (!editing) {
    if (!props.value) return <button className="notes-empty" onClick={() => setEditing(true)}>{props.placeholder || "✎ Notes"}</button>;
    return (
      <div className="notes-md" onClick={(e) => {
        const b = (e.target as HTMLElement).closest("[data-line]") as HTMLElement | null;
        if (b) { e.stopPropagation(); props.onSave(C.toggleNoteLine(props.value, Number(b.dataset.line))); return; }
        if ((e.target as HTMLElement).closest("a")) return;
        setEditing(true);
      }} dangerouslySetInnerHTML={{ __html: C.renderNotes(props.value) }} />
    );
  }
  return (
    <textarea ref={ta} className="notes-edit" value={draft} placeholder="Notes · - [ ] for a checkbox"
      onChange={(e) => { setDraft(e.target.value); autosize(e.target); }}
      onBlur={() => { setEditing(false); if (draft !== (props.value || "")) props.onSave(draft); }} />
  );
}

/* A step's text is typed into local state and saved when the field is left (or on Enter). Saving every
   keystroke to the database made the cursor jump to the end and could drop letters while typing fast. */
function StepText(props: { text: string; onSave: (t: string) => void; onEmpty: () => void }) {
  const [v, setV] = useState(props.text);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(props.text); }, [props.text]);
  return (
    <input value={v} aria-label="Step" onFocus={() => { focused.current = true; }} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => { focused.current = false; const t = v.trim(); if (!t) props.onEmpty(); else if (t !== props.text) props.onSave(t); }} />
  );
}

export function Checklist(props: { items: ChecklistItem[]; onChange: (x: ChecklistItem[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const items = props.items || [];
  const set = (id: string, patch: Partial<ChecklistItem>) => props.onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const add = (text: string) => props.onChange([...items, { id: C.uid("c"), text, done: false }]);
  return (
    <div className="subtasks">
      {items.map((c) => (
        <div key={c.id} className={"subtask" + (c.done ? " done" : "")}>
          <Check square on={c.done} onToggle={(v) => set(c.id, { done: v })} />
          <StepText text={c.text} onSave={(t) => set(c.id, { text: t })} onEmpty={() => props.onChange(items.filter((x) => x.id !== c.id))} />
        </div>
      ))}
      <div className="subtask">
        <span className="plus"><I n="plus" /></span>
        <input value={draft} placeholder={props.placeholder || "Add a step"} aria-label={props.placeholder || "Add a step"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { add(draft.trim()); setDraft(""); } }}
          onBlur={() => { if (draft.trim()) { add(draft.trim()); setDraft(""); } }} />
      </div>
    </div>
  );
}

function Prop(props: { icon: string; label: string; value: React.ReactNode; placeholder?: string; onClick: () => void; onClear?: () => void; hot?: boolean }) {
  const has = props.value != null && props.value !== "";
  return (
    <div className={"pr" + (props.hot ? " hot" : "")}>
      <button className="pr-main" onClick={props.onClick}>
        <span className="pr-ic">{props.icon}</span>
        <span className="pr-label">{props.label}</span>
        <span className={"pr-val" + (has ? "" : " ph")}>{has ? props.value : props.placeholder || "—"}</span>
      </button>
      {has && props.onClear && <button className="pr-x" aria-label={"Clear " + props.label} onClick={props.onClear}><I n="close" /></button>}
    </div>
  );
}

function HandyBlock(props: { task: Task; project: Project | null }) {
  const t = props.task;
  const h = t.handy || {};
  const client = props.project?.client ?? null;
  const name = h.client || client?.name || "";
  const address = h.address || client?.address || "";
  const phone = h.phone || client?.phone || "";
  const price = h.price ?? client?.price ?? "";
  const save = (patch: Partial<NonNullable<Task["handy"]>>) => H.updateTask(t.id, { handy: { ...h, ...patch } });
  const digits = String(phone).replace(/[^\d+]/g, "");
  const field = (key: "client" | "address" | "phone" | "price", val: string, ph: string, icon: string, type = "text") => (
    <div className="row hf"><span>{icon}</span>
      <input className="bare" type={type} placeholder={ph} defaultValue={val} aria-label={ph} onBlur={(e) => { if (e.target.value !== val) void save({ [key]: e.target.value }); }} />
    </div>
  );
  return (
    <div className="dblock">
      <div className="dhead"><I n="job" /> Job{client && !t.handy ? <span className="quiet"> · from project</span> : null}</div>
      <div className="card" style={{ padding: "4px 14px" }}>
        {field("client", name, "Client", "👤")}
        {field("address", address, "Address", "📍")}
        {address && <div className="hlinks"><a href={"https://maps.apple.com/?q=" + encodeURIComponent(address)} target="_blank" rel="noopener">Maps</a></div>}
        {field("phone", phone, "Phone", "📞", "tel")}
        {phone && <div className="hlinks"><a href={"tel:" + digits}>Call</a><a href={"sms:" + digits}>Text</a></div>}
        {field("price", String(price), "Price ($)", "💲")}
      </div>
      <div className="dhead" style={{ marginTop: 12 }}><I n="box" /> Materials</div>
      <Checklist items={h.materials || []} placeholder="Add material" onChange={(materials) => void save({ materials })} />
    </div>
  );
}

function PhotoStrip(props: { owner: { kind: "task" | "project"; id: string }; photos: string[] }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const photos = useLiveQuery(() => db.photos.bulkGet(props.photos || []), [props.photos.join(",")], []);
  return (
    <div className="photos">
      {photos.map((p, i) => p ? (
        <button key={p.id} className="photo" onClick={() => setOpen(p.id)}><img src={p.thumb || p.data} alt="" /></button>
      ) : <div key={i} className="photo missing">?</div>)}
      <button className="photo add" aria-label="Add photo" disabled={busy} onClick={() => file.current?.click()}>{busy ? "…" : "📷"}</button>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={async (e) => {
        const files = [...(e.target.files || [])];
        e.target.value = "";
        setBusy(true);
        try { for (const f of files) await H.addPhoto(props.owner, f); } catch (err) { toast("✕ " + (err as Error).message); }
        setBusy(false);
      }} />
      {open && (() => {
        const p = photos.find((x) => x?.id === open);
        if (!p) return null;
        return (
          <div className="lightbox" onClick={() => setOpen(null)}>
            <img src={p.data} alt="" />
            <div className="lb-bar">
              <button aria-label="Remove photo" className="btn sm" onClick={async (e) => { e.stopPropagation(); setOpen(null); toast("🗑 Photo removed", await H.removePhoto(props.owner, p.id)); }}><I n="trash" /></button>
              <button aria-label="Close" className="btn sm" onClick={() => setOpen(null)}><I n="close" /></button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export function TaskDetail({ task: t }: { task: Task }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [title, setTitle] = useState(t.title);
  const [hist, setHist] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => autosize(titleRef.current), [title]);
  const { area, project } = C.homeOf(t, data);
  const done = t.status === "done";
  const td = C.today();
  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== t.title) void H.updateTask(t.id, { title: v });
    else setTitle(t.title);
  };
  const section = project && t.sectionId ? (project.sections || []).find((x) => x.id === t.sectionId) : null;
  const handyArea = !!area && /handyman|business/i.test(area.name);
  const tod = C.TODS.find((x) => x.id === t.tod);
  const whenLabel = t.someday ? "💤 Someday" : t.when ? `${C.relLabel(t.when, { long: true })}${tod && tod.id ? " · " + tod.name : ""}${t.time ? " · " + C.fmtTime(t.time) : ""}` : null;
  const more = () => A.openMenu(t.title, [
    { text: "Put on today's River", icon: "🌊", run: async () => toast("🌊 On the River", await putTaskOnRiver(t.id)) },
    { text: "Focus on this", icon: "🎯", run: () => { closeTask(); openOverlay("focus", { taskId: t.id }); } },
    { text: "Ramble about this", icon: "🗣", run: () => { closeTask(); openOverlay("ramble", { focus: { kind: "task", id: t.id } }); } },
    { text: "Duplicate", icon: "⧉", run: () => A.duplicate(t.id) },
    { text: t.someday ? "Out of Someday" : "Move to Someday", icon: "💤", run: () => H.updateTask(t.id, { someday: !t.someday, when: null }) },
    { text: "Turn into a project", icon: "📁", run: () => A.toProject(t) },
    "-",
    { text: "Delete", icon: "🗑", danger: true, run: () => A.remove(t.id) },
  ]);
  return (
    <div className="tdetail">
      <div className="row d-bar" style={{ justifyContent: "flex-end", gap: 6, marginBottom: 6 }}>
        <button className="iconbtn" aria-label="Focus" onClick={() => { closeTask(); openOverlay("focus", { taskId: t.id }); }}><I n="target" /></button>
        <button className="iconbtn" aria-label="More actions" onClick={more}><I n="more" /></button>
        <button className="btn sm primary" onClick={closeTask}><I n="tick" /> Done</button>
      </div>
      <div className="d-top">
        <Check on={done} important={t.important} onToggle={() => A.complete(t.id)} />
        <textarea ref={titleRef} className="d-title" rows={1} value={title} aria-label="Title"
          onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === "Escape") { setTitle(t.title); (e.target as HTMLTextAreaElement).blur(); } }} />
      </div>
      <div className="d-body">
        <NotesEditor value={t.notes} onSave={(v) => void H.updateTask(t.id, { notes: v })} />
        <Checklist items={t.checklist || []} onChange={(checklist) => void H.updateTask(t.id, { checklist })} />
      </div>

      {(t.reschedules || 0) >= 3 && !done && (
        <div className="stuck">
          <b>Pushed {t.reschedules} times.</b> Too big, or not for now?
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip" onClick={() => A.toProject(t)}><I n="edit" /> Break it down</button>
            <button className="chip" onClick={() => A.toSomeday(t.id)}><I n="sleep" /> Someday</button>
            <button className="chip" onClick={() => A.remove(t.id)}><I n="trash" /> Delete</button>
            <button className="chip" onClick={() => H.updateTask(t.id, { reschedules: 0 })}>Keep it</button>
          </div>
        </div>
      )}

      <div className="props">
        <Prop icon={t.someday ? "💤" : "📅"} label="When" value={whenLabel} placeholder="Anytime" hot={t.when === td}
          onClick={() => A.schedule(t.id)} onClear={() => H.updateTask(t.id, { when: null, tod: null, time: null, someday: false })} />
        <Prop icon="⚑" label="Deadline" value={t.due ? C.longLabel(t.due) + (C.diffDays(td, t.due) < 0 ? " · late" : "") : null} placeholder="None" hot={!!t.due && C.diffDays(td, t.due) <= 1}
          onClick={() => A.setDue(t.id)} onClear={() => H.updateTask(t.id, { due: null })} />
        <Prop icon="↻" label="Repeat" value={t.repeat ? C.describeRule(t.repeat) : null} placeholder="No" onClick={() => A.setRepeat(t.id)} onClear={() => H.updateTask(t.id, { repeat: null })} />
        <Prop icon={project ? "📁" : area ? ic(area.icon) : "📥"} label="List" value={project ? `${project.name}${section ? " › " + section.name : ""}` : area ? area.name : null} placeholder="Inbox" onClick={() => A.move(t.id)} />
        <Prop icon="@" label="Contexts" value={(t.contexts || []).length ? t.contexts.join(" ") : null} placeholder="None" onClick={() => A.setContexts(t.id)} onClear={() => H.updateTask(t.id, { contexts: [] })} />
        {s.features.estimates && <Prop icon="⏱" label="Estimate" value={t.est ? C.fmtMinutes(t.est) : null} placeholder="None" onClick={() => A.setEstimate(t.id)} onClear={() => H.updateTask(t.id, { est: null })} />}
        {s.features.energy && <Prop icon="⚡" label="Energy" value={t.energy ? { low: "Low", med: "Medium", high: "High" }[t.energy] : null} placeholder="Any" onClick={() => A.setEnergy(t.id)} onClear={() => H.updateTask(t.id, { energy: null })} />}
        <div className="pr">
          <button className="pr-main" onClick={() => A.setPriority(t.id)}>
            <span className="pr-ic">▲</span><span className="pr-label">Priority</span>
            <span className="pr-val">{{ high: "High", normal: "Normal", low: "Low" }[t.priority || "normal"]}</span>
          </button>
          <button className={"chip" + (t.important ? " on imp" : "")} aria-pressed={t.important} onClick={() => H.updateTask(t.id, { important: !t.important })}><I n="flag" /> Important</button>
        </div>
        <Prop icon="⏳" label="Waiting" value={t.waiting ? `${t.waiting.who}${t.waiting.since ? " · since " + C.relLabel(t.waiting.since) : ""}${t.waiting.followUp ? " · nudge " + C.relLabel(t.waiting.followUp) : ""}` : null}
          placeholder="No" onClick={() => A.setWaiting(t.id)} onClear={() => H.updateTask(t.id, { waiting: null })} />
      </div>

      {s.features.handyman && (handyArea || t.handy) && <HandyBlock task={t} project={project} />}

      <div className="dblock">
        <div className="dhead"><I n="camera" /> Photos</div>
        <PhotoStrip owner={{ kind: "task", id: t.id }} photos={t.photos || []} />
      </div>

      <div className="dblock">
        <button className="dhead" onClick={() => setHist(!hist)} aria-expanded={hist}><I n="later" /> Activity {hist ? "▴" : "▾"}</button>
        <div className="history">
          <div>Created {C.timeAgo(t.createdAt)}</div>
          {done && t.doneAt && <div>Done {C.timeAgo(t.doneAt)}</div>}
          {t.focusMinutes > 0 && <div>Focused {C.fmtMinutes(t.focusMinutes)}</div>}
          {hist && (t.history || []).slice().reverse().map((h, i) => <div key={i}>{h.what[0].toUpperCase() + h.what.slice(1)} · {C.timeAgo(h.at)}</div>)}
        </div>
      </div>
    </div>
  );
}

export { PhotoStrip };
