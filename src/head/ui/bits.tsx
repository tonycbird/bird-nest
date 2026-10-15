import type { ReactNode } from "react";
import * as C from "../core/clearhead.js";
import type { Area, HeadData, Project, Task } from "../types";
import { multi, openTask, toggleMulti } from "../useHead";

/* Clearhead used Lucide icon names. Bird Nest shows them as emoji (no icon font to load offline). */
const EMOJI: Record<string, string> = {
  hammer: "🔨", briefcase: "💼", "book-open": "📖", church: "⛪", lightbulb: "💡", house: "🏠", "shopping-cart": "🛒",
  heart: "❤️", baby: "👶", sprout: "🌱", code: "💻", package: "📦", car: "🚗", dumbbell: "🏋", "piggy-bank": "🐷",
  "graduation-cap": "🎓", wrench: "🔧", "paint-roller": "🖌", "tree-pine": "🌲", gift: "🎁", utensils: "🍴", plane: "✈️",
  music: "🎵", laptop: "💻", store: "🏪", dog: "🐕", camera: "📷", star: "⭐", target: "🎯", leaf: "🍃", circle: "•",
  "layout-list": "📋", cake: "🎂",
};
export const ic = (name?: string | null) => (name && EMOJI[name]) || "•";

export function areaIcon(a: Area | null | undefined) { return a ? ic(a.icon) : "📥"; }

/** Round check; square for checklist items. Important tasks get a brass ring. */
export function Check(props: { on: boolean; onToggle: (v: boolean) => void; important?: boolean; square?: boolean; label?: string }) {
  return (
    <button type="button" className={"ck" + (props.on ? " on" : "") + (props.square ? " sq" : "") + (props.important ? " imp" : "")}
      aria-pressed={props.on} aria-label={props.label ?? (props.on ? "Mark not done" : "Complete")}
      onClick={(e) => { e.stopPropagation(); props.onToggle(!props.on); }}>
      {props.on ? "✓" : ""}
    </button>
  );
}

export function Ring(props: { pct: number; size?: number }) {
  const s = props.size ?? 22, r = s / 2 - 2, c = 2 * Math.PI * r;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" style={{ flex: "none" }}>
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="2.6" />
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="var(--head)" strokeWidth="2.6" strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, props.pct)} ${c}`} transform={`rotate(-90 ${s / 2} ${s / 2})`} />
    </svg>
  );
}

export function Empty(props: { icon: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{props.icon}</div>
      <h2>{props.title}</h2>
      {props.sub && <p className="detail">{props.sub}</p>}
      {props.children}
    </div>
  );
}

export function Seg<T extends string | null>(props: { value: T; options: { id: T; name: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={String(o.id)} role="radio" aria-checked={props.value === o.id} className={props.value === o.id ? "on" : ""} onClick={() => props.onChange(o.id)}>{o.name}</button>
      ))}
    </div>
  );
}

export function PageHead(props: { kicker: string; title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="top" style={{ marginBottom: 12 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="date">{props.kicker}</div>
        <h1 className="sentence">{props.title}</h1>
        {props.sub && <div className="quiet" style={{ marginTop: 4 }}>{props.sub}</div>}
      </div>
      {props.right && <div className="top-actions">{props.right}</div>}
    </header>
  );
}

/* ---------- task rows ---------- */

export function metaFor(t: Task, data: HeadData, opts: { showWhen?: boolean; showHome?: boolean } = {}): string[] {
  const { showWhen = true, showHome = true } = opts;
  const out: string[] = [];
  const td = C.today();
  if (showWhen && t.when && !t.someday) out.push((t.when < td ? "⚠ " : "📅 ") + C.relLabel(t.when) + (t.time ? " " + C.fmtTime(t.time) : t.tod && t.tod !== "morning" ? " · " + t.tod : ""));
  if (t.due) out.push((t.due <= td ? "🚩 " : "⚑ ") + C.relLabel(t.due));
  if (t.repeat) out.push("↻");
  if (t.waiting) out.push("⏳ " + t.waiting.who);
  if (showHome) {
    const { area, project } = C.homeOf(t, data);
    if (project) out.push("📁 " + project.name);
    else if (area) out.push(ic(area.icon) + " " + area.name);
  }
  for (const c of t.contexts || []) out.push(c);
  if (t.est) out.push("⏱ " + C.fmtMinutes(t.est));
  const cl = t.checklist || [];
  if (cl.length) out.push(`☑ ${cl.filter((x) => x.done).length}/${cl.length}`);
  if ((t.photos || []).length) out.push("📷 " + t.photos.length);
  if (t.notes) out.push("✎");
  return out;
}

export function TaskRow(props: {
  task: Task; data: HeadData; onToggle: (t: Task) => void; showWhen?: boolean; showHome?: boolean; right?: ReactNode;
}) {
  const t = props.task;
  const done = t.status === "done";
  const meta = metaFor(t, props.data, { showWhen: props.showWhen, showHome: props.showHome });
  const m = multi.use();
  const picked = m.ids.includes(t.id);
  const open = () => (m.on ? toggleMulti(t.id) : openTask(t.id));
  return (
    <div className={"task" + (done ? " done" : "") + (picked ? " picked" : "")} role="button" tabIndex={0}
      onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
      {m.on
        ? <Check square on={picked} onToggle={() => toggleMulti(t.id)} label={picked ? "Unselect" : "Select"} />
        : <Check on={done} important={t.important} onToggle={() => props.onToggle(t)} />}
      <div className="t-body">
        <div className="t-title">{t.important && !done && <span className="imp-flag" aria-label="Important">⚑ </span>}{t.title}</div>
        {meta.length > 0 && <div className="t-meta">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>}
      </div>
      {props.right}
    </div>
  );
}

export function projectLabel(p: Project, data: HeadData) {
  const a = p.areaId ? data.areas.get(p.areaId) : null;
  return a ? a.name : "";
}
