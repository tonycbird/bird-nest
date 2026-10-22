import { useState } from "react";
import * as C from "../core/clearhead.js";
import type { Area, Project, RepeatRule, Tod, Waiting } from "../types";
import { useHeadData, useHeadSettings } from "../useHead";
import { ic, Seg } from "./bits";
import { SheetFrame, type SheetProps } from "./sheets";
import { I } from "../../ui/Icon";
import { ICONS } from "../../ui/icons";

/* Clearhead's pickers (src/ui/pickers.js), rebuilt as Bird sheets. Same choices, same results. */

export interface WhenResult { when: string | null; tod?: Tod; someday?: boolean; due?: string | null; }

/* ---------- month calendar ---------- */
function MonthCalendar(props: { value: string | null; weekStart: number; onPick: (d: string) => void }) {
  const t = C.today();
  const [month, setMonth] = useState(C.startOfMonth(props.value || t));
  const first = C.startOfWeek(month, props.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => C.addDays(first, i));
  const heads = Array.from({ length: 7 }, (_, i) => C.WD_SHORT[(props.weekStart + i) % 7].slice(0, 2));
  return (
    <div className="cal">
      <div className="row" style={{ justifyContent: "space-between", margin: "10px 0 6px" }}>
        <button className="iconbtn" aria-label="Previous month" onClick={() => setMonth(C.addMonths(month, -1))}><I n="chevL" /></button>
        <b>{C.monthLabel(month)}</b>
        <button className="iconbtn" aria-label="Next month" onClick={() => setMonth(C.addMonths(month, 1))}><I n="chevR" /></button>
      </div>
      <div className="cal-grid">
        {heads.map((h) => <span key={h} className="cal-h">{h}</span>)}
        {days.map((d) => (
          <button key={d} className={"cal-d" + (d.slice(0, 7) !== month.slice(0, 7) ? " out" : "") + (d === t ? " today" : "") + (d === props.value ? " on" : "")}
            disabled={d < t} onClick={() => props.onPick(d)}>{Number(d.slice(8))}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------- When / Deadline ---------- */
export function DatePicker(p: SheetProps & { title?: string; value: string | null; mode?: "when" | "due"; tod?: Tod; allowSomeday?: boolean }) {
  const s = useHeadSettings();
  const mode = p.mode ?? "when";
  const [typed, setTyped] = useState("");
  const [tod, setTod] = useState<Tod>(p.tod ?? null);
  const t = C.today();
  const parsed = typed ? C.matchDateAt(typed.trim(), { weekStart: s.weekStart }) : null;
  const pick = (d: string, extra: { tod?: Tod } = {}) =>
    p.done(mode === "due" ? { due: d } : { when: d, tod: extra.tod !== undefined ? extra.tod : tod, someday: false });
  const sat = C.weekday(t) === 6 || C.weekday(t) === 0 ? t : C.nextWeekday(t, 6);
  const nextWeek = C.addDays(C.startOfWeek(t, s.weekStart), 7);
  const quick = mode === "due"
    ? [
      { k: "Today", i: "⭐", d: t, side: "" },
      { k: "Tomorrow", i: "🌅", d: C.addDays(t, 1), side: C.WD_SHORT[C.weekday(C.addDays(t, 1))] },
      { k: "End of week", i: "📅", d: C.nextWeekday(t, 5), side: C.relLabel(C.nextWeekday(t, 5)) },
      { k: "Next week", i: "🗓", d: nextWeek, side: C.relLabel(nextWeek, { long: true }) },
      { k: "End of month", i: "📆", d: C.endOfMonth(t), side: C.relLabel(C.endOfMonth(t), { long: true }) },
    ]
    : [
      { k: "Today", i: "⭐", d: t, side: "" },
      { k: "This evening", i: "🌙", d: t, tod: "evening" as Tod, side: "" },
      { k: "Tomorrow", i: "🌅", d: C.addDays(t, 1), side: C.WD_SHORT[C.weekday(C.addDays(t, 1))] },
      { k: "This weekend", i: "🛋", d: sat, side: C.relLabel(sat) },
      { k: "Next week", i: "🗓", d: nextWeek, side: C.relLabel(nextWeek, { long: true }) },
    ];
  return (
    <SheetFrame title={p.title || (mode === "due" ? "⚑ Deadline" : "📅 When")}
      foot={<>
        {p.value && <button className="btn" style={{ color: "var(--warn)" }} onClick={() => p.done(mode === "due" ? { due: null } : { when: null, tod: null, someday: false })}><I n="close" /> Clear</button>}
        <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      </>}>
      <input className="field sm" autoFocus placeholder="fri · oct 20 · in 3 days" value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && parsed) pick(parsed.date, parsed.tod ? { tod: parsed.tod as Tod } : {}); }} />
      {typed && (
        <div className="qd" style={{ marginTop: 8 }}>
          {parsed
            ? <button onClick={() => pick(parsed.date, parsed.tod ? { tod: parsed.tod as Tod } : {})}><span><I n="tick" /></span>{C.longLabel(parsed.date)}<span className="side">{C.relLabel(parsed.date)}</span></button>
            : <p className="quiet" style={{ padding: 8 }}>Try “tomorrow”, “fri”, “oct 20”.</p>}
        </div>
      )}
      <div className="qd" style={{ marginTop: 8 }}>
        {quick.map((q) => (
          <button key={q.k} onClick={() => pick(q.d, "tod" in q && q.tod ? { tod: q.tod } : {})}><span>{q.i}</span>{q.k}<span className="side">{q.side}</span></button>
        ))}
        {mode === "when" && p.allowSomeday !== false && (
          <button onClick={() => p.done({ when: null, tod: null, someday: true })}><span><I n="sleep" /></span>Someday<span className="side" /></button>
        )}
      </div>
      {mode === "when" && (
        <div className="row" style={{ justifyContent: "center", margin: "10px 0 4px" }}>
          <Seg label="Time of day" value={tod} onChange={setTod} options={C.TODS.map((x) => ({ id: x.id, name: x.name }))} />
        </div>
      )}
      <MonthCalendar value={mode === "due" ? p.value : p.value} weekStart={s.weekStart} onPick={(d) => pick(d)} />
    </SheetFrame>
  );
}

/* ---------- Move to area / project / section ---------- */
export interface MoveResult { areaId: string | null; projectId: string | null; sectionId: string | null; }
export function MovePicker(p: SheetProps & { title?: string; allowInbox?: boolean; areasOnly?: boolean; projectsOnly?: boolean }) {
  const { data } = useHeadData();
  const [q, setQ] = useState("");
  const [secFor, setSecFor] = useState<Project | null>(null);
  const areas = C.areaList(data);
  const projects = [...data.projects.values()].filter((x) => x.status === "active" || x.status === "someday" || x.status === "hold");
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  if (secFor) {
    return (
      <SheetFrame title={"📁 " + secFor.name}>
        <div className="qd">
          <button onClick={() => p.done({ areaId: secFor.areaId, projectId: secFor.id, sectionId: null })}><span>≡</span>No section<span className="side" /></button>
          {(secFor.sections || []).map((s) => (
            <button key={s.id} onClick={() => p.done({ areaId: secFor.areaId, projectId: secFor.id, sectionId: s.id })}><span>▸</span>{s.name}<span className="side" /></button>
          ))}
        </div>
      </SheetFrame>
    );
  }
  const pickProject = (x: Project) => ((x.sections || []).length ? setSecFor(x) : p.done({ areaId: x.areaId, projectId: x.id, sectionId: null }));
  const row = (a: Area) => {
    const ps = projects.filter((x) => x.areaId === a.id && match(x.name));
    if (!match(a.name) && !ps.length) return null;
    return (
      <div key={a.id}>
        {!p.projectsOnly && <button onClick={() => p.done({ areaId: a.id, projectId: null, sectionId: null })}><span>{ic(a.icon)}</span><b>{a.name}</b><span className="side" /></button>}
        {p.projectsOnly && ps.length > 0 && <div className="lbl" style={{ margin: "10px 0 4px" }}>{ic(a.icon)} {a.name}</div>}
        {!p.areasOnly && ps.map((x) => (
          <button key={x.id} className="indent" onClick={() => pickProject(x)}><span><I n="project" /></span>{x.name}<span className="side">{x.status !== "active" ? x.status : ""}</span></button>
        ))}
      </div>
    );
  };
  const orphans = projects.filter((x) => !x.areaId && match(x.name));
  return (
    <SheetFrame title={p.title || "↪ Move to"} foot={<button className="btn" onClick={() => p.done(undefined)}>Cancel</button>}>
      <input className="field sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="qd" style={{ marginTop: 8 }}>
        {p.allowInbox !== false && !p.areasOnly && !p.projectsOnly && <button onClick={() => p.done({ areaId: null, projectId: null, sectionId: null })}><span><I n="inbox" /></span>Inbox<span className="side" /></button>}
        {areas.map(row)}
        {!p.areasOnly && orphans.map((x) => <button key={x.id} onClick={() => pickProject(x)}><span><I n="project" /></span>{x.name}<span className="side" /></button>)}
      </div>
    </SheetFrame>
  );
}

/* ---------- Contexts ---------- */
export function ContextPicker(p: SheetProps & { value: string[] }) {
  const s = useHeadSettings();
  const [sel, setSel] = useState<string[]>(p.value || []);
  const [extra, setExtra] = useState("");
  const all = [...new Set([...(s.contexts || []), ...sel])];
  const toggle = (c: string) => setSel(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]);
  const addExtra = () => {
    const v = extra.trim();
    if (!v) return;
    const name = v.startsWith("@") ? v : "@" + v[0].toUpperCase() + v.slice(1);
    if (!sel.includes(name)) setSel([...sel, name]);
    setExtra("");
  };
  return (
    <SheetFrame title="@ Contexts" foot={<><button className="btn" onClick={() => p.done(undefined)}>Cancel</button><button className="btn primary" onClick={() => p.done(sel)}><I n="tick" /> Save</button></>}>
      <div className="chips">{all.map((c) => <button key={c} className={"chip" + (sel.includes(c) ? " on" : "")} onClick={() => toggle(c)}>{c}</button>)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="field sm" placeholder="New context" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExtra()} />
        <button className="btn sm" onClick={addExtra}><I n="plus" /></button>
      </div>
    </SheetFrame>
  );
}

/* ---------- Estimate ---------- */
export function EstimatePicker(p: SheetProps & { value: number | null }) {
  const [typed, setTyped] = useState("");
  const parsed = typed ? C.parseEstimate(typed.trim().replace(/\s+/g, "")) ?? C.parseDuration(typed) : null;
  return (
    <SheetFrame title="⏱ Estimate" foot={<>
      {p.value && <button className="btn" style={{ color: "var(--warn)" }} onClick={() => p.done(null)}><I n="close" /> Clear</button>}
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
    </>}>
      <div className="chips">{C.ESTIMATES.map((m) => <button key={m} className={"chip" + (p.value === m ? " on" : "")} onClick={() => p.done(m)}>{C.fmtMinutes(m)}</button>)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="field sm" placeholder="45m · 1.5h · half day" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && parsed) p.done(parsed); }} />
        <button className="btn sm" disabled={!parsed} onClick={() => parsed && p.done(parsed)}>{parsed ? C.fmtMinutes(parsed) : "—"}</button>
      </div>
    </SheetFrame>
  );
}

/* ---------- Choice (energy, priority, status…) ---------- */
export function ChoicePicker(p: SheetProps & { title: string; value: string | null; options: { id: string; name: string; icon?: string }[]; clear?: string }) {
  return (
    <SheetFrame title={p.title} foot={<>
      {p.clear && p.value && <button className="btn" onClick={() => p.done(null)}>{p.clear}</button>}
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
    </>}>
      <div className="qd">
        {p.options.map((o) => <button key={o.id} className={p.value === o.id ? "on" : ""} onClick={() => p.done(o.id)}><span>{o.icon ?? (p.value === o.id ? "●" : "○")}</span>{o.name}<span className="side">{p.value === o.id ? "✓" : ""}</span></button>)}
      </div>
    </SheetFrame>
  );
}

/* ---------- Repeat ---------- */
export function RepeatEditor(p: SheetProps & { value: RepeatRule | null; base?: string | null }) {
  const s = useHeadSettings();
  const b = p.base || C.today();
  const init = p.value ? C.normalizeRule(p.value) : null;
  const [freq, setFreq] = useState<RepeatRule["freq"]>(init ? init.freq : "week");
  const [interval, setIntervalN] = useState(init ? init.interval : 1);
  const [days, setDays] = useState<number[]>(init && init.days ? init.days : [C.weekday(b)]);
  const [monthMode, setMonthMode] = useState<"date" | "nth">(init && init.monthMode ? init.monthMode : "date");
  const [monthDay, setMonthDay] = useState<number>(init && init.monthDay ? init.monthDay : C.parseYmd(b).getDate());
  const [nth, setNth] = useState<number>(init && init.nth ? init.nth : C.isLastWeekdayOfMonth(b) && C.nthOfWeekdayInMonth(b) > 4 ? -1 : C.nthOfWeekdayInMonth(b));
  const [wd, setWd] = useState<number>(init && init.wd != null ? init.wd : C.weekday(b));
  const [unit, setUnit] = useState<"day" | "week" | "month">(init && init.unit ? init.unit : "day");
  const rule = C.normalizeRule({
    freq, interval,
    anchor: init && init.anchor && init.anchor <= b ? init.anchor : b,
    ...(freq === "week" ? { days } : {}),
    ...(freq === "month" ? (monthMode === "nth" ? { monthMode, nth, wd } : { monthMode, monthDay }) : {}),
    ...(freq === "after" ? { unit } : {}),
  })!;
  const preview = freq === "after" ? [] : C.occurrencesBetween(rule, C.addDays(b, -1), C.addMonths(b, 24), 4);
  const unitName = { day: "day", week: "week", month: "month", year: "year", after: unit }[freq];
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
  return (
    <SheetFrame title="↻ Repeat" foot={<>
      {p.value && <button className="btn" style={{ color: "var(--warn)" }} onClick={() => p.done(null)}><I n="close" /> Stop</button>}
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      <button className="btn primary" onClick={() => p.done(rule)}><I n="tick" /> Save</button>
    </>}>
      <div style={{ overflowX: "auto" }}>
        <Seg label="Frequency" value={freq} onChange={setFreq} options={[
          { id: "day", name: "Daily" }, { id: "week", name: "Weekly" }, { id: "month", name: "Monthly" }, { id: "year", name: "Yearly" }, { id: "after", name: "After done" },
        ]} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span>{freq === "after" ? "Again" : "Every"}</span>
        <input className="field sm" style={{ width: 76 }} type="number" min={1} inputMode="numeric" value={interval} onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value) || 1))} />
        {freq === "after" ? (
          <>
            <select className="field sm" style={{ width: "auto" }} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="day">{interval === 1 ? "day" : "days"}</option><option value="week">{interval === 1 ? "week" : "weeks"}</option><option value="month">{interval === 1 ? "month" : "months"}</option>
            </select>
            <span>after done</span>
          </>
        ) : <span>{unitName}{interval === 1 ? "" : "s"}</span>}
      </div>
      {freq === "week" && (
        <div className="chips" style={{ marginTop: 12 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (s.weekStart + i) % 7).map((d) => (
            <button key={d} className={"chip" + (days.includes(d) ? " on" : "")} aria-pressed={days.includes(d)}
              onClick={() => setDays(days.includes(d) ? (days.length > 1 ? days.filter((x) => x !== d) : days) : [...days, d])}>{C.WD_SHORT[d]}</button>
          ))}
          <button className="chip" onClick={() => setDays([1, 2, 3, 4, 5])}>Weekdays</button>
        </div>
      )}
      {freq === "month" && (
        <div className="stack" style={{ marginTop: 12 }}>
          <label className="row"><input type="radio" name="mm" checked={monthMode === "date"} onChange={() => setMonthMode("date")} /><span>On day</span>
            <select className="field sm" style={{ width: "auto" }} value={monthDay} onChange={(e) => { setMonthDay(Number(e.target.value)); setMonthMode("date"); }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{C.ordinal(d)}</option>)}<option value={-1}>last day</option>
            </select></label>
          <label className="row"><input type="radio" name="mm" checked={monthMode === "nth"} onChange={() => setMonthMode("nth")} /><span>On the</span>
            <select className="field sm" style={{ width: "auto" }} value={nth} onChange={(e) => { setNth(Number(e.target.value)); setMonthMode("nth"); }}>
              {[1, 2, 3, 4, 5, -1].map((n) => <option key={n} value={n}>{n === -1 ? "last" : C.ordinal(n)}</option>)}
            </select>
            <select className="field sm" style={{ width: "auto" }} value={wd} onChange={(e) => { setWd(Number(e.target.value)); setMonthMode("nth"); }}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{cap(C.WEEKDAYS[d])}</option>)}
            </select></label>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <b>{C.describeRule(rule)}</b>
        {preview.length > 0 && <div className="quiet" style={{ marginTop: 4 }}>Next: {preview.map((d) => C.relLabel(d, { long: true })).join(" · ")}</div>}
        {freq === "after" && <div className="quiet" style={{ marginTop: 4 }}>The next one is set when you finish this one.</div>}
      </div>
    </SheetFrame>
  );
}

/* ---------- Waiting for ---------- */
export function WaitingPicker(p: SheetProps & { value: Waiting | null }) {
  const t = C.today();
  const [who, setWho] = useState(p.value ? p.value.who : "");
  const [since, setSince] = useState(p.value?.since ?? t);
  const [followUp, setFollowUp] = useState(p.value?.followUp ?? C.addDays(t, 3));
  return (
    <SheetFrame title="⏳ Waiting for" foot={<>
      {p.value && <button className="btn" style={{ color: "var(--warn)" }} onClick={() => p.done(null)}><I n="close" /> Not waiting</button>}
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      <button className="btn primary" disabled={!who.trim()} onClick={() => p.done({ who: who.trim(), since, followUp })}><I n="tick" /> Save</button>
    </>}>
      <input className="field sm" autoFocus value={who} placeholder="Who?" onChange={(e) => setWho(e.target.value)} />
      <div className="chips" style={{ marginTop: 8 }}>{["Client", "Supplier", "Professor", "Wife"].map((x) => <button key={x} className={"chip" + (who === x ? " on" : "")} onClick={() => setWho(x)}>{x}</button>)}</div>
      <div className="two" style={{ marginTop: 12 }}>
        <label><div className="lbl" style={{ margin: "0 0 4px" }}>Since</div><input className="field sm" type="date" value={since || ""} onChange={(e) => setSince(e.target.value)} /></label>
        <label><div className="lbl" style={{ margin: "0 0 4px" }}>Follow up</div><input className="field sm" type="date" value={followUp || ""} onChange={(e) => setFollowUp(e.target.value)} /></label>
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {([["2 days", 2], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]] as const).map(([l, n]) => (
          <button key={l} className={"chip" + (followUp === C.addDays(t, n) ? " on" : "")} onClick={() => setFollowUp(C.addDays(t, n))}>{l}</button>
        ))}
      </div>
    </SheetFrame>
  );
}

/* ---------- Confirm / text ---------- */
export function ConfirmSheet(p: SheetProps & { title: string; body?: string; confirm?: string; danger?: boolean }) {
  return (
    <SheetFrame title={p.title} foot={<>
      <button className="btn" onClick={() => p.done(false)}>Cancel</button>
      <button className={"btn " + (p.danger ? "" : "primary")} style={p.danger ? { background: "var(--warn)", color: "#fff" } : undefined} autoFocus onClick={() => p.done(true)}>{p.confirm || "OK"}</button>
    </>}>
      {p.body && <p className="muted">{p.body}</p>}
    </SheetFrame>
  );
}

export function TextSheet(p: SheetProps & { title: string; value?: string; placeholder?: string; confirm?: string; multiline?: boolean }) {
  const [v, setV] = useState(p.value || "");
  return (
    <SheetFrame title={p.title} foot={<>
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      <button className="btn primary" disabled={!v.trim()} onClick={() => p.done(v.trim())}>{p.confirm || "✓ Save"}</button>
    </>}>
      {p.multiline
        ? <textarea className="field sm" rows={6} autoFocus value={v} placeholder={p.placeholder} onChange={(e) => setV(e.target.value)} />
        : <input className="field sm" autoFocus value={v} placeholder={p.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) p.done(v.trim()); }} />}
    </SheetFrame>
  );
}

/* ---------- Area / Project editors ---------- */
export function AreaEditor(p: SheetProps & { area?: Area }) {
  const [name, setName] = useState(p.area?.name ?? "");
  const [icon, setIcon] = useState(p.area?.icon ?? "circle");
  const [groceries, setGroceries] = useState(p.area?.listMode === "groceries");
  return (
    <SheetFrame title={p.area ? "✏ Area" : "＋ Area"} foot={<>
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      <button className="btn primary" disabled={!name.trim()} onClick={() => p.done({ name: name.trim(), icon, color: p.area?.color ?? "blue", listMode: groceries ? "groceries" : null })}><I n="tick" /> Save</button>
    </>}>
      <input className="field sm" autoFocus placeholder="Area name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="lbl">Icon</div>
      <div className="chips">{C.AREA_ICONS.map((x) => <button key={x} className={"chip" + (icon === x ? " on" : "")} onClick={() => setIcon(x)} aria-label={x}>{ic(x)}</button>)}</div>
      <label className="row" style={{ marginTop: 12 }}><input type="checkbox" checked={groceries} onChange={(e) => setGroceries(e.target.checked)} /> <I n="groceries" /> Grocery list</label>
    </SheetFrame>
  );
}

export function ProjectEditor(p: SheetProps & { project?: Project; areaId?: string | null }) {
  const { data } = useHeadData();
  const pr = p.project;
  const [name, setName] = useState(pr?.name ?? "");
  const [areaId, setAreaId] = useState<string | null>(pr?.areaId ?? p.areaId ?? null);
  const [outcome, setOutcome] = useState(pr?.outcome ?? "");
  const [description, setDescription] = useState(pr?.description ?? "");
  const [start, setStart] = useState(pr?.start ?? "");
  const [deadline, setDeadline] = useState(pr?.deadline ?? "");
  const [status, setStatus] = useState<Project["status"]>(pr?.status ?? "active");
  const [client, setClient] = useState(pr?.client ?? null);
  return (
    <SheetFrame title={pr ? "✏ Project" : "＋ Project"} foot={<>
      <button className="btn" onClick={() => p.done(undefined)}>Cancel</button>
      <button className="btn primary" disabled={!name.trim()} onClick={() => p.done({ name: name.trim(), areaId, outcome, description, start: start || null, deadline: deadline || null, status, client })}><I n="tick" /> Save</button>
    </>}>
      <input className="field sm" autoFocus placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="lbl">Area</div>
      <select className="field sm" value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value || null)}>
        <option value="">No area</option>
        {C.areaList(data).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div className="lbl">Done looks like</div>
      <input className="field sm" placeholder="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      <div className="lbl detail">Description</div>
      <textarea className="field sm detail" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="two" style={{ marginTop: 12 }}>
        <label><div className="lbl" style={{ margin: "0 0 4px" }}>Start</div><input className="field sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label><div className="lbl" style={{ margin: "0 0 4px" }}>Deadline</div><input className="field sm" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
      </div>
      <div className="lbl">Status</div>
      <div className="chips">{C.PROJECT_STATUSES.map((s) => <button key={s.id} className={"chip" + (status === s.id ? " on" : "")} onClick={() => setStatus(s.id)}>{s.name}</button>)}</div>
      <label className="row" style={{ marginTop: 12 }}><input type="checkbox" checked={!!client} onChange={(e) => setClient(e.target.checked ? {} : null)} /> <I n="job" /> Client job</label>
      {client && (
        <div className="stack" style={{ marginTop: 8 }}>
          <input className="field sm" placeholder="Client name" value={client.name || ""} onChange={(e) => setClient({ ...client, name: e.target.value })} />
          <input className="field sm" placeholder="Address" value={client.address || ""} onChange={(e) => setClient({ ...client, address: e.target.value })} />
          <input className="field sm" type="tel" placeholder="Phone" value={client.phone || ""} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
          <input className="field sm" inputMode="decimal" placeholder="Price ($)" value={client.price || ""} onChange={(e) => setClient({ ...client, price: e.target.value })} />
        </div>
      )}
    </SheetFrame>
  );
}

/* ---------- Menu ---------- */
export interface MenuItem { text: string; icon?: string; danger?: boolean; run: () => unknown; }
export function MenuSheet(p: SheetProps & { title: string; items: (MenuItem | "-")[] }) {
  return (
    <SheetFrame title={p.title}>
      <div className="menu">
        {p.items.map((it, i) => it === "-"
          ? <div key={i} style={{ height: 6 }} />
          : <button key={i} className={it.danger ? "danger" : ""} onClick={() => p.done(i)}>{it.icon && it.icon in ICONS ? <I n={it.icon} /> : <span>{it.icon ?? ""}</span>}{it.text}</button>)}
      </div>
    </SheetFrame>
  );
}
