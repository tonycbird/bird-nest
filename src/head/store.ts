/* Head store — Clearhead's store.js ported onto Dexie.
   Same functions, same rules (history, reschedule counting, repeat rollover, trash groups, templates),
   but every write lands in the phone's IndexedDB instead of the artifact database.
   Each action returns an undo function, like Clearhead did. */
import { db } from "../lib/db";
import * as C from "./core/clearhead.js";
import type { Area, ChecklistItem, HeadData, HeadSettings, Photo, Project, Task, Template, TrashEntry } from "./types";

export type Undo = () => Promise<void>;
const noop: Undo = async () => {};

type Name = "areas" | "projects" | "tasks" | "templates";
const table = (name: Name) => db.table(name);

function clean<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
async function put<T extends { id: string }>(name: Name, obj: T): Promise<void> {
  await table(name).put({ ...clean(obj), _u: Date.now() });
}
async function patch(name: Name, id: string, changes: Record<string, unknown>): Promise<void> {
  const cur = await table(name).get(id);
  if (!cur) return;
  await table(name).put({ ...cur, ...clean(changes), _u: Date.now() });
}
async function remove(name: Name, id: string): Promise<void> { await table(name).delete(id); }
function pick<T extends object>(o: T, keys: string[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of keys) r[k] = (o as Record<string, unknown>)[k] === undefined ? null : (o as Record<string, unknown>)[k];
  return r;
}

/* ---------- reading ---------- */

export async function loadData(): Promise<HeadData> {
  const [areas, projects, tasks] = await Promise.all([db.areas.toArray(), db.projects.toArray(), db.tasks.toArray()]);
  return {
    areas: new Map(areas.map((a) => [a.id, a])),
    projects: new Map(projects.map((p) => [p.id, p])),
    tasks: new Map(tasks.map((t) => [t.id, t])),
  };
}

export const HEAD_DEFAULTS: HeadSettings = {
  weekStart: C.DEFAULT_SETTINGS.weekStart,
  reviewDay: C.DEFAULT_SETTINGS.reviewDay,
  reviewTime: C.DEFAULT_SETTINGS.reviewTime,
  planTime: C.DEFAULT_SETTINGS.planTime,
  features: { ...C.DEFAULT_SETTINGS.features },
  contexts: [...C.DEFAULT_CONTEXTS],
  lastPlan: null, lastReview: null, lastShutdown: null,
  shutdownTime: C.DEFAULT_SETTINGS.shutdownTime,
  dndReminder: C.DEFAULT_SETTINGS.dndReminder,
  quietMode: C.DEFAULT_SETTINGS.quietMode,
  offDays: [...C.DEFAULT_SETTINGS.offDays],
};

export async function loadSettings(): Promise<HeadSettings> {
  const row = await db.settings.get("head");
  return { ...HEAD_DEFAULTS, ...((row?.value as Partial<HeadSettings>) ?? {}) };
}

export async function saveSettings(changes: Partial<HeadSettings>): Promise<void> {
  const cur = await loadSettings();
  const next = { ...cur, ...changes, features: { ...cur.features, ...(changes.features ?? {}) } };
  await db.settings.put({ key: "head", value: next, updated_at: new Date().toISOString() });
}

/* ---------- areas ---------- */

export async function seedAreas(): Promise<void> {
  if ((await db.areas.count()) > 0) return;
  const now = Date.now();
  for (const [i, a] of C.SEED_AREAS.entries()) {
    await put("areas", { id: C.uid("a"), ...a, listMode: a.listMode ?? null, order: i, archived: false, createdAt: now + i } as Area);
  }
  await saveSettings({ seeded: true });
}

export async function createArea(f: { name: string; color?: string; icon?: string; listMode?: "groceries" | null }): Promise<string> {
  const id = C.uid("a");
  const all = await db.areas.toArray();
  const order = Math.max(0, ...all.map((a) => a.order || 0)) + 1;
  await put("areas", { id, name: f.name, color: f.color || "blue", icon: f.icon || "circle", listMode: f.listMode ?? null, order, archived: false, createdAt: Date.now() } as Area);
  return id;
}

export async function updateArea(id: string, changes: Partial<Area>): Promise<Undo> {
  const a = await db.areas.get(id);
  if (!a) return noop;
  const before = pick(a, Object.keys(changes));
  await patch("areas", id, changes);
  return () => patch("areas", id, before);
}

export async function reorderAreas(ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) {
    const a = await db.areas.get(id);
    if (a && a.order !== i) await patch("areas", id, { order: i });
  }
}

export async function deleteArea(id: string): Promise<Undo> {
  const a = await db.areas.get(id);
  if (!a) return noop;
  const group = C.uid("g");
  const projects = (await db.projects.toArray()).filter((p) => p.areaId === id);
  const pids = new Set(projects.map((p) => p.id));
  const tasks = (await db.tasks.toArray()).filter((t) => t.areaId === id || (t.projectId && pids.has(t.projectId)));
  for (const t of tasks) await trashDoc(t, "tasks", group);
  for (const p of projects) await trashDoc(p, "projects", group);
  await trashDoc(a, "areas", group, true);
  return () => restoreGroup(group);
}

/* ---------- projects ---------- */

export async function createProject(f: Partial<Project>): Promise<string> {
  const id = f.id || C.uid("p");
  const all = await db.projects.toArray();
  const order = Math.max(0, ...all.map((p) => p.order || 0)) + 1;
  await put("projects", {
    id,
    name: f.name || "New project",
    areaId: f.areaId || null,
    color: f.color || null,
    description: f.description || "",
    outcome: f.outcome || "",
    start: f.start || null,
    deadline: f.deadline || null,
    status: f.status || "active",
    sections: f.sections || [],
    notes: f.notes || "",
    client: f.client || null,
    photos: [],
    order,
    createdAt: Date.now(),
    completedAt: null,
  } as Project);
  return id;
}

export async function updateProject(id: string, changes: Partial<Project>): Promise<Undo> {
  const p = await db.projects.get(id);
  if (!p) return noop;
  const ch = { ...changes };
  const before = pick(p, Object.keys(ch));
  if ("areaId" in ch && ch.areaId !== p.areaId) {
    for (const t of (await db.tasks.toArray()).filter((t) => t.projectId === id)) await patch("tasks", t.id, { areaId: ch.areaId });
  }
  if (ch.status === "done" && p.status !== "done") ch.completedAt = Date.now();
  await patch("projects", id, ch);
  return () => patch("projects", id, before);
}

export async function deleteProject(id: string): Promise<Undo> {
  const p = await db.projects.get(id);
  if (!p) return noop;
  const group = C.uid("g");
  for (const t of (await db.tasks.toArray()).filter((t) => t.projectId === id)) await trashDoc(t, "tasks", group);
  await trashDoc(p, "projects", group, true);
  return () => restoreGroup(group);
}

export async function completeProject(id: string, { completeTasks = true } = {}): Promise<Undo> {
  const p = await db.projects.get(id);
  if (!p) return noop;
  const open = (await db.tasks.toArray()).filter((t) => t.projectId === id && C.isOpen(t));
  const now = Date.now();
  if (completeTasks) for (const t of open) await patch("tasks", t.id, { status: "done", doneAt: now });
  await updateProject(id, { status: "done" });
  return async () => {
    for (const t of open) await patch("tasks", t.id, { status: "open", doneAt: null });
    await patch("projects", id, { status: p.status, completedAt: null });
  };
}

export async function addSection(pid: string, name: string): Promise<void> {
  const p = await db.projects.get(pid);
  if (p) await patch("projects", pid, { sections: [...(p.sections || []), { id: C.uid("sec"), name }] });
}

export async function updateSections(pid: string, sections: Project["sections"]): Promise<void> {
  if (await db.projects.get(pid)) await patch("projects", pid, { sections });
}

/* ---------- tasks ---------- */

export async function createTask(fields: Partial<Task>): Promise<Task> {
  const f = { ...fields };
  if (f.projectId) {
    const p = await db.projects.get(f.projectId);
    if (p) f.areaId = p.areaId || f.areaId || null;
  }
  const t = C.newTask(f);
  await put("tasks", t);
  return t;
}

export async function addGrocery(title: string, areaId?: string | null): Promise<Task | null> {
  const area = areaId ? await db.areas.get(areaId) : (await db.areas.toArray()).find((a) => a.listMode === "groceries" && !a.archived);
  if (!area) return null;
  return createTask({ title, areaId: area.id, grocery: { cat: C.guessGroceryCat(title), store: null } });
}

function withHistory(t: Task, what: string) {
  return [...(t.history || []), { at: Date.now(), what }].slice(-25);
}

export async function updateTask(id: string, changes: Partial<Task>, { history }: { history?: string } = {}): Promise<Undo> {
  const t = await db.tasks.get(id);
  if (!t) return noop;
  const ch: Partial<Task> = { ...changes, updatedAt: Date.now() };
  if (ch.projectId) {
    const p = await db.projects.get(ch.projectId);
    if (p) ch.areaId = p.areaId || null;
  }
  const td = C.today();
  if ("when" in ch && t.when && ch.when && ch.when > t.when && t.when <= td) ch.reschedules = (t.reschedules || 0) + 1;
  if ("when" in ch && ch.when) ch.someday = false;
  const notes: string[] = [];
  if ("when" in ch && ch.when !== t.when) notes.push(ch.when ? "scheduled " + ch.when : "unscheduled");
  if ("due" in ch && ch.due !== t.due) notes.push(ch.due ? "due " + ch.due : "removed due date");
  if (("areaId" in ch && ch.areaId !== t.areaId) || ("projectId" in ch && ch.projectId !== t.projectId)) notes.push("moved");
  if (history) notes.push(history);
  if (notes.length) ch.history = withHistory(t, [...new Set(notes)].join(", "));
  const before = pick(t, Object.keys(ch));
  await patch("tasks", id, ch as Record<string, unknown>);
  return () => patch("tasks", id, { ...before, updatedAt: Date.now() });
}

export async function completeTask(id: string): Promise<Undo> {
  const t = await db.tasks.get(id);
  if (!t || !C.isOpen(t)) return noop;
  const now = Date.now();
  await patch("tasks", id, { status: "done", doneAt: now, updatedAt: now, history: withHistory(t, "completed") });
  let nextId: string | null = null;
  if (t.repeat) {
    const { when, due } = C.nextInstanceDates(t, C.today());
    const rule = t.repeat.freq === "after" ? t.repeat : C.normalizeRule(t.repeat);
    const { id: _i, ...rest } = t;
    void _i;
    const next = C.newTask({
      ...rest,
      when,
      due,
      repeat: rule,
      checklist: (t.checklist || []).map((c) => ({ ...c, done: false })),
      handy: t.handy ? { ...t.handy, materials: (t.handy.materials || []).map((m) => ({ ...m, done: false })) } : null,
      photos: [],
      order: t.order,
      todayOrder: null,
    });
    next.history = [{ at: now, what: "repeated from previous" }];
    nextId = next.id;
    await put("tasks", next);
    await patch("tasks", id, { repeatNextId: nextId });
  }
  return async () => {
    await patch("tasks", id, { status: "open", doneAt: null, updatedAt: Date.now() });
    if (nextId) await remove("tasks", nextId);
  };
}

export async function uncompleteTask(id: string): Promise<Undo> {
  const t = await db.tasks.get(id);
  if (!t) return noop;
  await patch("tasks", id, { status: "open", doneAt: null, updatedAt: Date.now(), history: withHistory(t, "reopened"), repeatNextId: null });
  // Reopening a repeating task takes back the next copy it made (if that copy is still untouched and open),
  // so finishing it again doesn't leave two.
  const copy = t.repeatNextId ? await db.tasks.get(t.repeatNextId) : undefined;
  if (copy && C.isOpen(copy)) await remove("tasks", copy.id);
  return async () => {
    await patch("tasks", id, { status: "done", doneAt: t.doneAt, repeatNextId: t.repeatNextId ?? null });
    if (copy && C.isOpen(copy)) await put("tasks", copy);
  };
}

export async function deleteTask(id: string): Promise<Undo> {
  const t = await db.tasks.get(id);
  if (!t) return noop;
  const group = C.uid("g");
  await trashDoc(t, "tasks", group, true);
  return () => restoreGroup(group);
}

export async function duplicateTask(id: string): Promise<Task | null> {
  const t = await db.tasks.get(id);
  if (!t) return null;
  const { id: _i, history: _h, createdAt: _c, doneAt: _d, status: _s, ...rest } = t;
  void _i; void _h; void _c; void _d; void _s;
  return createTask({ ...rest, title: t.title + " (copy)", checklist: (t.checklist || []).map((c) => ({ ...c, id: C.uid("c"), done: false })), photos: [] });
}

/** Clearhead's "Turn into a project": the task becomes the project's first small step. */
export async function taskToProject(id: string): Promise<string | null> {
  const t = await db.tasks.get(id);
  if (!t) return null;
  const data = await loadData();
  const { area } = C.homeOf(t, data);
  const pid = await createProject({ name: t.title, areaId: area ? area.id : t.areaId, outcome: "", notes: t.notes || "" });
  await updateTask(t.id, { projectId: pid, title: "Figure out the first small step", reschedules: 0, when: null });
  return pid;
}

/* ---------- trash ---------- */

async function trashDoc(item: Area | Project | Task, kind: TrashEntry["kind"], group: string, primary = false) {
  await db.trash.put({ id: item.id, kind, item: clean(item), group, primary, deletedAt: Date.now() });
  await remove(kind, item.id);
}

export async function loadTrash(): Promise<TrashEntry[]> {
  return (await db.trash.toArray()).sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreGroup(group: string): Promise<void> {
  const items = await db.trash.where("group").equals(group).toArray();
  const rank = { areas: 0, projects: 1, tasks: 2 } as const;
  items.sort((a, b) => rank[a.kind] - rank[b.kind]);
  for (const x of items) {
    let item = x.item as unknown as Record<string, unknown> & { id: string };
    // A task or project whose list is gone (deleted separately) would come back invisible: send it to the Inbox instead.
    if (x.kind === "tasks" || x.kind === "projects") {
      const fix: Record<string, unknown> = {};
      if (item.projectId && !(await db.projects.get(item.projectId as string))) { fix.projectId = null; fix.sectionId = null; }
      if (item.areaId && !(await db.areas.get(item.areaId as string))) fix.areaId = null;
      if (item.sectionId && !fix.projectId && item.projectId) {
        const p = await db.projects.get(item.projectId as string);
        if (p && !(p.sections || []).some((sct) => sct.id === item.sectionId)) fix.sectionId = null;
      }
      item = { ...item, ...fix };
    }
    await put(x.kind, item);
    await db.trash.delete(x.id);
  }
}

export async function purgeTrashItem(entry: TrashEntry): Promise<void> {
  if (entry.kind === "tasks") for (const pid of (entry.item as Task).photos || []) await db.photos.delete(pid);
  await db.trash.delete(entry.id);
}

/** Clearhead purged Recently Deleted after 30 days. Same here, run once at start-up. */
export async function purgeOldTrash(): Promise<void> {
  const cutoff = Date.now() - 30 * 864e5;
  for (const e of await db.trash.where("deletedAt").below(cutoff).toArray()) await purgeTrashItem(e);
}

/* ---------- order ---------- */

export async function reorder(ids: string[], field: "order" | "todayOrder" = "order"): Promise<void> {
  const base = Date.now() - ids.length * 1e3;
  for (const [i, id] of ids.entries()) {
    const t = await db.tasks.get(id);
    const v = base + i * 1e3;
    if (t && t[field] !== v) await patch("tasks", id, { [field]: v });
  }
}

/* ---------- photos ---------- */

const MAX_PHOTO_CHARS = 235e3;
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as a photo.")); };
    img.src = url;
  });
}
function draw(img: HTMLImageElement, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return { data: c.toDataURL("image/jpeg", quality), w, h };
}
async function compressPhoto(file: File) {
  const img = await loadImage(file);
  const tries: [number, number][] = [[1600, 0.72], [1400, 0.68], [1280, 0.62], [1100, 0.58], [960, 0.55], [800, 0.5], [640, 0.5]];
  let out = draw(img, tries[0][0], tries[0][1]);
  for (const [edge, q] of tries) {
    out = draw(img, edge, q);
    if (out.data.length <= MAX_PHOTO_CHARS - 12e3) break;
  }
  const thumb = draw(img, 220, 0.6).data;
  return { data: out.data, thumb, w: out.w, h: out.h };
}

export async function addPhoto(owner: { kind: "task" | "project"; id: string }, file: File): Promise<string | undefined> {
  const x = owner.kind === "project" ? await db.projects.get(owner.id) : await db.tasks.get(owner.id);
  if (!x) return;
  const p = await compressPhoto(file);
  const id = C.uid("ph");
  await db.photos.put({ id, ...p, owner: owner.id, at: Date.now() } as Photo);
  const photos = [...(x.photos || []), id];
  if (owner.kind === "project") await patch("projects", x.id, { photos });
  else await updateTask(x.id, { photos });
  return id;
}

export async function getPhoto(id: string): Promise<Photo | undefined> { return db.photos.get(id); }

export async function removePhoto(owner: { kind: "task" | "project"; id: string }, photoId: string): Promise<Undo> {
  const x = owner.kind === "project" ? await db.projects.get(owner.id) : await db.tasks.get(owner.id);
  if (!x) return noop;
  const photos = (x.photos || []).filter((p) => p !== photoId);
  const set = (list: string[]) => (owner.kind === "project" ? patch("projects", x.id, { photos: list }) : updateTask(x.id, { photos: list }).then(() => {}));
  await set(photos);
  return () => set([...photos, photoId]);
}

/* ---------- templates ---------- */

export async function allTemplates(): Promise<Template[]> {
  const mine = (await db.templates.toArray()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return [...C.BUILTIN_TEMPLATES, ...mine];
}

export async function saveProjectAsTemplate(pid: string, name?: string): Promise<string | undefined> {
  const data = await loadData();
  const p = data.projects.get(pid);
  if (!p) return;
  const tasks = C.sortProjectTasks(p, [...data.tasks.values()].filter((t) => t.projectId === pid));
  const secs = [{ id: null as string | null, name: "" }, ...(p.sections || [])];
  const tpl: Template = {
    id: C.uid("tpl"),
    name: name || p.name,
    icon: "layout-list",
    description: p.description || "",
    outcome: p.outcome || "",
    areaHint: (p.areaId && data.areas.get(p.areaId)?.name) || "",
    client: !!p.client,
    createdAt: Date.now(),
    sections: secs.map((s) => ({
      name: s.name,
      tasks: tasks
        .filter((t) => (t.sectionId || null) === s.id || (!s.id && t.sectionId && !(p.sections || []).some((x) => x.id === t.sectionId)))
        .map((t) => ({
          title: t.title,
          notes: t.notes || "",
          contexts: t.contexts || [],
          est: t.est || null,
          energy: t.energy || null,
          checklist: (t.checklist || []).map((c) => c.text),
          waiting: t.waiting ? { who: t.waiting.who } : null,
          repeat: t.repeat ? { ...t.repeat, anchor: undefined } : null,
        })),
    })).filter((s) => s.tasks.length || s.name),
  };
  await put("templates", tpl);
  return tpl.id;
}

export async function deleteTemplate(id: string): Promise<void> { await remove("templates", id); }

export async function createFromTemplate(tpl: Template, opts: { name?: string; areaId?: string | null; client?: Project["client"]; start?: string | null; deadline?: string | null }): Promise<string> {
  const sections = tpl.sections.filter((s) => s.name).map((s) => ({ id: C.uid("sec"), name: s.name }));
  const pid = await createProject({
    name: opts.name || tpl.name, areaId: opts.areaId, description: tpl.description, outcome: tpl.outcome, sections,
    client: opts.client || null, deadline: opts.deadline || null, start: opts.start || null,
  });
  let order = Date.now();
  let si = 0;
  const t0 = C.today();
  for (const s of tpl.sections) {
    const sec = s.name ? sections[si++] : null;
    for (const tt of s.tasks) {
      const f: Partial<Task> = {
        title: tt.title,
        notes: tt.notes || "",
        projectId: pid,
        areaId: opts.areaId ?? null,
        sectionId: sec ? sec.id : null,
        contexts: tt.contexts || [],
        est: tt.est || null,
        energy: tt.energy || null,
        order: order++,
        checklist: (tt.checklist || []).map((text) => ({ id: C.uid("c"), text, done: false }) as ChecklistItem),
      };
      if (tt.waiting) f.notes = (f.notes ? f.notes + "\n" : "") + `Mark this as Waiting For (${tt.waiting.who}) once it has been sent.`;
      if (tt.repeat) {
        f.repeat = { ...tt.repeat, anchor: opts.start || t0 };
        f.when = opts.start || t0;
      }
      if (tt.materials) f.handy = { materials: [] };
      await createTask(f);
    }
  }
  return pid;
}

/* ---------- Clearhead import ---------- */

export interface ClearheadBackup {
  app: "Clearhead"; version?: number; exportedAt?: string;
  settings?: Record<string, unknown>; areas?: Area[]; projects?: Project[]; tasks?: Task[]; templates?: Template[];
}

export function readClearhead(x: unknown): ClearheadBackup {
  const b = x as ClearheadBackup;
  if (!b || b.app !== "Clearhead") throw new Error("That file isn't a Clearhead backup.");
  return b;
}

/** Same as Clearhead's own "Import JSON": adds or updates by id, never deletes. Safe to run twice. */
export async function importClearhead(b: ClearheadBackup): Promise<{ areas: number; projects: number; tasks: number; templates: number }> {
  const strip = <T extends object>(o: T): T => {
    const { space: _s, shared: _sh, assignee: _a, ...rest } = o as Record<string, unknown>;
    void _s; void _sh; void _a;
    return rest as T;
  };
  for (const a of b.areas || []) await put("areas", strip(a));
  for (const p of b.projects || []) await put("projects", strip(p));
  for (const t of b.tasks || []) await put("tasks", strip(t));
  for (const t of b.templates || []) await put("templates", { ...t, id: t.id || C.uid("tpl") });
  const s = (b.settings || {}) as Partial<HeadSettings> & Record<string, unknown>;
  const keep: (keyof HeadSettings)[] = ["weekStart", "reviewDay", "reviewTime", "planTime", "features", "contexts", "shutdownTime", "dndReminder", "quietMode", "offDays", "lastPlan", "lastReview", "lastShutdown"];
  const changes: Partial<HeadSettings> = {};
  for (const k of keep) if (s[k] !== undefined) (changes as Record<string, unknown>)[k] = s[k];
  await saveSettings({ ...changes, seeded: true });
  return { areas: (b.areas || []).length, projects: (b.projects || []).length, tasks: (b.tasks || []).length, templates: (b.templates || []).length };
}

/** Counts in Bird Nest after an import, to compare with the file. */
export async function headCounts(): Promise<{ areas: number; projects: number; tasks: number; open: number; done: number; templates: number }> {
  const tasks = await db.tasks.toArray();
  return {
    areas: await db.areas.count(), projects: await db.projects.count(), tasks: tasks.length,
    open: tasks.filter(C.isOpen).length, done: tasks.filter(C.isDone).length, templates: await db.templates.count(),
  };
}
