import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { once } from "../../lib/once";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { Task } from "../types";
import { closeOverlay, go, goTab, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { Check, Empty, ic, NumField, Ring, Seg, TaskRow } from "./bits";
import * as A from "./actions";
import { DumpInline } from "./dump";
import { openSheet } from "./sheets";
import { DatePicker, MovePicker, WaitingPicker, type MoveResult, type WhenResult } from "./pickers";
import { putTasksOnRiver, blockForTask } from "../river-bridge";
import { db } from "../../lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { I } from "../../ui/Icon";

/* Clearhead's guided flows (src/flows/flows.js): Process Inbox, Plan My Day, Weekly Review, Shutdown,
   Day planner, Focus, What now, Templates. Each is a full-screen, one-thing-at-a-time screen. */

export function FlowShell(props: { title: string; step?: number; steps?: number; onClose?: () => void; onBack?: (() => void) | null; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flow" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="flow-top">
        {props.onBack ? <button className="iconbtn" aria-label="Back" onClick={props.onBack}><I n="chevL" /></button> : <span style={{ width: 40 }} />}
        <div className="ft-title">
          {props.title}
          {(props.steps ?? 0) > 1 && <div className="fdots" aria-label={`Step ${(props.step ?? 0) + 1} of ${props.steps}`}>{Array.from({ length: props.steps! }, (_, i) => <i key={i} className={i === props.step ? "on" : i < (props.step ?? 0) ? "done" : ""} />)}</div>}
        </div>
        <button className="iconbtn" aria-label="Close" onClick={props.onClose || closeOverlay}><I n="close" /></button>
      </div>
      <div className="flow-body"><div className="flow-inner">{props.children}</div></div>
      {props.foot && <div className="flow-foot"><div className="flow-inner row">{props.foot}</div></div>}
    </div>
  );
}

const Grow = () => <span style={{ flex: 1 }} />;

/* ---------- Process Inbox ---------- */
export function ProcessInbox(props: { ids?: string[]; onFinish?: () => void; title?: string }) {
  const { data, ready } = useHeadData();
  const [ids, setIds] = useState<string[] | null>(props.ids ?? null);
  useEffect(() => { if (!ids && ready) setIds(C.selectInbox(data).map((t) => t.id)); }, [ready, ids, data]);
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const title = props.title ?? "✦ Process Inbox";
  const finish = () => (props.onFinish ? props.onFinish() : closeOverlay());
  if (!ids) return <FlowShell title={title} onClose={finish}><p className="quiet"><I n="more" /></p></FlowShell>;
  const remaining = ids.filter((id) => { const t = data.tasks.get(id); return t && C.isOpen(t) && C.isInbox(t); });
  let idx = i;
  while (idx < ids.length && !remaining.includes(ids[idx])) idx++;
  const t = idx < ids.length ? data.tasks.get(ids[idx]) : null;
  const pos = ids.length - remaining.length + 1;
  const next = () => { setDx(0); setTitleDraft(null); setI(idx + 1); };
  if (!t) {
    return (
      <FlowShell title={title} onClose={finish}>
        <Empty icon="📥" title={remaining.length ? "That's the pile" : "Inbox zero"} sub={remaining.length ? `${remaining.length} skipped · still in the Inbox for later.` : "Everything has a home."}><button className="btn primary" style={{ marginTop: 14 }} onClick={finish}><I n="tick" /> Done</button></Empty>
      </FlowShell>
    );
  }
  const saveTitle = async () => { if (titleDraft != null && titleDraft.trim() && titleDraft.trim() !== t.title) await H.updateTask(t.id, { title: titleDraft.trim() }); };
  const doIt = async () => { await saveTitle(); toast("✓ Done. Two-minute rule.", await H.completeTask(t.id)); next(); };
  const schedule = async () => {
    await saveTitle(); setDx(0);
    const r = await openSheet<WhenResult>(DatePicker, { value: t.when, mode: "when" });
    if (r === undefined) return;
    await H.updateTask(t.id, { when: r.when, tod: r.tod || null, someday: !!r.someday });
    if (r.someday) return next();
    const m = await openSheet<MoveResult>(MovePicker, { title: "Which area or project?", allowInbox: true });
    if (m && (m.areaId || m.projectId)) await H.updateTask(t.id, { areaId: m.areaId, projectId: m.projectId, sectionId: m.sectionId });
    next();
  };
  const assign = async (opts: Record<string, unknown>) => {
    await saveTitle();
    const r = await openSheet<MoveResult>(MovePicker, opts);
    if (r === undefined || (!r.areaId && !r.projectId)) return;
    await H.updateTask(t.id, { areaId: r.areaId, projectId: r.projectId, sectionId: r.sectionId });
    next();
  };
  const someday = async () => { await saveTitle(); await H.updateTask(t.id, { someday: true, when: null }); next(); };
  const waiting = async () => {
    await saveTitle();
    const r = await openSheet<{ who: string }>(WaitingPicker, {});
    if (!r) return;
    await H.updateTask(t.id, { waiting: r });
    const m = await openSheet<MoveResult>(MovePicker, { title: "Which area or project?" });
    if (m && (m.areaId || m.projectId)) await H.updateTask(t.id, { areaId: m.areaId, projectId: m.projectId });
    next();
  };
  const del = async () => { toast("🗑 Deleted", await H.deleteTask(t.id)); next(); };
  return (
    <FlowShell title={title} onClose={finish}>
      <div className="quiet" style={{ textAlign: "center", marginBottom: 12 }}>{pos} of {ids.length}</div>
      <div className="proc-card" style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined, transition: dx ? "none" : undefined }}
        onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false }; }}
        onTouchMove={(e) => {
          const s = start.current; if (!s) return;
          const ddx = e.touches[0].clientX - s.x, ddy = e.touches[0].clientY - s.y;
          if (!s.on && Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy)) s.on = true;
          if (s.on) setDx(ddx);
        }}
        onTouchEnd={() => { if (start.current?.on) { if (dx > 100) void doIt(); else if (dx < -100) void schedule(); else setDx(0); } start.current = null; }}>
        <textarea className="pc-title" rows={2} aria-label="Title" value={titleDraft ?? t.title} onChange={(e) => setTitleDraft(e.target.value)} onBlur={saveTitle} />
        {t.notes && <div className="quiet" style={{ whiteSpace: "pre-wrap" }}>{t.notes.slice(0, 280)}</div>}
        <div className="quiet" style={{ marginTop: 6 }}>Captured {C.timeAgo(t.createdAt)}{t.when ? " · " + C.relLabel(t.when) : ""}{(t.photos || []).length ? ` · 📷 ${t.photos.length}` : ""}</div>
      </div>
      <div className="proc-actions">
        <button className="btn wide good" onClick={doIt}><I n="tick" /> Do it now · under 2 min</button>
        <button className="btn" onClick={schedule}><I n="calendar" /> Schedule</button>
        <button className="btn" onClick={() => assign({ title: "Assign to project", projectsOnly: true, allowInbox: false })}><I n="project" /> Project</button>
        <button className="btn" onClick={() => assign({ title: "Assign to area", areasOnly: true, allowInbox: false })}><I n="project" /> Area</button>
        <button className="btn" onClick={someday}><I n="sleep" /> Someday</button>
        <button className="btn" onClick={waiting}><I n="waiting" /> Waiting</button>
        <button className="btn" style={{ color: "var(--warn-ink)" }} onClick={del}><I n="trash" /> Delete</button>
      </div>
      <div className="row" style={{ justifyContent: "center", marginTop: 10 }}><button className="linkbtn" onClick={next}><I n="skip" /> Skip</button></div>
      <div className="swipe-hint detail"><span>← schedule</span><span>do it <I n="arrow" /></span></div>
    </FlowShell>
  );
}

/* ---------- Plan My Day (+ put it on the River) ---------- */
export function PlanMyDay() {
  const { data, ready } = useHeadData();
  const t = C.today();
  const [overIds, setOverIds] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<ReturnType<typeof C.suggestForToday> | null>(null);
  useEffect(() => {
    if (ready && !overIds) { setOverIds(C.selectToday(data).overdue.map((x) => x.id)); setSuggestions(C.suggestForToday(data, 8)); }
  }, [ready, overIds, data]);
  const [step, setStep] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [timeText, setTimeText] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [toRiver, setToRiver] = useState(true);
  if (!overIds || !suggestions) return <FlowShell title="🌅 Plan my day"><p className="quiet"><I n="more" /></p></FlowShell>;
  const st = step ?? (overIds.length ? 0 : 1);
  const over = overIds.map((id) => data.tasks.get(id)).filter((x): x is Task => !!x && C.isOpen(x) && ((!!x.when && x.when < t) || (!!x.due && x.due < t)) && x.when !== t
    && !x.someday && !(x.when && x.when > t)); // moved to Later or Someday: handled, even if its deadline has passed
  const cur = over[0];
  const finish = async () => {
    await H.saveSettings({ lastPlan: t });
    if (toRiver) {
      const ids = C.selectToday(await H.loadData()).main.filter(C.isOpen).map((x) => x.id);
      const u = await putTasksOnRiver(ids);
      closeOverlay();
      goTab("today");
      toast("🌊 Today is on the River", u);
    } else {
      closeOverlay();
      go("today");
      toast("🌅 Day planned");
    }
  };
  const STEPS = 4;
  if (st === 0) {
    if (!cur) { setTimeout(() => setStep(1), 0); return null; }
    const late = cur.due && cur.due < t ? `Was due ${C.relLabel(cur.due)}` : `Planned ${C.relLabel(cur.when)}`;
    return (
      <FlowShell title="🌅 Plan my day" step={0} steps={STEPS}>
        <h2>Catch up</h2><p className="lede">{over.length} from earlier. Today, later, or let go.</p>
        <div className="proc-card"><div className="pc-title static">{cur.title}</div><div className="quiet">{late}</div></div>
        <div className="proc-actions">
          <button className="btn" onClick={() => H.updateTask(cur.id, { when: t })}><I n="star" /> Today</button>
          <button className="btn" onClick={() => A.schedule(cur.id)}><I n="calendar" /> Later</button>
          <button className="btn" onClick={() => H.updateTask(cur.id, { someday: true, when: null })}><I n="sleep" /> Someday</button>
          <button className="btn" style={{ color: "var(--warn-ink)" }} onClick={async () => toast("🗑 Dropped", await H.deleteTask(cur.id))}><I n="trash" /> Drop</button>
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}><button className="linkbtn" onClick={() => setStep(1)}>Skip the rest</button></div>
      </FlowShell>
    );
  }
  if (st === 1) {
    const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
    return (
      <FlowShell title="🌅 Plan my day" step={1} steps={STEPS} onBack={over.length ? () => setStep(0) : null}
        foot={<><Grow /><button className="btn primary" onClick={async () => { for (const id of picked) await H.updateTask(id, { when: t }); setStep(2); }}>{picked.size ? `＋ ${picked.size} to today` : "Next ›"}</button></>}>
        <h2>Anything else today?</h2><p className="lede detail">From Anytime: deadlines, flags, project next steps.</p>
        {!suggestions.length && <Empty icon="🗂" title="No suggestions" sub="Today is what you already planned." />}
        {suggestions.map(({ task: x, why }) => {
          const h = C.homeOf(x, data);
          return (
            <button key={x.id} className="task pick" onClick={() => toggle(x.id)}>
              <Check square on={picked.has(x.id)} onToggle={() => toggle(x.id)} label="Add to today" />
              <div className="t-body"><div className="t-title">{x.title}</div>
                <div className="t-meta">{why.map((w) => <span key={w}>{w}</span>)}{(h.project || h.area) && <span>{(h.project || h.area)!.name}</span>}{x.est ? <span><I n="timer" /> {C.fmtMinutes(x.est)}</span> : null}</div></div>
            </button>
          );
        })}
      </FlowShell>
    );
  }
  if (st === 2) {
    const todays = C.selectToday(data).main;
    const est = todays.reduce((n, x) => n + (x.est || 0), 0);
    const unest = todays.filter((x) => !x.est).length;
    const assumed = est + unest * 15;
    const overBy = minutes ? assumed - minutes : 0;
    return (
      <FlowShell title="🌅 Plan my day" step={2} steps={STEPS} onBack={() => setStep(1)} foot={<><Grow /><button className="btn primary" onClick={() => setStep(3)}>Next <I n="chevR" /></button></>}>
        <h2>How much time, really?</h2><p className="lede detail">After work, the commute and the baby. Rough is fine.</p>
        <div className="chips">{([[60, "1h"], [120, "2h"], [180, "3h"], [240, "½ day"], [480, "Full day"]] as const).map(([v, l]) => <button key={v} className={"chip" + (minutes === v ? " on" : "")} onClick={() => { setMinutes(v); setTimeText(""); }}>{l}</button>)}</div>
        <input className="field sm" style={{ marginTop: 10 }} placeholder="Or type: 2 hours after work" value={timeText} onChange={(e) => { setTimeText(e.target.value); setMinutes(C.parseDuration(e.target.value)); }} />
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row"><span className="grow">Today's plan</span><b>{C.fmtMinutes(est) || "0m"}{unest ? <span className="quiet"> + {unest} ?</span> : null}</b></div>
          {minutes ? (
            <>
              <div className="budget"><span className={overBy > 0 ? "over" : ""} style={{ width: Math.min(100, (assumed / minutes) * 100) + "%" }} /></div>
              <div style={{ color: overBy > 0 ? "var(--warn)" : "var(--good)", fontSize: 14 }}>{overBy > 0 ? `~${C.fmtMinutes(overBy)} too much. Move a few to tomorrow.` : `Fits${overBy < -30 ? ` · ~${C.fmtMinutes(-overBy)} spare` : ""}.`}</div>
            </>
          ) : <div className="quiet" style={{ marginTop: 6 }}>Pick your time to see if it fits.</div>}
        </div>
        {minutes && overBy > 0 && todays.map((x) => (
          <div key={x.id} className="row" style={{ minHeight: 44, borderBottom: "1px solid var(--line)" }}>
            <span className="grow">{x.title}</span><span className="quiet">{x.est ? C.fmtMinutes(x.est) : "—"}</span>
            <button className="btn sm" onClick={() => H.updateTask(x.id, { when: C.addDays(t, 1) })}><I n="arrow" /> Tmrw</button>
          </div>
        ))}
      </FlowShell>
    );
  }
  const todays = C.selectToday(data).main;
  return (
    <FlowShell title="🌅 Plan my day" step={3} steps={STEPS} onBack={() => setStep(2)}
      foot={<><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={toRiver} onChange={(e) => setToRiver(e.target.checked)} /><I n="river" /> River</label><Grow /><button className="btn primary" onClick={() => void once("plan-finish", finish)}><I n="play" /> Start my day</button></>}>
      <h2>Here's today</h2><p className="lede">{todays.length ? `${todays.length} thing${todays.length === 1 ? "" : "s"}. One at a time.` : "A light day. Enjoy it."}</p>
      {todays.map((x) => <TaskRow key={x.id} task={x} data={data} onToggle={() => A.complete(x.id)} showWhen={false} />)}
      {toRiver && todays.length > 0 && <p className="quiet" style={{ marginTop: 10 }}>Each becomes a River block with steps, from the next free time.</p>}
    </FlowShell>
  );
}

/* ---------- Weekly Review ---------- */
export function WeeklyReview() {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [step, setStep] = useState(0);
  const [pi, setPi] = useState(0);
  const [nextDraft, setNextDraft] = useState("");
  const [processing, setProcessing] = useState(false);
  const t = C.today();
  const STEPS = ["Inbox", "Projects", "Waiting", "Upcoming", "Someday", "Brain dump", "Summary"];
  const go2 = (n: number) => { setStep(n); document.querySelector(".flow-body")?.scrollTo(0, 0); };
  const shell = (title: string, lede: string | null, body: ReactNode, foot?: ReactNode) => (
    <FlowShell title={"🗓 Review · " + STEPS[step]} step={step} steps={STEPS.length} onBack={step ? () => go2(step - 1) : null} foot={foot ?? <><Grow /><button className="btn primary" onClick={() => go2(step + 1)}>Next <I n="chevR" /></button></>}>
      <h2>{title}</h2>{lede && <p className="lede">{lede}</p>}{body}
    </FlowShell>
  );
  const row = (x: Task) => <TaskRow key={x.id} task={x} data={data} onToggle={() => A.complete(x.id)} />;
  if (step === 0) {
    const inbox = C.selectInbox(data);
    if (processing) return <ProcessInbox title="🗓 Review · Inbox" onFinish={() => setProcessing(false)} />;
    return shell("Clear your Inbox", inbox.length ? `${inbox.length} need a home.` : "Inbox zero.",
      <>{inbox.length > 0 && <><button className="btn primary" style={{ width: "100%" }} onClick={() => setProcessing(true)}><I n="sort" /> Process {inbox.length}</button><div style={{ marginTop: 10 }}>{inbox.slice(0, 6).map(row)}</div></>}</>,
      <><Grow /><button className="btn primary" onClick={() => go2(1)}>{inbox.length ? "Skip ›" : "Next ›"}</button></>);
  }
  if (step === 1) {
    const projects = C.activeProjects(data);
    const p = projects[Math.min(pi, projects.length - 1)];
    if (!p) return shell("Projects", "No active projects.", null);
    const next = C.nextAction(data, p);
    const st = C.projectStats(data, p);
    const advance = () => { setNextDraft(""); if (pi + 1 < projects.length) setPi(pi + 1); else { setPi(0); go2(2); } };
    // Hold / Someday / Done take the project off this list, so the next one slides into the same spot: don't step past it.
    const leave = () => { setNextDraft(""); if (pi + 1 >= projects.length) { setPi(0); go2(2); } };
    const addNext = async () => { if (nextDraft.trim()) { await H.createTask({ title: nextDraft.trim(), projectId: p.id }); setNextDraft(""); } };
    return shell(`Project ${Math.min(pi, projects.length - 1) + 1} of ${projects.length}`, "Each needs a clear next step.",
      <div className="card">
        <div className="row"><Ring pct={st.pct} size={26} /><b className="grow" style={{ fontSize: 18 }}>{p.name}</b><button className="btn sm" onClick={() => { closeOverlay(); go("project", p.id); }}>Open</button></div>
        {p.outcome && <div className="quiet" style={{ marginTop: 6 }}>Done = {p.outcome}</div>}
        {p.deadline && <div style={{ marginTop: 6, fontSize: 14 }}><I n="flag" /> {C.longLabel(p.deadline)}</div>}
        <div style={{ marginTop: 10 }}>{next ? <><div className="lbl" style={{ margin: "0 0 4px" }}><I n="play" /> Next</div>{row(next)}</> : <div className="stalled"><I n="pause" /> No next step</div>}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="field sm" placeholder={next ? "Add another step" : "The very next step?"} value={nextDraft} onChange={(e) => setNextDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addNext()} />
          <button aria-label="Add next action" className="btn sm" disabled={!nextDraft.trim()} onClick={addNext}><I n="plus" /></button>
        </div>
        <div className="lbl">Status</div>
        <div className="chips">{([["active", "Active"], ["hold", "Hold"], ["someday", "Someday"], ["done", "Done"]] as const).map(([id, n]) => (
          <button key={id} className={"chip" + (p.status === id ? " on" : "")} onClick={async () => {
            if (id === p.status) return;
            const label = id === "done" ? "✓ Project done" : id === "hold" ? "⏸ On hold" : id === "someday" ? "💤 Someday" : "▶ Active";
            toast(label, id === "done" ? await H.completeProject(p.id) : await H.updateProject(p.id, { status: id }));
            if (id !== "active") leave();
          }}>{n}</button>
        ))}</div>
      </div>,
      <><button className="btn" onClick={() => { setPi(0); go2(2); }}>Skip</button><Grow /><button className="btn primary" onClick={advance}>{pi + 1 < projects.length ? "Next project ›" : "Next ›"}</button></>);
  }
  if (step === 2) {
    const ws = C.selectWaiting(data);
    return shell("Waiting", ws.length ? "Nudge anything gone quiet." : "Not waiting on anyone.",
      <>{ws.map((x) => {
        const stale = (x.waiting!.followUp && x.waiting!.followUp <= t) || (x.waiting!.since && C.diffDays(x.waiting!.since, t) >= 7);
        return <div key={x.id} className="row" style={{ alignItems: "flex-start", borderBottom: "1px solid var(--line)" }}><div className="grow">{row(x)}</div><button aria-label="Follow up" className={"btn sm" + (stale ? " primary" : "")} style={{ marginTop: 8 }} onClick={() => A.followUp(x)}><I n="arrow" /></button></div>;
      })}</>);
  }
  if (step === 3) {
    const { tasks } = C.selectUpcoming(data);
    const end = C.addDays(t, 14);
    const soon = tasks.filter((x) => x.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    const byDay = new Map<string, Task[]>();
    for (const x of soon) { if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date)!.push(x.task); }
    return shell("Next two weeks", soon.length ? "Prepare, move, or drop?" : "Nothing in the next two weeks.",
      <>{[...byDay.entries()].map(([d, ts]) => <section key={d} className="hsec"><div className="sec-head"><span className="grow">{C.relLabel(d, { long: true })}</span></div>{ts.map((x) => <TaskRow key={x.id + d} task={x} data={data} onToggle={() => A.complete(x.id)} showWhen={false} />)}</section>)}</>);
  }
  if (step === 4) {
    const { tasks, projects } = C.selectSomeday(data);
    return shell("Someday", tasks.length + projects.length ? "Ready to be real? Promote it, or leave it." : "Nothing parked.",
      <>
        {projects.map((p) => <div key={p.id} className="row" style={{ borderBottom: "1px solid var(--line)", minHeight: 48 }}><span className="grow"><I n="project" /> {p.name}</span><button aria-label="Make active" className="btn sm" onClick={async () => { await H.updateProject(p.id, { status: "active" }); toast("▶ Active"); }}><I n="play" /></button></div>)}
        {tasks.map((x) => <div key={x.id} className="row" style={{ borderBottom: "1px solid var(--line)" }}><div className="grow">{row(x)}</div>
          <button aria-label="Move to Anytime" className="btn sm" onClick={async () => { await H.updateTask(x.id, { someday: false }); toast("🗂 To Anytime"); }}><I n="upload" /></button>
          <button aria-label="Schedule" className="btn sm" onClick={() => A.schedule(x.id)}><I n="calendar" /></button></div>)}
      </>);
  }
  if (step === 5) {
    return shell("Still on your mind?", "Out of your head. Nest sorts it.", <DumpInline onDone={() => go2(6)} />, <><Grow /><button className="btn" onClick={() => go2(6)}>Nothing more <I n="chevR" /></button></>);
  }
  const from = C.parseYmd(C.addDays(t, -6)).setHours(0, 0, 0, 0);
  const done = C.completedBetween(data, from, Date.now() + 1).filter((x) => !x.grocery);
  const byArea = new Map<string, number>();
  for (const x of done) { const a = C.areaOfTask(x, data); const k = a ? a.name : "Inbox"; byArea.set(k, (byArea.get(k) || 0) + 1); }
  const projectsDone = [...data.projects.values()].filter((p) => p.status === "done" && (p.completedAt || 0) >= from);
  void s;
  return shell("Your week", "A short look back.",
    <>
      <div className="card"><div className="bignum">{done.length}</div><div className="quiet">finished in 7 days</div></div>
      {projectsDone.length > 0 && <div className="card" style={{ marginTop: 10 }}><b>Projects done</b>{projectsDone.map((p) => <div key={p.id} style={{ marginTop: 4 }}><I n="tick" /> {p.name}</div>)}</div>}
      {byArea.size > 0 && <div className="sgrid">{[...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => <div className="card" key={k}><div className="bignum sm">{n}</div><div className="quiet">{k}</div></div>)}</div>}
    </>,
    <><Grow /><button className="btn primary" onClick={async () => { await H.saveSettings({ lastReview: t }); closeOverlay(); toast("🗓 Review done. System current."); }}><I n="tick" /> Finish</button></>);
}

/* ---------- Shutdown ---------- */
export function Shutdown() {
  const { data, ready } = useHeadData();
  const s = useHeadSettings();
  const t = C.today();
  const nextDay = C.nextWorkDay(s, t);
  const tomorrow = C.addDays(t, 1);
  const [step, setStep] = useState(0);
  const [ids, setIds] = useState<string[] | null>(null);
  const [dest, setDest] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (ready && !ids) {
      const x = C.selectToday(data).main.filter(C.isOpen).map((y) => y.id);
      setIds(x);
      setDest(Object.fromEntries(x.map((id) => [id, nextDay])));
    }
  }, [ready, ids, data, nextDay]);
  if (!ids) return <FlowShell title="⏻ Shutdown"><p className="quiet"><I n="more" /></p></FlowShell>;
  const items = ids.map((id) => data.tasks.get(id)).filter((x): x is Task => !!x && C.isOpen(x));
  const dayName = (d: string) => C.longLabel(d).split(",")[0];
  if (step === 0) {
    return (
      <FlowShell title="⏻ Shutdown" step={0} steps={4} foot={<><Grow /><button className="btn primary" onClick={async () => {
        for (const x of items) if (dest[x.id] !== x.when) await H.updateTask(x.id, { when: dest[x.id], first: null });
        setStep(1);
      }}>{items.length ? "Move · next ›" : "Next ›"}</button></>}>
        <h2>Close out today</h2>
        <p className="lede">{items.length ? `Still open. They move to ${nextDay === tomorrow ? "tomorrow" : dayName(nextDay)}${nextDay !== tomorrow ? ` (${dayName(tomorrow)} is phone-free)` : ""}.` : "Nothing left open. Well done."}</p>
        {items.map((x) => (
          <div key={x.id} className="row" style={{ minHeight: 52, borderBottom: "1px solid var(--line)" }}>
            <span className="grow">{x.title}</span>
            <button className="btn sm" onClick={async () => { const r = await openSheet<WhenResult>(DatePicker, { value: dest[x.id], mode: "when" }); if (r !== undefined) setDest({ ...dest, [x.id]: r.when || null }); }}><I n="calendar" /> {dest[x.id] ? C.relLabel(dest[x.id]) : "No date"}</button>
            <button className="btn sm" onClick={() => setDest({ ...dest, [x.id]: t })}>Keep</button>
          </div>
        ))}
      </FlowShell>
    );
  }
  if (step === 1) return <FlowShell title="⏻ Shutdown" step={1} steps={4} onBack={() => setStep(0)} foot={<><Grow /><button className="btn" onClick={() => setStep(2)}>Nothing else <I n="chevR" /></button></>}><h2>Empty your head</h2><p className="lede">Write it down so you can be home. Nest sorts it.</p><DumpInline onDone={() => setStep(2)} /></FlowShell>;
  if (step === 2) return <FlowShell title="⏻ Shutdown" step={2} steps={4} onBack={() => setStep(1)} foot={<><Grow /><button className="btn primary" onClick={() => setStep(3)}>Looks good <I n="chevR" /></button></>}><DayPlanner date={tomorrow} /></FlowShell>;
  return (
    <FlowShell title="⏻ Shutdown" step={3} steps={4} onBack={() => setStep(2)}>
      <Empty icon="🏡" title="You're done for the day" sub="Everything is written down. Go be home.">
        {s.dndReminder && <div className="card" style={{ textAlign: "left", marginTop: 14 }}><b><I n="quiet" /> Do Not Disturb</b><div className="quiet" style={{ marginTop: 4 }}>Swipe down from the top-right <I n="arrow" /> Focus <I n="arrow" /> Do Not Disturb.</div></div>}
        <button className="btn primary" style={{ marginTop: 14 }} onClick={async () => {
          await H.saveSettings({ lastShutdown: t });
          const wind = (await db.blocks.where("day").equals(t).toArray()).find((b) => !b.deleted_at && b.status === "open" && /wind down|shutdown/i.test(b.title));
          closeOverlay();
          goTab("today");
          if (wind) toast("🌙 Wind down is next on the River");
        }}><I n="shutdown" /> Shut down</button>
      </Empty>
    </FlowShell>
  );
}

/* ---------- Day planner (tomorrow, or any day) ---------- */
export function DayPlanner({ date }: { date: string }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [text, setText] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const off = C.isOffDay(s, date);
  const { tasks, repeats } = C.selectDay(data, date);
  const starts = tasks.filter((x) => x.first === date);
  const sugg = C.suggestForToday(data, 12).map((x) => x.task).filter((x) => x.when !== date && !added.includes(x.id)).slice(0, 5);
  const onRiver = useLiveQuery(async () => new Set((await db.blocks.where("day").equals(date).toArray()).filter((b) => !b.deleted_at && b.source_id).map((b) => b.source_id!)), [date], new Set<string>());
  const add = async () => { const title = text.trim(); if (!title) return; await H.createTask({ title, when: date }); setText(""); };
  const toggleStart = async (x: Task) => {
    if (x.first === date) await H.updateTask(x.id, { first: null });
    else if (starts.length >= 3) toast("⭐ Three is plenty. Unstar one first.");
    else await H.updateTask(x.id, { first: date });
  };
  const rel = C.relLabel(date);
  const dayName = C.longLabel(date).split(",")[0];
  return (
    <div className="day-planner">
      <div className="date">{C.longLabel(date)}</div>
      <h2>{off ? `📵 Phone-free ${dayName}` : rel === "Tomorrow" || rel === "Today" ? rel : dayName}</h2>
      <p className="lede detail">{off ? "Decide tonight, so you won't need your phone." : "Star up to three to start with."}</p>
      {!tasks.length && !repeats.length && <div className="card quiet" style={{ textAlign: "center" }}>Nothing planned yet.</div>}
      {tasks.map((x) => (
        <div key={x.id} className={"dp-row" + (x.first === date ? " starred" : "")}>
          <button className="iconbtn" aria-pressed={x.first === date} aria-label={(x.first === date ? "Don't start with " : "Start with ") + x.title} onClick={() => toggleStart(x)}>{x.first === date ? "⭐" : "☆"}</button>
          <span className="grow">{x.title}{(x.tod || x.time) && <span className="quiet"> · {x.time ? C.fmtTime(x.time) : x.tod}</span>}{onRiver.has(x.id) && <span className="quiet"> · <I n="river" /></span>}</span>
          <button className="btn sm" aria-label={"Move " + x.title} onClick={async () => { const r = await openSheet<WhenResult>(DatePicker, { value: date, mode: "when" }); if (r !== undefined && r.when !== date) { await H.updateTask(x.id, { when: r.when || null, first: null, someday: !!r.someday }); toast(r.when ? `📅 ${C.relLabel(r.when)}` : "✕ No date"); } }}><I n="calendar" /></button>
        </div>
      ))}
      {repeats.map((x) => <div key={"r" + x.id} className="dp-row faint"><span className="iconbtn ghost"><I n="refresh" /></span><span className="grow">{x.title}</span></div>)}
      <div className="row" style={{ marginTop: 12 }}>
        <input className="field sm" placeholder={`Add for ${rel === "Tomorrow" || rel === "Today" ? rel.toLowerCase() : dayName}…`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button aria-label="Add" className="btn sm primary" disabled={!text.trim()} onClick={add}><I n="plus" /></button>
      </div>
      {tasks.length > 0 && (
        <button className="btn sm" style={{ marginTop: 10 }} onClick={async () => {
          const ordered = [...starts, ...tasks.filter((x) => x.first !== date)].filter((x) => !onRiver.has(x.id));
          toast("🌊 On the River", await putTasksOnRiver(ordered.map((x) => x.id), date));
        }}><I n="river" /> Put on {rel === "Today" ? "today's" : rel === "Tomorrow" ? "tomorrow's" : dayName + "'s"} River</button>
      )}
      {sugg.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="lbl">Could also fit</div>
          {sugg.map((x) => <div key={x.id} className="dp-row"><span className="grow">{x.title}</span><button aria-label="Add to this day" className="btn sm" onClick={async () => { await H.updateTask(x.id, { when: date, someday: false }); setAdded([...added, x.id]); }}><I n="plus" /></button></div>)}
        </div>
      )}
    </div>
  );
}

export function PlanDay({ date }: { date?: string }) {
  const d = date || C.addDays(C.today(), 1);
  return <FlowShell title={"📅 " + C.relLabel(d)} foot={<><Grow /><button className="btn primary" onClick={closeOverlay}><I n="tick" /> Done</button></>}><DayPlanner date={d} /></FlowShell>;
}

/* ---------- Focus (timer counts from an end time, so a locked phone doesn't lose time) ---------- */
export function Focus({ taskId }: { taskId: string }) {
  const task = useLiveQuery(() => db.tasks.get(taskId), [taskId]);
  const [mode, setMode] = useState<"pomodoro" | "custom">("pomodoro");
  const [custom, setCustom] = useState(45);
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [endAt, setEndAt] = useState<number | null>(null);
  const [left, setLeft] = useState(25 * 60);
  const [worked, setWorked] = useState(0); // seconds of work banked
  const [workStart, setWorkStart] = useState<number | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const workLen = mode === "pomodoro" ? 25 * 60 : custom * 60;
  const running = endAt !== null;
  useEffect(() => { if (!running) setLeft(phase === "work" ? workLen : 5 * 60); }, [mode, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const l = Math.max(0, Math.round((endAt! - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) {
        try { navigator.vibrate?.([80, 60, 80]); } catch { /* not on iPhone */ }
        if (phase === "work" && workStart) { setWorked((w) => w + Math.round((Date.now() - workStart) / 1000)); setWorkStart(null); }
        if (mode === "pomodoro") {
          const np = phase === "work" ? "break" : "work";
          setPhase(np);
          toast(np === "break" ? "☕ 5-minute break" : "▶ Back to it");
          const len = np === "break" ? 5 * 60 : 25 * 60;
          setEndAt(Date.now() + len * 1000);
          if (np === "work") setWorkStart(Date.now());
        } else { setEndAt(null); toast("⏰ Time's up"); }
      }
    };
    tick();
    const iv = window.setInterval(tick, 500);
    return () => window.clearInterval(iv);
  }, [running, endAt, phase, mode, workStart]);
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (running && nav.wakeLock) nav.wakeLock.request("screen").then((w) => { wake.current = w; }).catch(() => {});
    if (!running && wake.current) { void wake.current.release().catch(() => {}); wake.current = null; }
  }, [running]);
  const bank = () => (phase === "work" && workStart ? worked + Math.round((Date.now() - workStart) / 1000) : worked);
  const saveTime = async () => {
    const mins = Math.round(bank() / 60);
    if (mins > 0 && task) await H.updateTask(task.id, { focusMinutes: (task.focusMinutes || 0) + mins });
    setWorked(0); setWorkStart(null);
  };
  const close = async () => { await saveTime(); closeOverlay(); };
  if (!task) return null;
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  const startPause = () => {
    if (running) { // pause
      if (phase === "work" && workStart) { setWorked((w) => w + Math.round((Date.now() - workStart) / 1000)); setWorkStart(null); }
      setEndAt(null);
    } else {
      setEndAt(Date.now() + left * 1000);
      if (phase === "work") setWorkStart(Date.now());
    }
  };
  return (
    <FlowShell title="🎯 Focus" onClose={close}>
      <div className="focus">
        <div className="f-title">{task.title}</div>
        <div className="timer" aria-live="off">{mm}:{ss}</div>
        <div className="quiet">{phase === "work" ? (mode === "pomodoro" ? "Focus · 25" : `Focus · ${custom}`) : "Break · 5"}{task.focusMinutes ? ` · ${C.fmtMinutes(task.focusMinutes)} so far` : ""}</div>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <Seg label="Timer" value={mode} onChange={(v) => { setMode(v); setEndAt(null); setPhase("work"); }} options={[{ id: "pomodoro", name: "25 / 5" }, { id: "custom", name: "Custom" }]} />
          {mode === "custom" && <NumField className="field sm" style={{ width: 80 }} value={custom} onChange={setCustom} aria-label="Minutes" />}
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 14, gap: 10 }}>
          <button className="btn primary" onClick={startPause}>{running ? "⏸ Pause" : left < workLen && phase === "work" ? "▶ Resume" : "▶ Start"}</button>
          <button className="btn" onClick={async () => { setEndAt(null); await saveTime(); setPhase("work"); setLeft(workLen); }}>■ Stop</button>
        </div>
        {(task.checklist || []).length > 0 && (
          <div className="card" style={{ marginTop: 18, textAlign: "left" }}>
            {task.checklist.map((c) => (
              <div key={c.id} className={"subtask" + (c.done ? " done" : "")}>
                <Check square on={c.done} onToggle={(v) => H.updateTask(task.id, { checklist: task.checklist.map((x) => (x.id === c.id ? { ...x, done: v } : x)) })} />
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        )}
        {task.notes && <div className="card notes-md" style={{ marginTop: 10, textAlign: "left" }} onClick={(e) => { const b = (e.target as HTMLElement).closest("[data-line]") as HTMLElement | null; if (b) void H.updateTask(task.id, { notes: C.toggleNoteLine(task.notes, Number(b.dataset.line)) }); }} dangerouslySetInnerHTML={{ __html: C.renderNotes(task.notes) }} />}
        <button className="btn" style={{ marginTop: 18 }} onClick={async () => { await saveTime(); await A.complete(task.id); closeOverlay(); }}><I n="tick" /> Complete task</button>
      </div>
    </FlowShell>
  );
}

/* ---------- What can I do now? ---------- */
function loadWN(): { ctx?: string | null; mins?: number; energy?: string } { try { return JSON.parse(localStorage.getItem("nest-whatnow") || "{}"); } catch { return {}; } }
export function WhatNow() {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const saved = useMemo(loadWN, []);
  const [ctx, setCtx] = useState<string | null>(saved.ctx ?? null);
  const [mins, setMins] = useState<number>(saved.mins ?? 30);
  const [energy, setEnergy] = useState<string>(saved.energy ?? "med");
  useEffect(() => { try { localStorage.setItem("nest-whatnow", JSON.stringify({ ctx, mins, energy })); } catch { /* private mode */ } }, [ctx, mins, energy]);
  const results = C.bestNow(data, { context: ctx, minutes: mins, energy });
  return (
    <FlowShell title="🧭 What now?">
      <div className="lbl">Where?</div>
      <div className="chips">{[null, ...(s.contexts || [])].map((c) => <button key={c || "any"} className={"chip" + (ctx === c ? " on" : "")} onClick={() => setCtx(c)}>{c || "Anywhere"}</button>)}</div>
      <div className="lbl">Time?</div>
      <div className="chips">{([[5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"], [120, "2h+"]] as const).map(([v, l]) => <button key={v} className={"chip" + (mins === v ? " on" : "")} onClick={() => setMins(v)}>{l}</button>)}</div>
      {s.features.energy && <><div className="lbl">Energy?</div><Seg label="Energy" value={energy} onChange={setEnergy} options={[{ id: "low", name: "Low" }, { id: "med", name: "Med" }, { id: "high", name: "High" }]} /></>}
      <div style={{ height: 14 }} />
      {results.length ? results.map((x) => <TaskRow key={x.id} task={x} data={data} onToggle={() => A.complete(x.id)} />) : <Empty icon="🧭" title="Nothing fits" sub="Another place, more time, or a breather." />}
    </FlowShell>
  );
}

/* ---------- Templates ---------- */
export function Templates(props: { areaId?: string | null; templateId?: string }) {
  const { data } = useHeadData();
  const all = useLiveQuery(() => H.allTemplates(), [], []);
  const [tplId, setTplId] = useState<string | null>(props.templateId ?? null);
  const tpl = all.find((x) => x.id === tplId) || null;
  const areas = C.areaList(data);
  const guessArea = (hint?: string) => props.areaId || areas.find((a) => a.name === hint)?.id || areas[0]?.id || null;
  const [name, setName] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [client, setClient] = useState<{ name?: string; address?: string; phone?: string; price?: string }>({});
  const [start, setStart] = useState("");
  const [deadline, setDeadline] = useState("");
  if (!tpl) {
    return (
      <FlowShell title="📋 Templates">
        <h2>Pick a template</h2><p className="lede detail">Every step is laid out. Change anything after.</p>
        <div className="qd">
          {all.map((x) => (
            <button key={x.id} onClick={() => { setTplId(x.id); setName(x.client ? "" : x.name); setAreaId(guessArea(x.areaHint)); }}>
              <span>{ic(x.icon)}</span><span className="grow" style={{ textAlign: "left" }}><b>{x.name}</b><div className="quiet">{x.description || ""} {x.sections.reduce((n, s) => n + s.tasks.length, 0)} steps</div></span><span className="side"><I n="chevR" /></span>
            </button>
          ))}
        </div>
      </FlowShell>
    );
  }
  const create = async () => {
    const pid = await H.createFromTemplate(tpl, { name: name.trim() || tpl.name, areaId: areaId ?? guessArea(tpl.areaHint), client: tpl.client && (client.name || client.phone || client.address) ? client : null, start: start || null, deadline: deadline || null });
    closeOverlay();
    go("project", pid);
    toast(`📁 ${name.trim() || tpl.name}`);
  };
  return (
    <FlowShell title={"📋 " + tpl.name} onBack={props.templateId ? null : () => setTplId(null)} foot={<><Grow /><button className="btn primary" onClick={() => void once("tpl-create", create)}><I n="project" /> Create</button></>}>
      <h2>{tpl.client ? "New job" : "Set it up"}</h2>
      <div className="stack">
        <input className="field sm" autoFocus value={name} placeholder={tpl.client ? "Smith bathroom remodel" : tpl.name} onChange={(e) => setName(e.target.value)} />
        <select className="field sm" value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value || null)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {tpl.client && (
          <div className="card stack">
            <div className="lbl" style={{ margin: 0 }}><I n="person" /> Client</div>
            <input className="field sm" placeholder="Name" value={client.name || ""} onChange={(e) => setClient({ ...client, name: e.target.value })} />
            <input className="field sm" placeholder="Address" value={client.address || ""} onChange={(e) => setClient({ ...client, address: e.target.value })} />
            <input className="field sm" type="tel" placeholder="Phone" value={client.phone || ""} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
            <input className="field sm" inputMode="decimal" placeholder="Price ($)" value={client.price || ""} onChange={(e) => setClient({ ...client, price: e.target.value })} />
          </div>
        )}
        <div className="two">
          <label><div className="lbl" style={{ margin: "0 0 4px" }}>Start</div><input className="field sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label><div className="lbl" style={{ margin: "0 0 4px" }}>Deadline</div><input className="field sm" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        </div>
        <div className="card">
          <div className="lbl" style={{ margin: 0 }}>Steps</div>
          {tpl.sections.map((s, i) => <div key={i} style={{ marginTop: 6 }}>{s.name && <b style={{ fontSize: 14 }}>{s.name}</b>}{s.tasks.map((x, j) => <div key={j} className="quiet" style={{ padding: "2px 0" }}>○ {x.title}</div>)}</div>)}
        </div>
      </div>
    </FlowShell>
  );
}

/* ---------- Quiet screen (evenings, nights, phone-free days) ---------- */
export function QuietScreen({ q, onOpen }: { q: { kind: "offday" | "night" | "evening"; date: string }; onOpen: () => void }) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const t = C.today();
  const isToday = q.date === t;
  const { tasks, repeats } = C.selectDay(data, q.date);
  const starts = tasks.filter((x) => x.first === q.date);
  const rest = tasks.filter((x) => x.first !== q.date);
  const copy = {
    offday: [`📵 Phone-free ${C.longLabel(t).split(",")[0]}`, "Here's your day. Put the phone down."],
    night: ["🌙 Still night", `Here's today. Full app back at ${C.fmtTime(s.planTime || "07:00")}.`],
    evening: ["🌙 Off for the night", C.isOffDay(s, q.date) ? "Tomorrow is phone-free. Here's what it holds." : "Everything's written down. Here's tomorrow."],
  }[q.kind];
  const Row = ({ x, faint }: { x: Task; faint?: boolean }) => (
    <div className={"q-row" + (faint ? " faint" : "")}>
      {isToday && !faint ? <Check on={x.status === "done"} onToggle={() => (x.status === "done" ? H.uncompleteTask(x.id) : H.completeTask(x.id))} /> : <span className="q-dot">{faint ? "↻" : "•"}</span>}
      <span className="grow">{x.title}{(x.time || x.tod) && <span className="quiet"> · {x.time ? C.fmtTime(x.time) : x.tod}</span>}</span>
    </div>
  );
  return (
    <div className="quietscr">
      <h1 className="sentence">{copy[0]}</h1>
      <p className="lede">{copy[1]}</p>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="date">{isToday ? "Today" : "Tomorrow"} · {C.longLabel(q.date)}</div>
        {!tasks.length && !repeats.length && <div className="quiet" style={{ padding: "10px 0" }}>Nothing planned. A free day.</div>}
        {starts.length > 0 && <><div className="lbl">Start with</div>{starts.map((x) => <Row key={x.id} x={x} />)}</>}
        {rest.length > 0 && <>{starts.length > 0 && <div className="lbl">Then</div>}{rest.map((x) => <Row key={x.id} x={x} />)}</>}
        {repeats.map((x) => <Row key={"r" + x.id} x={x} faint />)}
      </div>
      <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => openOverlay("planday", { date: q.date })}><I n="edit" /> Adjust</button>
        <button className="btn sm" onClick={() => openOverlay("quickadd")}><I n="plus" /> Write it down</button>
      </div>
      <button className="linkbtn" style={{ marginTop: 18 }} onClick={onOpen}>Open Head anyway</button>
    </div>
  );
}

export { openTask, blockForTask };
