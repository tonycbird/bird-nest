import { useMemo, useState } from "react";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { HeadData, HeadSettings, Project, Task, TrashEntry } from "../types";
import { go, openOverlay, openTask } from "../useHead";
import { Empty, ic, PageHead, Ring, TaskRow } from "./bits";
import * as A from "./actions";
import { useLiveQuery } from "dexie-react-hooks";
import { putTasksOnRiver } from "../river-bridge";
import { I } from "../../ui/Icon";

/* Clearhead's list views (src/views/lists.js) in Bird dress. */

export interface ViewProps { data: HeadData; s: HeadSettings; }

const toggle = (t: Task) => A.complete(t.id);

export function List(props: { tasks: Task[]; data: HeadData; showWhen?: boolean; showHome?: boolean; empty?: React.ReactNode; right?: (t: Task) => React.ReactNode }) {
  if (!props.tasks.length) return <>{props.empty ?? null}</>;
  return (
    <div className="tlist">
      {props.tasks.map((t) => <TaskRow key={t.id} task={t} data={props.data} onToggle={toggle} showWhen={props.showWhen} showHome={props.showHome} right={props.right?.(t)} />)}
    </div>
  );
}

function Sec(props: { icon?: string; title: string; right?: React.ReactNode; children: React.ReactNode; onTitle?: () => void }) {
  return (
    <section className="hsec">
      <div className="sec-head">
        {props.icon && <span>{props.icon}</span>}
        {props.onTitle ? <button className="grow sec-link" onClick={props.onTitle}>{props.title}</button> : <span className="grow">{props.title}</span>}
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

/* ---------- nudges ("coming up") ---------- */
function Nudges({ data, s }: ViewProps) {
  const t = C.today();
  const hm = C.nowHHMM();
  const out: { key: string; icon: string; title: string; sub?: string; run: () => void }[] = [];
  if (s.lastPlan !== t && hm < "14:00") out.push({ key: "plan", icon: "🌅", title: "Plan my day", run: () => openOverlay("plan") });
  if (C.weekday(t) === s.reviewDay && s.lastReview !== t && hm >= (s.reviewTime || "19:00")) out.push({ key: "review", icon: "🗓", title: "Weekly review", run: () => openOverlay("review") });
  if (hm >= (s.shutdownTime || "19:00") && s.lastShutdown !== t) out.push({ key: "shutdown", icon: "⏻", title: "Shutdown", sub: "Close out today", run: () => openOverlay("shutdown") });
  const fu = C.selectWaiting(data).filter((x) => x.waiting?.followUp && x.waiting.followUp <= t);
  if (fu.length) out.push({ key: "fu", icon: "⏳", title: fu.length === 1 ? `Follow up · ${fu[0].waiting!.who}` : `${fu.length} follow-ups due`, sub: fu.length === 1 ? fu[0].title : undefined, run: () => (fu.length === 1 ? openTask(fu[0].id) : go("waiting")) });
  for (const x of [...data.tasks.values()].filter((x) => C.isOpen(x) && x.when === t && x.time && x.time >= hm).slice(0, 2)) {
    const [h, m] = x.time!.split(":").map(Number), [nh, nm] = hm.split(":").map(Number);
    if (h * 60 + m - (nh * 60 + nm) <= 120) out.push({ key: "soon-" + x.id, icon: "⏰", title: x.title, sub: C.fmtTime(x.time), run: () => openTask(x.id) });
  }
  for (const p of [...data.projects.values()].filter((p) => p.status === "active" && p.deadline && C.diffDays(t, p.deadline) >= 0 && C.diffDays(t, p.deadline) <= 2)) {
    out.push({ key: "dl-" + p.id, icon: "🚩", title: `${p.name} · due ${C.relLabel(p.deadline).toLowerCase()}`, run: () => go("project", p.id) });
  }
  if (!out.length) return null;
  return (
    <div className="nudges">
      {out.slice(0, 4).map((n) => (
        <button key={n.key} className="nudge" onClick={n.run}><span className="n-ic">{n.icon}</span><span className="grow"><b>{n.title}</b>{n.sub && <small>{n.sub}</small>}</span><span className="quiet"><I n="chevR" /></span></button>
      ))}
    </div>
  );
}

/* ---------- Inbox ---------- */
export function InboxView({ data, s }: ViewProps) {
  const tasks = C.selectInbox(data);
  return (
    <>
      <PageHead kicker="📥 Inbox" title={tasks.length ? `${tasks.length} to sort` : "Inbox zero"} right={tasks.length > 0 && <button className="btn sm primary" onClick={() => openOverlay("process")}><I n="sort" /> Process</button>} />
      <List tasks={tasks} data={data} empty={<Empty icon="📥" title="All sorted" sub="Everything has a home." />} />
      <Nudges data={data} s={s} />
    </>
  );
}

/* ---------- Today (Head's list for today) ---------- */
export function TodayView({ data, s }: ViewProps) {
  const { main, overdue, groups } = C.selectToday(data);
  const [openOver, setOpenOver] = useState<boolean | null>(null);
  const overOpen = openOver ?? overdue.length <= 3;
  const t = C.today();
  const doneToday = [...data.tasks.values()].filter((x) => x.status === "done" && x.doneAt && C.ymd(new Date(x.doneAt)) === t && !x.grocery);
  const [showDone, setShowDone] = useState(false);
  const multi = (["start", "morning", "afternoon", "evening"] as const).some((k) => groups[k].length);
  const G: [keyof typeof groups, string, string][] = [["start", "Start with", "▶"], ["morning", "Morning", "🌅"], ["afternoon", "Afternoon", "☀"], ["evening", "Evening", "🌙"], ["anytime", multi ? "Anytime today" : "", "◌"]];
  return (
    <>
      <PageHead kicker={"⭐ " + C.longLabel(t)} title={main.length ? `${main.length} for today` : "Today"}
        right={<>
          <button className="btn sm" onClick={() => openOverlay("plan")}><I n="morning" /> Plan</button>
          <button className="iconbtn" aria-label="More" onClick={() => A.openMenu("Today", [
            { text: "Put today on the River", icon: "🌊", run: async () => toast("🌊 On the River", await putTasksOnRiver(main.filter(C.isOpen).map((x) => x.id))) },
            { text: "What can I do now?", icon: "🧭", run: () => openOverlay("whatnow") },
            { text: "Shutdown", icon: "⏻", run: () => openOverlay("shutdown") },
            { text: "Plan tomorrow", icon: "📅", run: () => openOverlay("planday", { date: C.addDays(C.today(), 1) }) },
          ])}><I n="more" /></button>
        </>} />
      <Nudges data={data} s={s} />
      {overdue.length > 0 && (
        <section className="hsec over">
          <div className="sec-head" role="button" onClick={() => setOpenOver(!overOpen)}>
            <span><I n="warn" /></span><span className="grow">From earlier · {overdue.length}</span>
            <button className="btn sm" onClick={async (e) => {
              e.stopPropagation();
              const us: H.Undo[] = [];
              for (const x of overdue) us.push(await H.updateTask(x.id, { when: t }));
              toast("⭐ Moved to today", async () => { for (const u of us) await u(); });
            }}><I n="arrow" /> Today</button>
          </div>
          {overOpen && <List tasks={overdue} data={data} showWhen />}
        </section>
      )}
      {main.length ? G.filter(([k]) => groups[k].length).map(([k, label, icon]) => (
        <section key={k} className="hsec">
          {label && <div className="sec-head"><span>{icon}</span><span className="grow">{label}</span></div>}
          <List tasks={groups[k]} data={data} showWhen={false} />
        </section>
      )) : !overdue.length && (
        <Empty icon="✓" title="All clear" sub={doneToday.length ? `${doneToday.length} done today.` : "Nothing planned. Pull from Anytime, or rest."}>
          <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="btn sm" onClick={() => go("anytime")}><I n="layers" /> Anytime</button>
            <button className="btn sm" onClick={() => openOverlay("whatnow")}><I n="compass" /> What now?</button>
          </div>
        </Empty>
      )}
      {main.length > 0 && doneToday.length > 0 && (
        <>
          <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? "▾ Hide done" : `▸ ${doneToday.length} done today`}</button>
          {showDone && <List tasks={doneToday} data={data} showWhen={false} />}
        </>
      )}
    </>
  );
}

/* ---------- Upcoming ---------- */
export function UpcomingView({ data, s }: ViewProps) {
  const { tasks, previews } = useMemo(() => C.selectUpcoming(data), [data]);
  const buckets = C.upcomingBuckets(s.weekStart ?? 1);
  const [showLater, setShowLater] = useState(false);
  const inB = (b: { from: string; to: string }, d: string) => d >= b.from && d <= b.to;
  const t = C.today();
  if (!tasks.length && !previews.length) return <><PageHead kicker="📅 Upcoming" title="Ahead" /><Empty icon="📅" title="Nothing scheduled" sub="Give a task a date and it shows up here." /></>;
  return (
    <>
      <PageHead kicker="📅 Upcoming" title="Ahead" right={<button className="btn sm" onClick={() => openOverlay("review")}><I n="calendar" /> Review</button>} />
      {buckets.map((b) => {
        if (b.kind === "later" && !showLater) {
          const n = tasks.filter((x) => inB(b, x.date)).length;
          return n ? <button key="later" className="linkbtn" onClick={() => setShowLater(true)}>▸ Later · {n}</button> : null;
        }
        const items = tasks.filter((x) => inB(b, x.date)).sort((a, z) => a.date.localeCompare(z.date) || (a.task.order || 0) - (z.task.order || 0));
        const seen = new Set<string>();
        const pv = previews.filter((x) => {
          if (!inB(b, x.date)) return false;
          const daily = x.task.repeat && (x.task.repeat.freq === "day" || (x.task.repeat.freq === "week" && (x.task.repeat.days || []).length >= 5));
          if (daily && C.diffDays(t, x.date) > 7) return false;
          if (b.kind !== "day") { if (seen.has(x.task.id)) return false; seen.add(x.task.id); }
          return true;
        });
        const isDay = b.kind === "day";
        if (!isDay && !items.length && !pv.length) return null;
        const d = C.parseYmd(b.from);
        const empty = !items.length && !pv.length;
        const head = isDay
          ? <div className={"sec-head day" + (empty ? " empty" : "")}><span className="daynum">{d.getDate()}</span><span className="grow">{C.diffDays(t, b.from) === 1 ? "Tomorrow" : C.longLabel(b.from).split(",")[0]}{(d.getDate() === 1 || C.diffDays(t, b.from) === 1) ? <span className="quiet"> · {C.monthLabel(b.from)}</span> : null}</span>{C.isOffDay(s, b.from) && <span className="pill"><I n="quiet" /></span>}</div>
          : <div className="sec-head big">{b.kind === "week" ? `${C.MON_SHORT[d.getMonth()]} ${d.getDate()} – ${C.parseYmd(b.to).getDate()}` : b.kind === "month" ? C.monthLabel(b.from) : "Later"}</div>;
        return (
          <section key={b.key} className="hsec">
            {head}
            <List tasks={items.map((x) => x.task)} data={data} showWhen={!isDay} />
            {pv.map((x) => <div key={x.task.id + x.date} className="task preview"><span className="ck ghost"><I n="refresh" /></span><div className="t-body"><div className="t-title">{x.task.title}</div>{!isDay && <div className="t-meta"><span>{C.relLabel(x.date)}</span></div>}</div></div>)}
          </section>
        );
      })}
    </>
  );
}

/* ---------- Anytime ---------- */
export function AnytimeView({ data, s }: ViewProps) {
  const [ctx, setCtx] = useState<string | null>(null);
  const [energy, setEnergy] = useState<string | null>(null);
  const [maxTime, setMaxTime] = useState<number | null>(null);
  const tasks = C.selectAnytime(data, { context: ctx, energy, maxTime });
  const groups = C.areaList(data).map((a) => {
    const at = tasks.filter((t) => C.areaOfTask(t, data)?.id === a.id);
    const loose = at.filter((t) => !t.projectId);
    const byProj = new Map<string, Task[]>();
    for (const t of at.filter((x) => x.projectId)) { if (!byProj.has(t.projectId!)) byProj.set(t.projectId!, []); byProj.get(t.projectId!)!.push(t); }
    return { a, loose, projects: [...byProj.entries()].map(([pid, ts]) => ({ p: data.projects.get(pid)!, ts })).filter((x) => x.p).map((x) => ({ ...x, ts: C.sortProjectTasks(x.p, x.ts) })) };
  }).filter((g) => g.loose.length || g.projects.length);
  const filtered = ctx || energy || maxTime;
  return (
    <>
      <PageHead kicker="🗂 Anytime" title="Ready when you are" />
      <div className="filters">{(s.contexts || []).map((c) => <button key={c} className={"chip" + (ctx === c ? " on" : "")} onClick={() => setCtx(ctx === c ? null : c)}>{c}</button>)}</div>
      {(s.features.energy || s.features.estimates) && (
        <div className="filters">
          {s.features.energy && ([["low", "🔋 Low"], ["med", "Med"], ["high", "⚡ High"]] as const).map(([id, n]) => <button key={id} className={"chip" + (energy === id ? " on" : "")} onClick={() => setEnergy(energy === id ? null : id)}>{n}</button>)}
          {s.features.estimates && ([[15, "≤15m"], [30, "≤30m"], [60, "≤1h"], [120, "≤2h"]] as const).map(([m, n]) => <button key={m} className={"chip" + (maxTime === m ? " on" : "")} onClick={() => setMaxTime(maxTime === m ? null : m)}>{n}</button>)}
        </div>
      )}
      {!groups.length && <Empty icon="🗂" title={filtered ? "Nothing matches" : "Nothing here yet"} sub={filtered ? "Fewer filters." : "Tasks with an area and no date land here."} />}
      {groups.map(({ a, loose, projects }) => (
        <Sec key={a.id} icon={ic(a.icon)} title={a.name} onTitle={() => go("area", a.id)}>
          <List tasks={loose} data={data} showHome={false} />
          {projects.map(({ p, ts }) => (
            <div key={p.id} style={{ marginTop: 6 }}>
              <button className="subhead" onClick={() => go("project", p.id)}><I n="project" /> {p.name}</button>
              <List tasks={ts} data={data} showHome={false} />
            </div>
          ))}
        </Sec>
      ))}
    </>
  );
}

/* ---------- Someday ---------- */
export function ProjectLine({ p, data }: { p: Project; data: HeadData }) {
  const a = p.areaId ? data.areas.get(p.areaId) : null;
  const st = C.projectStats(data, p);
  return (
    <button className="proj-row" onClick={() => go("project", p.id)}>
      <Ring pct={st.pct} size={22} /><span className="grow">{p.name}</span>{a && <span className="quiet">{a.name}</span>}<span className="quiet"><I n="chevR" /></span>
    </button>
  );
}

export function SomedayView({ data }: ViewProps) {
  const { tasks, projects } = C.selectSomeday(data);
  return (
    <>
      <PageHead kicker="💤 Someday" title="Parked" />
      {projects.length > 0 && <Sec title="Projects">{projects.map((p) => <ProjectLine key={p.id} p={p} data={data} />)}</Sec>}
      <section className="hsec">
        {projects.length > 0 && tasks.length > 0 && <div className="sec-head"><span className="grow">Tasks</span></div>}
        <List tasks={tasks} data={data} empty={!projects.length && <Empty icon="💤" title="Nothing parked" sub="Not-for-now ideas wait here. Weekly review checks them." />} />
      </section>
    </>
  );
}

/* ---------- Waiting ---------- */
export function WaitingView({ data }: ViewProps) {
  const tasks = C.selectWaiting(data);
  const t = C.today();
  return (
    <>
      <PageHead kicker="⏳ Waiting" title="Others owe you" />
      {!tasks.length && <Empty icon="⏳" title="Not waiting on anyone" sub="Mark a task Waiting when you hand it off." />}
      <List tasks={tasks} data={data} right={(x) => {
        const due = !!x.waiting?.followUp && x.waiting.followUp <= t;
        return (
          <div className="wait-side" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Follow up" className={"btn sm" + (due ? " primary" : "")} onClick={() => A.followUp(x)}><I n="arrow" /></button>
            <div className="quiet" style={{ fontSize: 12 }}>{x.waiting?.since ? C.relLabel(x.waiting.since) : ""}</div>
          </div>
        );
      }} />
    </>
  );
}

/* ---------- Logbook ---------- */
export function LogbookView({ data }: ViewProps) {
  const [q, setQ] = useState("");
  const list = C.selectLogbook(data).filter((x) => !x.grocery && (!q || x.title.toLowerCase().includes(q.toLowerCase())));
  const byDay = new Map<string, Task[]>();
  for (const t of list.slice(0, 400)) {
    const d = C.ymd(new Date(t.doneAt || t.updatedAt));
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(t);
  }
  return (
    <>
      <PageHead kicker="✅ Logbook" title={`${list.length} done`} />
      <input className="field sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.length && <Empty icon="✅" title={q ? "No matches" : "Nothing yet"} sub="Finished tasks land here, by day." />}
      {[...byDay.entries()].map(([d, ts]) => <Sec key={d} title={C.relLabel(d, { long: true })}><List tasks={ts} data={data} showWhen={false} /></Sec>)}
    </>
  );
}

/* ---------- Recently deleted ---------- */
export function TrashView({ data }: ViewProps) {
  void data;
  const items = useLiveQuery(() => H.loadTrash(), [], null as TrashEntry[] | null);
  const primaries = (items || []).filter((x) => x.primary);
  return (
    <>
      <PageHead kicker="🗑 Recently deleted" title="Kept 30 days" />
      {items && !primaries.length && <Empty icon="🗑" title="Nothing deleted" />}
      {primaries.map((x) => {
        const n = (items || []).filter((y) => y.group === x.group).length - 1;
        const name = "title" in x.item ? x.item.title : x.item.name;
        return (
          <div key={x.id} className="kv">
            <span style={{ minWidth: 0 }}>{x.kind === "tasks" ? "☐" : x.kind === "projects" ? "📁" : "▣"} {name}{n > 0 && <span className="quiet"> +{n}</span>}<div className="quiet" style={{ fontSize: 12 }}>{C.timeAgo(x.deletedAt)}</div></span>
            <span className="row" style={{ gap: 6 }}>
              <button aria-label="Restore" className="btn sm" onClick={async () => { await H.restoreGroup(x.group); toast("↺ Restored"); }}><I n="undo" /></button>
              <button className="btn sm" onClick={async () => {
                if (!(await A.confirm("Delete forever?", undefined, "🗑 Delete", true))) return;
                for (const y of (items || []).filter((y) => y.group === x.group)) await H.purgeTrashItem(y);
              }}><I n="close" /></button>
            </span>
          </div>
        );
      })}
    </>
  );
}

/* ---------- Search ---------- */
export function SearchView({ data }: ViewProps) {
  const [q, setQ] = useState("");
  const r = C.searchAll(data, q);
  return (
    <>
      <PageHead kicker="🔍 Search" title="Find" />
      <input className="field" autoFocus placeholder="Tasks, projects, notes, clients" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && !r.tasks.length && !r.projects.length && !r.areas.length && <Empty icon="🔍" title="No matches" />}
      {(r.areas.length > 0 || r.projects.length > 0) && (
        <Sec title="Areas · projects">
          {r.areas.map((a) => <button key={a.id} className="proj-row" onClick={() => go("area", a.id)}><span>{ic(a.icon)}</span><span className="grow">{a.name}</span></button>)}
          {r.projects.map((p) => <ProjectLine key={p.id} p={p} data={data} />)}
        </Sec>
      )}
      {r.tasks.length > 0 && <Sec title="Tasks"><List tasks={r.tasks} data={data} /></Sec>}
    </>
  );
}
