import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";
import * as C from "../core/clearhead.js";
import type { Area, HeadData, Project, Task } from "../types";
import { multi, openTask, toggleMulti } from "../useHead";
import { I, Icon } from "../../ui/Icon";

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
      onClick={(e) => { e.stopPropagation(); if (!props.on) e.currentTarget.setAttribute("data-pop", ""); props.onToggle(!props.on); }}>
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
  if (showWhen && t.when && !t.someday) out.push((t.when < td ? "⏰ " : "📅 ") + C.relLabel(t.when) + (t.time ? " " + C.fmtTime(t.time) : t.tod && t.tod !== "morning" ? " · " + t.tod : ""));
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

/* Swipe a row left to delete it (Undo in the toast). Vertical scrolling wins if the finger moves up or down first. */
function useSwipeDelete(onDelete: () => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const st = useRef<{ x: number; y: number; lock: "h" | "v" | null } | null>(null);
  const swiped = useRef(false);
  const cur = useRef(0); // the latest offset, readable on touchend even before React re-renders
  const CUT = -96;
  return {
    dx, gone, swiped,
    handlers: !enabled ? {} : {
      onTouchStart: (e: TouchEvent) => { st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null }; swiped.current = false; },
      onTouchMove: (e: TouchEvent) => {
        const s = st.current; if (!s) return;
        const ddx = e.touches[0].clientX - s.x, ddy = e.touches[0].clientY - s.y;
        if (!s.lock && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) s.lock = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v";
        if (s.lock === "h") { swiped.current = true; cur.current = Math.min(0, Math.max(-220, ddx)); setDx(cur.current); }
      },
      onTouchEnd: () => {
        const s = st.current; st.current = null;
        if (!s || s.lock !== "h") return;
        if (cur.current <= CUT) { setGone(true); setDx(-400); window.setTimeout(onDelete, 160); }
        else setDx(0);
        cur.current = 0;
        window.setTimeout(() => { swiped.current = false; }, 50);
      },
    },
  };
}

export function TaskRow(props: {
  task: Task; data: HeadData; onToggle: (t: Task) => void; showWhen?: boolean; showHome?: boolean; right?: ReactNode;
}) {
  const t = props.task;
  const done = t.status === "done";
  const meta = metaFor(t, props.data, { showWhen: props.showWhen, showHome: props.showHome });
  const m = multi.use();
  const picked = m.ids.includes(t.id);
  const sw = useSwipeDelete(() => void import("./actions").then((A) => A.remove(t.id)), !m.on);
  const open = () => { if (sw.swiped.current) return; if (m.on) toggleMulti(t.id); else openTask(t.id); };
  return (
    <div className={"swipe" + (sw.gone ? " gone" : "")}>
      <div className="swipe-bg" aria-hidden="true" style={{ opacity: Math.min(1, -sw.dx / 60) }}><Icon n="trash" size={20} />{sw.dx <= -96 ? "Let go to delete" : "Delete"}</div>
      <div className={"task" + (done ? " done" : "") + (picked ? " picked" : "")} role="button" tabIndex={0}
        style={sw.dx ? { transform: `translateX(${sw.dx}px)`, transition: sw.gone ? "transform .16s ease" : "none" } : { transition: "transform .2s ease" }}
        onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }} {...sw.handlers}>
        {m.on
          ? <Check square on={picked} onToggle={() => toggleMulti(t.id)} label={picked ? "Unselect" : "Select"} />
          : <Check on={done} important={t.important} onToggle={() => props.onToggle(t)} />}
        <div className="t-body">
          <div className="t-title">{t.important && !done && <span className="imp-flag" aria-label="Important">⚑ </span>}{t.title}</div>
          {meta.length > 0 && <div className="t-meta">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>}
        </div>
        {props.right}
      </div>
    </div>
  );
}

export function projectLabel(p: Project, data: HeadData) {
  const a = p.areaId ? data.areas.get(p.areaId) : null;
  return a ? a.name : "";
}

/** A whole-number field you can clear and retype ("1" → "" → "2"), kept at least `min`. */
export function NumField(props: { value: number; min?: number; onChange: (n: number) => void; className?: string; style?: CSSProperties; "aria-label"?: string }) {
  const min = props.min ?? 1;
  const [text, setText] = useState(String(props.value));
  useEffect(() => { setText((t) => (Number(t) === props.value ? t : String(props.value))); }, [props.value]);
  return (
    <input className={props.className} style={props.style} type="number" min={min} inputMode="numeric" aria-label={props["aria-label"]} value={text}
      onChange={(e) => { setText(e.target.value); const n = Math.floor(Number(e.target.value)); if (e.target.value !== "" && n >= min) props.onChange(n); }}
      onBlur={() => { const n = Math.floor(Number(text)); if (text === "" || !(n >= min)) setText(String(props.value)); }} />
  );
}
