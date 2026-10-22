import { useEffect, useRef, useState } from "react";
import * as C from "./core/clearhead.js";
import * as H from "./store";
import { toast } from "../lib/toast";
import { saveBlob } from "../lib/backup";
import type { HeadView } from "./useHead";
import { backFrom, closeOverlay, go, goBack, nav, openOverlay, useHeadData, useHeadSettings } from "./useHead";
import { AnytimeView, InboxView, LogbookView, SearchView, SomedayView, TodayView, TrashView, UpcomingView, WaitingView } from "./ui/views";
import { AreaView, GroceryList, ProjectsView, ProjectView } from "./ui/projects";
import { DetailHost } from "./ui/detail";
import { SheetHost } from "./ui/sheets";
import { QuickAdd } from "./ui/capture";
import { Focus, PlanDay, PlanMyDay, ProcessInbox, QuietScreen, Shutdown, Templates, WeeklyReview, WhatNow } from "./ui/flows";
import { Ramble } from "./ui/ramble";
import { DumpFlow } from "./ui/dump";
import { Empty, ic, PageHead } from "./ui/bits";
import * as A from "./ui/actions";
import { BulkBar } from "./ui/bulk";
import { clearMulti, multi } from "./useHead";
import { I, Icon, type IconName } from "../ui/Icon";

/* The Head tab: Clearhead inside Bird Nest. */

function NavChips() {
  const { data } = useHeadData();
  const v = nav.use().view;
  const t = C.today();
  const inbox = C.selectInbox(data).length;
  const todayN = C.selectToday(data).main.filter(C.isOpen).length;
  const waitDue = C.selectWaiting(data).filter((x) => x.waiting?.followUp && x.waiting.followUp <= t).length;
  const groc = C.areaList(data).find((a) => a.listMode === "groceries");
  const items: { v: HeadView; icon: IconName; label: string; n?: number; id?: string }[] = [
    { v: "inbox", icon: "inbox", label: "Inbox", n: inbox },
    { v: "today", icon: "star", label: "Today", n: todayN },
    { v: "upcoming", icon: "calendar", label: "Ahead" },
    { v: "anytime", icon: "layers", label: "Anytime" },
    { v: "projects", icon: "project", label: "Projects" },
    { v: "waiting", icon: "waiting", label: "Waiting", n: waitDue },
    { v: "someday", icon: "sleep", label: "Someday" },
    ...(groc ? [{ v: "area" as HeadView, icon: "groceries" as IconName, label: "Groceries", id: groc.id }] : []),
    { v: "logbook", icon: "check", label: "Done" },
    { v: "search", icon: "search", label: "Find" },
  ];
  return (
    <nav className="hnav" aria-label="Head lists">
      {items.map((x) => (
        <button key={x.v + (x.id || "")} className={"hn" + (v === x.v && (!x.id || nav.get().id === x.id) ? " on" : "")} onClick={() => go(x.v, x.id ?? null)}>
          <span className="hn-ic"><Icon n={x.icon} size={22} tone={v === x.v && (!x.id || nav.get().id === x.id)} />{x.n ? <i>{x.n}</i> : null}</span><span className="hn-l">{x.label}</span>
        </button>
      ))}
    </nav>
  );
}

const DRILL = new Set(["project", "area", "groceries", "settings", "trash"]);
const VIEW_NAME: Record<string, string> = { inbox: "Inbox", today: "Today", upcoming: "Ahead", anytime: "Anytime", someday: "Someday", waiting: "Waiting", logbook: "Done", projects: "Projects", search: "Find", settings: "Settings", trash: "Recently deleted" };

/** A way back from a project, an area, settings or trash. */
function BackLink() {
  const { data } = useHeadData();
  nav.use();
  const b = backFrom();
  const name = !b ? "Today" : b.view === "project" ? data.projects.get(b.id ?? "")?.name ?? "Project" : b.view === "area" ? data.areas.get(b.id ?? "")?.name ?? "Area" : VIEW_NAME[b.view] ?? "Back";
  return <button className="hback" onClick={goBack}><Icon n="chevL" size={18} tone={false} />{name}</button>;
}

function Rituals() {
  const r: [string, IconName, string][] = [["dump", "head", "Dump"], ["process", "sort", "Process"], ["plan", "morning", "Plan"], ["whatnow", "compass", "Now"], ["ramble", "talk", "Ramble"], ["review", "calendar", "Review"], ["shutdown", "shutdown", "Shutdown"]];
  return (
    <div className="rituals">
      {r.map(([k, i, l]) => <button key={k} className="chip" onClick={() => openOverlay(k)}><Icon n={i} size={17} />{l}</button>)}
    </div>
  );
}

export function HeadSettingsView() {
  const s = useHeadSettings();
  const { data } = useHeadData();
  const file = useRef<HTMLInputElement>(null);
  const [newCtx, setNewCtx] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const b = H.readClearhead(JSON.parse(await f.text()));
      const ok = await A.confirm("Import from Clearhead?", `Adds or updates ${(b.tasks || []).length} tasks, ${(b.projects || []).length} projects and ${(b.areas || []).length} areas. Nothing is deleted.`, "⬆ Import");
      if (!ok) return;
      const r = await H.importClearhead(b);
      const c = await H.headCounts();
      setResult(`File: ${r.areas} areas · ${r.projects} projects · ${r.tasks} tasks · ${r.templates} templates\nNest: ${c.areas} areas · ${c.projects} projects · ${c.tasks} tasks (${c.open} open, ${c.done} done)`);
      toast("⬆ Imported");
    } catch (e) { toast("✕ " + (e as Error).message); }
    if (file.current) file.current.value = "";
  };
  const wd = (d: number) => C.WD_SHORT[d];
  return (
    <>
      <PageHead kicker="⚙ Head" title="Settings" />
      <div className="lbl"><I n="upload" /> Clearhead</div>
      <div className="card">
        <p className="quiet">In Clearhead: Settings <I n="arrow" /> Export JSON. Then pick that file here. Safe to run twice.</p>
        <button className="btn primary" style={{ marginTop: 10 }} onClick={() => file.current?.click()}><I n="upload" /> Import Clearhead backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        {result && <pre className="importres">{result}</pre>}
      </div>
      <div className="lbl">@ Contexts</div>
      <div className="chips">
        {(s.contexts || []).map((c) => <span key={c} className="chip tok">{c}<button aria-label={"Remove " + c} onClick={() => H.saveSettings({ contexts: s.contexts.filter((x) => x !== c) })}><I n="close" /></button></span>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="field sm" placeholder="@New" value={newCtx} onChange={(e) => setNewCtx(e.target.value)} />
        <button aria-label="Add context" className="btn sm" onClick={() => { const v = newCtx.trim(); if (!v) return; const n = v.startsWith("@") ? v : "@" + v; void H.saveSettings({ contexts: [...new Set([...(s.contexts || []), n])] }); setNewCtx(""); }}><I n="plus" /></button>
      </div>
      <div className="lbl"><I n="later" /> Rhythm</div>
      <div className="card">
        <div className="kv"><span><I n="morning" /> Plan by</span><input type="time" className="field sm" style={{ width: 130 }} value={s.planTime} onChange={(e) => H.saveSettings({ planTime: e.target.value })} /></div>
        <div className="kv"><span><I n="shutdown" /> Shutdown</span><input type="time" className="field sm" style={{ width: 130 }} value={s.shutdownTime} onChange={(e) => H.saveSettings({ shutdownTime: e.target.value })} /></div>
        <div className="kv"><span><I n="calendar" /> Review day</span><select className="field sm" style={{ width: 130 }} value={s.reviewDay} onChange={(e) => H.saveSettings({ reviewDay: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{wd(d)}</option>)}</select></div>
        <div className="kv"><span><I n="calendar" /> Week starts</span><select className="field sm" style={{ width: 130 }} value={s.weekStart} onChange={(e) => H.saveSettings({ weekStart: Number(e.target.value) })}><option value={0}>Sun</option><option value={1}>Mon</option></select></div>
      </div>
      <div className="lbl"><I n="quiet" /> Phone-free days</div>
      <div className="chips">{[0, 1, 2, 3, 4, 5, 6].map((d) => <button key={d} className={"chip" + ((s.offDays || []).includes(d) ? " on" : "")} onClick={() => H.saveSettings({ offDays: (s.offDays || []).includes(d) ? s.offDays.filter((x) => x !== d) : [...(s.offDays || []), d] })}>{wd(d)}</button>)}</div>
      <div className="lbl"><I n="tick" /> Features</div>
      <div className="card">
        {([["estimates", "⏱ Estimates"], ["energy", "⚡ Energy"], ["handyman", "🔨 Job details"]] as const).map(([k, l]) => (
          <label key={k} className="kv"><span>{l}</span><input type="checkbox" checked={s.features[k]} onChange={(e) => H.saveSettings({ features: { ...s.features, [k]: e.target.checked } })} /></label>
        ))}
        <label className="kv"><span><I n="sleep" /> Quiet screen after shutdown</span><input type="checkbox" checked={s.quietMode} onChange={(e) => H.saveSettings({ quietMode: e.target.checked })} /></label>
        <label className="kv"><span><I n="quiet" /> Do Not Disturb reminder</span><input type="checkbox" checked={s.dndReminder} onChange={(e) => H.saveSettings({ dndReminder: e.target.checked })} /></label>
      </div>
      <div className="lbl"><I n="download" /> Export</div>
      <div className="stack">
        <button className="btn" onClick={() => saveBlob(new Blob([C.csvForTasks([...data.tasks.values()], data)], { type: "text/csv" }), `nest-tasks-${C.today()}.csv`)}><I n="download" /> Tasks as CSV</button>
        <button className="btn" onClick={() => openOverlay("templates")}><I n="copy" /> Templates</button>
        <button className="btn" onClick={() => go("trash")}><I n="trash" /> Recently deleted</button>
        {C.areaList(data, { includeArchived: true }).filter((a) => a.archived).map((a) => (
          <button key={a.id} className="btn" onClick={() => H.updateArea(a.id, { archived: false })}><I n="undo" /> Unarchive {ic(a.icon)} {a.name}</button>
        ))}
      </div>
    </>
  );
}

function FirstRun() {
  const file = useRef<HTMLInputElement>(null);
  return (
    <Empty icon="🧠" title="Head is empty" sub="Bring Clearhead over, or start fresh.">
      <div className="stack" style={{ maxWidth: 300, margin: "16px auto 0" }}>
        <button className="btn primary" onClick={() => file.current?.click()}><I n="upload" /> Import Clearhead</button>
        <button className="btn" onClick={async () => { await H.seedAreas(); toast("▣ 6 areas ready"); }}><I n="project" /> Start fresh</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const r = await H.importClearhead(H.readClearhead(JSON.parse(await f.text())));
            toast(`⬆ ${r.tasks} tasks · ${r.projects} projects · ${r.areas} areas`);
          } catch (err) { toast("✕ " + (err as Error).message); }
        }} />
      </div>
      <p className="quiet" style={{ marginTop: 12 }}>Clearhead <I n="arrow" /> Settings <I n="arrow" /> Export JSON</p>
    </Empty>
  );
}

export default function HeadScreen() {
  const { data, ready } = useHeadData();
  const s = useHeadSettings();
  const r = nav.use();
  const m = multi.use();
  useEffect(() => { clearMulti(); }, [r.view, r.id]);
  useEffect(() => () => clearMulti(), []); // leaving Head ends Select, or ＋ stays hidden on every tab
  const [bypass, setBypass] = useState<string | null>(null);
  useEffect(() => { void H.purgeOldTrash(); }, []);
  if (!ready) return null;
  const empty = data.areas.size === 0 && data.tasks.size === 0 && data.projects.size === 0;
  const noAreas = data.areas.size === 0 && data.projects.size === 0;
  const q = C.quietState(s, C.today(), C.nowHHMM());
  const qKey = q ? q.kind + ":" + q.date + ":" + C.today() : null;
  if (q && qKey !== bypass && !empty) return <QuietScreen q={q} onOpen={() => setBypass(qKey)} />;
  const props = { data, s };
  let body: React.ReactNode;
  switch (r.view) {
    case "inbox": body = <InboxView {...props} />; break;
    case "today": body = <TodayView {...props} />; break;
    case "upcoming": body = <UpcomingView {...props} />; break;
    case "anytime": body = <AnytimeView {...props} />; break;
    case "someday": body = <SomedayView {...props} />; break;
    case "waiting": body = <WaitingView {...props} />; break;
    case "logbook": body = <LogbookView {...props} />; break;
    case "projects": body = <ProjectsView {...props} />; break;
    case "project": body = <ProjectView {...props} id={r.id!} />; break;
    case "area": body = <AreaView {...props} id={r.id!} />; break;
    case "groceries": { const g = C.areaList(data).find((a) => a.listMode === "groceries"); body = g ? <GroceryList area={g} data={data} /> : null; break; }
    case "search": body = <SearchView {...props} />; break;
    case "trash": body = <TrashView {...props} />; break;
    case "settings": body = <HeadSettingsView />; break;
  }
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <NavChips />
        <button className={"iconbtn" + (m.on ? " on" : "")} aria-label="Select tasks" onClick={() => (m.on ? clearMulti() : multi.set({ on: true, ids: [] }))}><I n="select" /></button>
        <button className="iconbtn" aria-label="Head settings" onClick={() => go("settings")}><I n="settings" /></button>
      </div>
      {empty && r.view !== "settings" ? <FirstRun /> : (
        <>
          {noAreas && r.view !== "settings" && <FirstRun />}
          {(r.view === "today" || r.view === "inbox") && <Rituals />}
          {DRILL.has(r.view) && <BackLink />}
          {body}
        </>
      )}
      <BulkBar />
    </>
  );
}

/* Overlays live at app level so ＋ and the flows work from any tab. */
export function HeadOverlays() {
  const o = nav.use().overlay;
  let flow: React.ReactNode = null;
  if (o) {
    const p = o.props as Record<string, never>;
    switch (o.name) {
      case "quickadd":
        flow = (
          <div className="scrim" style={{ zIndex: 30, alignItems: "flex-start" }} onClick={closeOverlay}>
            <div className="sheet qa-sheet" onClick={(e) => e.stopPropagation()}><QuickAdd {...p} /></div>
          </div>
        );
        break;
      case "process": flow = <ProcessInbox {...p} />; break;
      case "plan": flow = <PlanMyDay />; break;
      case "review": flow = <WeeklyReview />; break;
      case "shutdown": flow = <Shutdown />; break;
      case "planday": flow = <PlanDay {...p} />; break;
      case "focus": flow = <Focus taskId={String(o.props.taskId)} />; break;
      case "whatnow": flow = <WhatNow />; break;
      case "templates": flow = <Templates {...p} />; break;
      case "ramble": flow = <Ramble {...p} />; break;
      case "dump": flow = <DumpFlow />; break;
    }
  }
  return (
    <>
      {flow}
      <DetailHost />
      <SheetHost />
    </>
  );
}
