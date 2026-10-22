import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { once } from "../../lib/once";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import { closeOverlay, useHeadData, useHeadSettings } from "../useHead";
import { moveItem, planDump, sortDump, type DumpDest, type DumpItem, type DumpProject } from "../dump-sort";
import { Check } from "./bits";
import { FlowShell } from "./flows";
import { openSheet } from "./sheets";
import { DatePicker, MovePicker, type MoveResult, type WhenResult } from "./pickers";
import { putTaskOnRiver } from "../river-bridge";
import { openMenu } from "./actions";
import { useDictation } from "./ramble";
import { I, Icon, type IconName } from "../../ui/Icon";
import { colorFor, taskIcon } from "../../ui/colors";

/* Brain dump: get everything out of your head in one place, then let Nest separate it.
   1) Write or talk, run-on is fine.  2) Nest splits it into things and sorts each one:
   today, a date, no date yet, shopping, someday, or just a thought.  3) Fix anything, put it all away. */

const DRAFT = "nest-dump-draft";
const loadDraft = () => { try { return localStorage.getItem(DRAFT) || ""; } catch { return ""; } };
/** Quick add hands a long, many-things line over to the dump. */
export function sendToDump(t: string) {
  const old = loadDraft().trim();
  saveDraft(old ? old + "\n" + t : t);
}
const saveDraft = (t: string) => { try { if (t) localStorage.setItem(DRAFT, t); else localStorage.removeItem(DRAFT); } catch { /* private mode */ } };

const SECTIONS: { d: DumpDest; label: string; icon: IconName; color: string }[] = [
  { d: "today", label: "Today", icon: "today", color: "var(--accent)" },
  { d: "date", label: "Coming up", icon: "calendar", color: "var(--c-stretch)" },
  { d: "later", label: "No date yet", icon: "inbox", color: "var(--c-head)" },
  { d: "shop", label: "Shopping", icon: "groceries", color: "var(--c-home)" },
  { d: "someday", label: "Someday", icon: "sleep", color: "var(--c-rest)" },
  { d: "thought", label: "Thoughts", icon: "talk", color: "var(--c-cal)" },
];

function useDump(onDone?: (ids: string[]) => void) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [text, setText] = useState(loadDraft);
  const [items, setItems] = useState<DumpItem[] | null>(null);
  const [projects, setProjects] = useState<DumpProject[]>([]);
  const later = useDeferredValue(text);
  useEffect(() => { saveDraft(text); }, [text]);
  const found = useMemo(() => (later.trim() ? sortDump(later, data, s).length : 0), [later, data, s]);
  const dict = useDictation((said) => setText((x) => (x && !/\s$/.test(x) ? x + " " : x) + said));
  const kept = (items ?? []).filter((i) => i.keep);

  const sort = () => { dict.stop(); const plan = planDump(text, data, s); setItems(plan.items); setProjects(plan.projects); };
  const update = (id: string, patch: Partial<DumpItem> | ((it: DumpItem) => DumpItem)) =>
    setItems((xs) => (xs ?? []).map((x) => (x.id === id ? (typeof patch === "function" ? patch(x) : { ...x, ...patch }) : x)));
  const updateProject = (key: string, patch: Partial<DumpProject>) => setProjects((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const back = () => { setItems(null); setProjects([]); };

  async function putAway() {
    const ids: string[] = [];
    const made: string[] = [];
    const river: (() => Promise<void>)[] = [];
    const groc = C.areaList(data).find((a) => a.listMode === "groceries");
    const today = C.today();
    // New projects first, so their steps can go in, in the order they were said.
    const projectIds = new Map<string, string>();
    for (const pr of projects) {
      if (!pr.on || !kept.some((i) => i.newProject === pr.key)) continue;
      const id = await H.createProject({ name: pr.name.trim() || "New project", areaId: pr.areaId, outcome: pr.outcome ?? "", deadline: pr.deadline, status: "active" });
      projectIds.set(pr.key, id);
      made.push(id);
    }
    const into: Record<string, number> = {};
    let order = Date.now();
    for (const it of kept) {
      if (it.dest === "thought") continue;
      if (it.dest === "shop") {
        const t = groc ? await H.addGrocery(it.title, groc.id) : await H.createTask({ title: "Buy " + it.title.toLowerCase() });
        if (t) ids.push(t.id);
        continue;
      }
      const projectId = (it.newProject && projectIds.get(it.newProject)) || (it.newProject ? null : it.projectId);
      const when = it.dest === "today" ? today : it.dest === "date" ? it.when : null;
      const t = await H.createTask({
        title: it.title, notes: it.notes ?? "", when, due: it.dest === "someday" ? null : it.due, time: it.time, tod: (it.tod ?? null) as never,
        est: it.est, contexts: it.contexts, repeat: it.repeat ?? null, areaId: it.areaId, projectId, someday: it.dest === "someday", order: order++,
      });
      ids.push(t.id);
      if (projectId) { const name = projectId && (data.projects.get(projectId)?.name ?? projects.find((x) => projectIds.get(x.key) === projectId)?.name); if (name) into[name] = (into[name] ?? 0) + 1; }
      // A time today puts it on the River now (later days get there on their own).
      if (it.time && when === today) river.push(await putTaskOnRiver(t.id, today));
    }
    const thoughts = kept.filter((i) => i.dest === "thought");
    if (thoughts.length) {
      const t = await H.createTask({ title: `Thoughts · ${C.relLabel(C.today())}`, notes: thoughts.map((x) => "- " + x.title).join("\n"), someday: true });
      ids.push(t.id);
    }
    const where = Object.entries(into).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${c} to ${n}`);
    const todayN = kept.filter((i) => i.dest === "today").length;
    const parts = [...where, ...(todayN ? [`${todayN} today`] : [])].slice(0, 2);
    toast(`✓ ${kept.length} put away${parts.length ? " · " + parts.join(" · ") : ""}`, async () => {
      for (const u of river) await u();
      for (const id of ids) await H.deleteTask(id);
      for (const id of made) await H.deleteProject(id);
    });
    saveDraft("");
    setText("");
    back();
    onDone?.(ids);
  }
  return { text, setText, items, setItems, projects, updateProject, back, found, kept, sort, update, putAway, dict };
}
type Dump = ReturnType<typeof useDump>;

function WriteStep({ d, bare }: { d: Dump; bare?: boolean }) {
  return (
    <>
      {!bare && <><h2>Empty your head</h2><p className="lede">Type or talk. Run-on is fine. Nest sorts it into tasks, days and projects.</p></>}
      <textarea className="dump" autoFocus aria-label="Brain dump" value={d.text} onChange={(e) => d.setText(e.target.value)}
        placeholder={"for the smith job pick up trim tomorrow then install it thursday, call dave about the quote because he wasn't sure on paint, out of milk and diapers, greek reading due friday…"} />
      {d.dict.interim && <p className="quiet" style={{ marginTop: 6 }}>{d.dict.interim}…</p>}
      <div className="dump-tools">
        {d.dict.supported
          ? <button className={"btn sm" + (d.dict.on ? " rec" : "")} onClick={d.dict.on ? d.dict.stop : d.dict.start}><I n="mic" /> {d.dict.on ? "Stop" : "Talk"}</button>
          : <span className="quiet">Tip: the mic on your keyboard works here.</span>}
        <span className="grow" />
        {d.found > 0 && <span className="pill">{d.found} found</span>}
      </div>
    </>
  );
}

function SortStep({ d }: { d: Dump }) {
  const { data } = useHeadData();
  const items = d.items ?? [];
  async function move(it: DumpItem) {
    const go = (dest: DumpDest, date?: string | null) => d.update(it.id, (x) => moveItem(x, dest, date));
    const inProject = !!(it.projectId || it.newProject);
    await openMenu(it.title, [
      { text: "Today", icon: "today", run: () => go("today") },
      { text: "Tomorrow", icon: "morning", run: () => go("date", C.addDays(C.today(), 1)) },
      { text: "Pick a day", icon: "calendar", run: async () => { const r = await openSheet<WhenResult>(DatePicker, { value: it.when, mode: "when" }); if (r?.when) go(r.when === C.today() ? "today" : "date", r.when); else if (r?.someday) go("someday"); } },
      { text: "No date yet", icon: "inbox", run: () => go("later") },
      "-",
      { text: "Into a project or list", icon: "project", run: async () => { const r = await openSheet<MoveResult>(MovePicker, { title: "Where does it go?" }); if (r) d.update(it.id, { projectId: r.projectId, areaId: r.areaId, newProject: null, dest: it.dest === "shop" || it.dest === "thought" ? "later" : it.dest }); } },
      ...(inProject ? [{ text: "Not in a project", icon: "close", run: () => d.update(it.id, { projectId: null, newProject: null }) }] : []),
      "-",
      { text: "Shopping list", icon: "groceries", run: () => go("shop") },
      { text: "Someday", icon: "sleep", run: () => go("someday") },
      { text: "Just a thought", icon: "talk", run: () => go("thought") },
    ] as never);
  }
  if (!items.length) return <><h2>Nothing to sort</h2><p className="lede">Go back and write a little more.</p></>;

  // Projects first (the ones this dump would make, then ones you have), then everything else by when.
  const offered = d.projects.filter((pr) => items.some((i) => i.newProject === pr.key));
  const liveNew = new Set(offered.filter((p) => p.on).map((p) => p.key));
  const inNew = (i: DumpItem) => !!i.newProject && liveNew.has(i.newProject);
  const existing = [...new Set(items.filter((i) => !inNew(i) && i.projectId && i.dest !== "shop" && i.dest !== "thought").map((i) => i.projectId!))]
    .map((id) => data.projects.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const loose = items.filter((i) => !inNew(i) && !(i.projectId && i.dest !== "shop" && i.dest !== "thought" && data.projects.get(i.projectId)));
  const row = (it: DumpItem, grouped: boolean) => <Row key={it.id} it={it} data={data} grouped={grouped} onChange={(p) => d.update(it.id, p)} onMove={() => void move(it)} />;

  return (
    <>
      <h2>{d.kept.length} {d.kept.length === 1 ? "thing" : "things"}</h2>
      <p className="lede">Tap a name to fix it. <I n="arrow" /> moves it. Uncheck to leave it out.</p>
      {offered.map((pr) => {
        const steps = items.filter((i) => i.newProject === pr.key);
        return (
          <section key={pr.key} className={"hsec dsec dproj" + (pr.on ? "" : " off")}>
            <div className="dproj-head">
              <span className="d-ic" style={{ ["--k" as string]: "var(--c-head)" } as CSSProperties}><Icon n="project" size={15} /></span>
              <div className="grow">
                <div className="dproj-kick">New project{pr.deadline ? ` · due ${C.relLabel(pr.deadline)}` : ""}</div>
                <input className="d-in dproj-name" value={pr.name} aria-label="Project name" onChange={(e) => d.updateProject(pr.key, { name: e.target.value })} />
              </div>
              <input type="checkbox" className="switch" aria-label={`Make project ${pr.name}`} checked={pr.on} onChange={(e) => d.updateProject(pr.key, { on: e.target.checked })} />
            </div>
            {pr.on && <div className="tlist">{steps.map((it) => row(it, true))}</div>}
          </section>
        );
      })}
      {existing.map((p) => {
        const list = items.filter((i) => !inNew(i) && i.projectId === p.id && i.dest !== "shop" && i.dest !== "thought");
        return (
          <section key={p.id} className="hsec dsec">
            <div className="sec-head"><span style={{ color: "var(--c-head)", display: "inline-flex" }}><Icon n="project" size={16} /></span>{p.name} · {list.length}</div>
            <div className="tlist">{list.map((it) => row(it, true))}</div>
          </section>
        );
      })}
      {SECTIONS.map((sec) => {
        const list = loose.filter((i) => i.dest === sec.d);
        if (!list.length) return null;
        return (
          <section key={sec.d} className="hsec dsec">
            <div className="sec-head"><span style={{ color: sec.color, display: "inline-flex" }}><Icon n={sec.icon} size={16} /></span>{sec.label} · {list.length}</div>
            <div className="tlist">{list.map((it) => row(it, false))}</div>
          </section>
        );
      })}
    </>
  );
}

function Row({ it, data, grouped, onChange, onMove }: { it: DumpItem; data: ReturnType<typeof useHeadData>["data"]; grouped: boolean; onChange: (p: Partial<DumpItem>) => void; onMove: () => void }) {
  const home = it.projectId ? data.projects.get(it.projectId) : null;
  const area = it.areaId ? data.areas.get(it.areaId) : null;
  const icon: IconName = it.dest === "shop" ? "groceries" : it.dest === "thought" ? "talk" : taskIcon(it.title, area?.icon);
  const meta: ReactNode[] = [];
  if (it.when && (it.dest === "date" || (grouped && it.dest !== "today"))) meta.push(<span key="w"><I n="calendar" /> {C.relLabel(it.when)}</span>);
  if (grouped && it.dest === "today") meta.push(<span key="w"><I n="today" /> Today</span>);
  if (it.time) meta.push(<span key="t"><I n="later" /> {C.fmtTime(it.time)}</span>);
  else if (it.tod) meta.push(<span key="t">{it.tod}</span>);
  if (it.due) meta.push(<span key="d"><I n="flag" /> {C.relLabel(it.due)}</span>);
  if (it.repeat) meta.push(<span key="r"><I n="refresh" /> {C.describeRule(it.repeat)}</span>);
  if (it.est) meta.push(<span key="e"><I n="timer" /> {C.fmtMinutes(it.est)}</span>);
  if (grouped && it.dest === "someday") meta.push(<span key="s"><I n="sleep" /> Someday</span>);
  if (!grouped && home) meta.push(<span key="p"><I n="project" /> {home.name}</span>);
  else if (!grouped && area && it.dest !== "shop" && it.dest !== "thought") meta.push(<span key="a">{area.name}</span>);
  if (it.notes) meta.push(<span key="n" title={it.notes}><I n="doc" /> note</span>);
  return (
    <div className={"task drow" + (it.keep ? "" : " off")}>
      <Check on={it.keep} onToggle={(v) => onChange({ keep: v })} label={it.keep ? "Leave out" : "Keep"} />
      <span className="d-ic" style={{ ["--k" as string]: colorFor(icon, "head") } as CSSProperties}><Icon n={icon} size={15} /></span>
      <div className="t-body">
        <input className="d-in" value={it.title} aria-label="Name" onChange={(e) => onChange({ title: e.target.value })} />
        {meta.length > 0 && <div className="t-meta">{meta}</div>}
      </div>
      <button className="iconbtn sm" aria-label={"Move " + it.title} onClick={onMove}><Icon n="arrow" size={16} tone={false} /></button>
    </div>
  );
}

/** The full-screen Brain dump (＋ → Dump, Head → Dump). */
export function DumpFlow() {
  const d = useDump(() => closeOverlay());
  const sorting = d.items !== null;
  const foot = sorting
    ? <><button className="btn" onClick={d.back}><I n="chevL" /> Back</button><span className="grow" />
        <button className="btn primary" disabled={!d.kept.length} onClick={() => void once("dump-put", d.putAway)}><I n="tick" /> Put away {d.kept.length || ""}</button></>
    : <>{d.text && <button className="btn" onClick={() => d.setText("")}>Clear</button>}<span className="grow" />
        <button className="btn primary" disabled={!d.found} onClick={d.sort}>Sort{d.found ? ` ${d.found}` : ""} <I n="chevR" /></button></>;
  return (
    <FlowShell title="Brain dump" onBack={sorting ? d.back : null} foot={foot}>
      {sorting ? <SortStep d={d} /> : <WriteStep d={d} />}
    </FlowShell>
  );
}

/** Inside Shutdown and Weekly review: the same dump, without its own screen. */
export function DumpInline(props: { onDone?: (ids: string[]) => void }) {
  const d = useDump(props.onDone);
  const sorting = d.items !== null;
  return (
    <div className="qa">
      {sorting ? <SortStep d={d} /> : <WriteStep d={d} bare />}
      <div className="row" style={{ marginTop: 12 }}>
        {sorting && <button className="btn sm" onClick={d.back}><I n="chevL" /> Back</button>}
        <span className="grow" />
        {sorting
          ? <button className="btn primary" disabled={!d.kept.length} onClick={() => void once("dump-put", d.putAway)}><I n="tick" /> Put away {d.kept.length || ""}</button>
          : <button className="btn primary" disabled={!d.found} onClick={d.sort}>Sort{d.found ? ` ${d.found}` : ""} <I n="chevR" /></button>}
      </div>
    </div>
  );
}
