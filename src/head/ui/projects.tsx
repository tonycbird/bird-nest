import { useState } from "react";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import type { Area, Client, Project, Task } from "../types";
import { go, openOverlay } from "../useHead";
import { Check, Empty, ic, PageHead, Ring, Seg } from "./bits";
import * as A from "./actions";
import { List, ProjectLine, type ViewProps } from "./views";
import { NotesEditor, PhotoStrip } from "./detail";
import { openSheet } from "./sheets";
import { TextSheet } from "./pickers";
import { putGroceriesOnRiver } from "../river-bridge";
import { I } from "../../ui/Icon";

/* Clearhead's projects, areas and grocery list (src/views/projects.js). */

export async function newProjectMenu(areaId?: string | null) {
  await A.openMenu("＋ Project", [
    { text: "New project", icon: "📁", run: () => A.newProject(areaId) },
    { text: "From a template", icon: "📋", run: () => openOverlay("templates", { areaId }) },
  ]);
}

function ProjectCard({ p, data }: { p: Project } & Pick<ViewProps, "data">) {
  const st = C.projectStats(data, p);
  const a = p.areaId ? data.areas.get(p.areaId) : null;
  const next = C.nextAction(data, p);
  const dd = p.deadline ? C.diffDays(C.today(), p.deadline) : null;
  return (
    <button className="pcard" onClick={() => go("project", p.id)}>
      <div className="row"><Ring pct={st.pct} size={28} /><b className="grow">{p.name}</b></div>
      {a && <div className="quiet">{ic(a.icon)} {a.name}</div>}
      <div className="pc-next">{next ? <><span className="quiet">Next <I n="chevR" /></span> {next.title}</> : <span className="stalled"><I n="pause" /> No next step</span>}</div>
      {p.deadline && <span className={"pill" + (dd! <= 7 ? " warn" : "")}><I n="flag" /> {dd! < 0 ? "Late" : C.relLabel(p.deadline)}</span>}
    </button>
  );
}

export function ProjectsView({ data }: ViewProps) {
  const [showOther, setShowOther] = useState(false);
  const active = C.activeProjects(data);
  const other = [...data.projects.values()].filter((p) => p.status === "hold" || p.status === "done").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const areas = C.areaList(data);
  return (
    <>
      <PageHead kicker="📁 Projects" title={`${active.length} active`} right={<>
        <button className="iconbtn" aria-label="New area" onClick={() => A.newArea()}><I n="project" /></button>
        <button className="iconbtn" aria-label="New project" onClick={() => newProjectMenu()}><I n="plus" /></button>
      </>} />
      {!active.length && (
        <Empty icon="📁" title="No active projects" sub="A project is any outcome with more than one step.">
          <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="btn primary sm" onClick={() => A.newProject()}><I n="plus" /> Project</button>
            <button className="btn sm" onClick={() => openOverlay("templates")}><I n="copy" /> Template</button>
          </div>
        </Empty>
      )}
      <div className="pgrid">{active.map((p) => <ProjectCard key={p.id} p={p} data={data} />)}</div>
      <div className="lbl">Areas</div>
      <div className="card" style={{ padding: "4px 12px" }}>
        {areas.map((a) => (
          <button key={a.id} className="proj-row" onClick={() => go("area", a.id)}>
            <span>{ic(a.icon)}</span><span className="grow">{a.name}</span>
            <span className="quiet">{[...data.tasks.values()].filter((t) => C.isOpen(t) && C.areaOfTask(t, data)?.id === a.id && !t.grocery).length || ""}</span><span className="quiet"><I n="chevR" /></span>
          </button>
        ))}
        <button className="proj-row" onClick={() => A.newArea()}><span><I n="plus" /></span><span className="grow quiet">New area</span></button>
      </div>
      {other.length > 0 && (
        <>
          <button className="linkbtn" onClick={() => setShowOther(!showOther)}>{showOther ? "▾" : "▸"} On hold · done ({other.length})</button>
          {showOther && other.map((p) => <ProjectLine key={p.id} p={p} data={data} />)}
        </>
      )}
    </>
  );
}

function ClientCard({ c }: { c: Client }) {
  const digits = String(c.phone || "").replace(/[^\d+]/g, "");
  return (
    <div className="card client">
      {c.name && <div><b><I n="person" /> {c.name}</b>{c.price ? <span className="quiet"> · est. ${c.price}</span> : null}</div>}
      {c.address && <div><I n="place" /> <a href={"https://maps.apple.com/?q=" + encodeURIComponent(c.address)} target="_blank" rel="noopener">{c.address}</a></div>}
      {c.phone && <div><I n="call" /> {c.phone} <a href={"tel:" + digits}>Call</a> <a href={"sms:" + digits}>Text</a></div>}
    </div>
  );
}

async function completeProjectFlow(p: Project, openCount: number) {
  if (openCount && !(await A.confirm(`Complete “${p.name}”?`, `${openCount} open task${openCount === 1 ? "" : "s"} will be marked done too.`, "✓ Complete"))) return;
  toast("✓ Project done. Nice work.", await H.completeProject(p.id));
}

export function ProjectView({ data, id }: ViewProps & { id: string }) {
  const p = data.projects.get(id);
  const [showDone, setShowDone] = useState(false);
  const [nextDraft, setNextDraft] = useState("");
  if (!p) return <Empty icon="📁" title="Project not found"><button className="btn sm" onClick={() => go("projects")}>All projects</button></Empty>;
  const a = p.areaId ? data.areas.get(p.areaId) : null;
  const all = C.projectTasks(data, id);
  const open = C.sortProjectTasks(p, all.filter(C.isOpen));
  const done = all.filter(C.isDone).sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
  const st = C.projectStats(data, p);
  const next = C.nextAction(data, p);
  const secs = [{ id: null as string | null, name: "" }, ...(p.sections || [])];
  const known = new Set((p.sections || []).map((x) => x.id));
  const inSec = (sid: string | null) => open.filter((t) => (sid ? t.sectionId === sid : !t.sectionId || !known.has(t.sectionId)) && (!next || t.id !== next.id));
  const menu = () => A.openMenu(p.name, [
    { text: "Ramble about this", icon: "🗣", run: () => openOverlay("ramble", { focus: { kind: "project", id } }) },
    { text: "Edit project", icon: "✏", run: () => A.editProject(id) },
    { text: "Add section", icon: "≡", run: async () => { const n = await openSheet<string>(TextSheet, { title: "＋ Section", placeholder: "Demo · Materials · Install" }); if (n) await H.addSection(id, n); } },
    { text: "Save as template", icon: "📋", run: async () => { const n = await openSheet<string>(TextSheet, { title: "Template name", value: p.name }); if (n) { await H.saveProjectAsTemplate(id, n); toast("📋 Saved"); } } },
    "-",
    p.status !== "done" ? { text: "Complete project", icon: "✓", run: () => completeProjectFlow(p, open.length) } : { text: "Reopen", icon: "↺", run: () => H.updateProject(id, { status: "active", completedAt: null }) },
    ...(p.status === "active" ? [{ text: "Put on hold", icon: "⏸", run: () => H.updateProject(id, { status: "hold" }) }] : p.status !== "done" ? [{ text: "Make active", icon: "▶", run: () => H.updateProject(id, { status: "active" }) }] : []),
    ...(p.status !== "someday" && p.status !== "done" ? [{ text: "Move to Someday", icon: "💤", run: () => H.updateProject(id, { status: "someday" }) }] : []),
    { text: "Archive", icon: "📦", run: async () => { await H.updateProject(id, { status: "archived" }); go("projects"); toast("📦 Archived"); } },
    { text: "Delete project", icon: "🗑", danger: true, run: async () => {
      if (await A.confirm(`Delete “${p.name}”?`, `It and its ${all.length} tasks go to Recently deleted for 30 days.`, "🗑 Delete", true)) {
        const u = await H.deleteProject(id); go("projects"); toast("🗑 Deleted", u);
      }
    } },
  ]);
  const addNext = async () => { if (!nextDraft.trim()) return; await H.createTask({ title: nextDraft.trim(), projectId: id }); setNextDraft(""); };
  const secMenu = (sec: { id: string; name: string }, ts: Task[]) => A.openMenu(sec.name, [
    { text: "Rename", icon: "✏", run: async () => { const n = await openSheet<string>(TextSheet, { title: "Rename", value: sec.name }); if (n) await H.updateSections(id, p.sections.map((x) => (x.id === sec.id ? { ...x, name: n } : x))); } },
    { text: "Move up", icon: "▲", run: async () => { const i = p.sections.findIndex((x) => x.id === sec.id); if (i > 0) { const s2 = [...p.sections]; [s2[i - 1], s2[i]] = [s2[i], s2[i - 1]]; await H.updateSections(id, s2); } } },
    { text: "Delete section", icon: "🗑", danger: true, run: async () => { for (const t of ts) await H.updateTask(t.id, { sectionId: null }); await H.updateSections(id, p.sections.filter((x) => x.id !== sec.id)); } },
  ]);
  return (
    <>
      <PageHead kicker={(a ? ic(a.icon) + " " + a.name : "📁 Project") + (p.status !== "active" ? " · " + (C.PROJECT_STATUSES.find((x) => x.id === p.status)?.name ?? "") : "")}
        title={<span className="row" style={{ gap: 10 }}><Ring pct={st.pct} size={28} />{p.name}</span>}
        sub={<>{p.start && <span><I n="play" /> {C.relLabel(p.start)} </span>}{p.deadline && <span style={C.diffDays(C.today(), p.deadline) <= 7 ? { color: "var(--warn)" } : undefined}><I n="flag" /> {C.longLabel(p.deadline)}</span>}</>}
        right={<>
          <button className="iconbtn" aria-label="Ramble" onClick={() => openOverlay("ramble", { focus: { kind: "project", id } })}><I n="talk" /></button>
          <button className="iconbtn" aria-label="Project options" onClick={menu}><I n="more" /></button>
        </>} />
      <button className="outcome" onClick={() => A.editProject(id)}>
        <div className="lbl" style={{ margin: 0 }}>Done looks like</div>
        <div className={p.outcome ? "" : "quiet"}>{p.outcome || "Describe the finished result."}</div>
        {p.description && <div className="quiet detail" style={{ marginTop: 4 }}>{p.description}</div>}
      </button>
      {p.client && (p.client.name || p.client.phone || p.client.address) && <ClientCard c={p.client} />}
      {p.status === "active" && (next
        ? <div className="nextup"><div className="lbl" style={{ margin: "0 0 4px" }}><I n="play" /> Next</div><List tasks={[next]} data={data} showHome={false} /></div>
        : <div className="nextup"><div className="stalled"><I n="pause" /> No next step</div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="field sm" placeholder="The very next step?" value={nextDraft} onChange={(e) => setNextDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addNext()} />
            <button className="btn sm primary" disabled={!nextDraft.trim()} onClick={addNext}><I n="plus" /></button>
          </div></div>)}
      {secs.map((sec) => {
        const ts = inSec(sec.id);
        if (!sec.id && !ts.length && (p.sections || []).length) return null;
        return (
          <section key={sec.id || "none"} className="hsec">
            {sec.id && <div className="sec-head"><span className="grow">{sec.name}</span><button className="iconbtn sm" aria-label={"Options for " + sec.name} onClick={() => secMenu(sec as { id: string; name: string }, ts)}><I n="more" /></button></div>}
            <List tasks={ts} data={data} showHome={false} />
            <button className="linkbtn" onClick={() => openOverlay("quickadd", { defaults: { projectId: id, sectionId: sec.id } })}><I n="plus" /> Task</button>
          </section>
        );
      })}
      {done.length > 0 && (
        <>
          <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? "▾ Hide done" : `▸ ${done.length} done`}</button>
          {showDone && <List tasks={done} data={data} showHome={false} showWhen={false} />}
        </>
      )}
      <section className="hsec"><div className="sec-head"><span><I n="edit" /></span><span className="grow">Notes</span></div>
        <NotesEditor value={p.notes} placeholder="✎ Plans, measurements, links" onSave={(v) => void H.updateProject(id, { notes: v })} /></section>
      <section className="hsec"><div className="sec-head"><span><I n="camera" /></span><span className="grow">Photos</span></div>
        <PhotoStrip owner={{ kind: "project", id }} photos={p.photos || []} /></section>
    </>
  );
}

export function AreaView({ data, id }: ViewProps & { id: string }) {
  const a = data.areas.get(id);
  if (!a) return <Empty icon="▣" title="Area not found"><button className="btn sm" onClick={() => go("today")}>Today</button></Empty>;
  const projects = [...data.projects.values()].filter((p) => p.areaId === id);
  const activeP = projects.filter((p) => p.status === "active").sort((x, y) => (x.order || 0) - (y.order || 0));
  const otherP = projects.filter((p) => p.status === "someday" || p.status === "hold");
  const loose = [...data.tasks.values()].filter((t) => t.areaId === id && !t.projectId && C.isOpen(t) && !t.grocery && !t.list).sort((x, y) => (x.order || 0) - (y.order || 0));
  const menu = () => A.openMenu(a.name, [
    { text: "Edit area", icon: "✏", run: () => A.editArea(id) },
    { text: "New project", icon: "📁", run: () => A.newProject(id) },
    { text: "From template", icon: "📋", run: () => openOverlay("templates", { areaId: id }) },
    "-",
    { text: "Archive area", icon: "📦", run: async () => { await H.updateArea(id, { archived: true }); go("projects"); toast("📦 Archived"); } },
    { text: "Delete area", icon: "🗑", danger: true, run: async () => {
      if (await A.confirm(`Delete “${a.name}”?`, "The area, its projects and tasks go to Recently deleted for 30 days.", "🗑 Delete", true)) {
        const u = await H.deleteArea(id); go("projects"); toast("🗑 Deleted", u);
      }
    } },
  ]);
  return (
    <>
      <PageHead kicker="▣ Area" title={<>{ic(a.icon)} {a.name}</>} right={<>
        <button className="iconbtn" aria-label="New project" onClick={() => newProjectMenu(id)}><I n="plus" /></button>
        <button className="iconbtn" aria-label="Area options" onClick={menu}><I n="more" /></button>
      </>} />
      {a.listMode === "groceries" && <GroceryList area={a} data={data} />}
      {activeP.length > 0 && <section className="hsec"><div className="sec-head"><span className="grow">Projects</span></div>{activeP.map((p) => <ProjectLine key={p.id} p={p} data={data} />)}</section>}
      <section className="hsec">
        {(activeP.length > 0 || a.listMode === "groceries") && <div className="sec-head"><span className="grow">{a.listMode === "groceries" ? "Errands" : "Tasks"}</span></div>}
        <List tasks={loose} data={data} showHome={false} empty={!activeP.length && a.listMode !== "groceries" && <Empty icon={ic(a.icon)} title="Nothing here yet" />} />
        <button className="linkbtn" onClick={() => openOverlay("quickadd", { defaults: { areaId: id } })}><I n="plus" /> {a.listMode === "groceries" ? "Errand" : "Task"}</button>
      </section>
      {otherP.length > 0 && <section className="hsec"><div className="sec-head"><span className="grow">Someday · on hold</span></div>{otherP.map((p) => <ProjectLine key={p.id} p={p} data={data} />)}</section>}
    </>
  );
}

export function GroceryList({ area, data }: { area: Area } & Pick<ViewProps, "data">) {
  const [text, setText] = useState("");
  const [by, setBy] = useState<"aisle" | "store">("aisle");
  const cutoff = Date.now() - 12 * 36e5;
  const items = [...data.tasks.values()].filter((t) => t.areaId === area.id && t.grocery && !(t.grocery as { cleared?: boolean }).cleared && (C.isOpen(t) || (t.doneAt || 0) > cutoff));
  const open = items.filter(C.isOpen);
  const checked = items.filter((t) => !C.isOpen(t)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const add = async () => {
    const v = text.trim();
    if (!v) return;
    for (const title of v.split(/\s*,\s*/).filter(Boolean)) await H.addGrocery(title, area.id);
    setText("");
  };
  const groups: { key: string; name: string; ts: Task[] }[] = [];
  if (by === "aisle") {
    for (const c of C.GROCERY_CATS) { const ts = open.filter((t) => (t.grocery!.cat || "other") === c.id); if (ts.length) groups.push({ key: c.id, name: c.name, ts }); }
  } else {
    const stores = [...new Set(open.map((t) => t.grocery!.store || ""))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
    for (const s of stores) groups.push({ key: s || "any", name: s || "Any store", ts: open.filter((t) => (t.grocery!.store || "") === s) });
  }
  const row = (t: Task) => {
    const done = !C.isOpen(t);
    return (
      <div key={t.id} className={"task groc" + (done ? " done" : "")}>
        <Check on={done} onToggle={() => (done ? H.uncompleteTask(t.id) : H.completeTask(t.id))} />
        <div className="t-body" onClick={() => A.openMenu(t.title, [
          { text: "Store…", icon: "🏪", run: async () => { const s = await openSheet<string>(TextSheet, { title: "Store", value: t.grocery!.store || "", placeholder: "Winco · Home Depot" }); if (s !== undefined) await H.updateTask(t.id, { grocery: { ...t.grocery!, store: s || null } }); } },
          { text: "Aisle…", icon: "🧺", run: async () => {
            const r = await A.openMenu("Aisle", C.GROCERY_CATS.map((c) => ({ text: c.name, run: () => H.updateTask(t.id, { grocery: { ...t.grocery!, cat: c.id } }) })));
            void r;
          } },
          { text: "Delete", icon: "🗑", danger: true, run: () => A.remove(t.id) },
        ])}>
          <div className="t-title">{t.title}</div>
          {by === "aisle" && t.grocery!.store && <div className="t-meta"><span><I n="box" /> {t.grocery!.store}</span></div>}
        </div>
      </div>
    );
  };
  return (
    <div>
      <div className="row">
        <input className="field" placeholder="Milk, 2x4s, diapers" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} aria-label="Add to list" />
        <button className="btn primary" disabled={!text.trim()} onClick={add}><I n="plus" /></button>
      </div>
      <div className="row" style={{ justifyContent: "space-between", margin: "10px 0" }}>
        <Seg label="Group by" value={by} onChange={setBy} options={[{ id: "aisle", name: "Aisle" }, { id: "store", name: "Store" }]} />
        <div className="row" style={{ gap: 6 }}>
          {open.length > 0 && <button className="btn sm" onClick={async () => { const u = await putGroceriesOnRiver(area.id); if (u) toast("🌊 Shopping block on the River", u); }}><I n="river" /> River</button>}
          {checked.length > 0 && <button className="btn sm" onClick={async () => {
            const ids = checked.map((t) => t.id);
            for (const tid of ids) { const t = data.tasks.get(tid)!; await H.updateTask(tid, { grocery: { ...t.grocery!, cleared: true } as never }); }
            toast("🧹 Cleared", async () => { for (const tid of ids) { const t = data.tasks.get(tid)!; await H.updateTask(tid, { grocery: { ...t.grocery!, cleared: false } as never }); } });
          }}><I n="home" /></button>}
        </div>
      </div>
      {!open.length && !checked.length && <Empty icon="🛒" title="List is empty" />}
      {groups.map((g) => <section key={g.key} className="hsec"><div className="sec-head"><span className="grow">{g.name}</span><span className="quiet">{g.ts.length}</span></div>{g.ts.map(row)}</section>)}
      {checked.length > 0 && <section className="hsec"><div className="sec-head"><span className="grow quiet"><I n="groceries" /> In the cart</span></div>{checked.map(row)}</section>}
    </div>
  );
}
