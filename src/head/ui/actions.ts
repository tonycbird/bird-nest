/* Clearhead's ui/actions.js: the things you can do to a task, with their toasts and undos. */
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { db } from "../../lib/db";
import { toast } from "../../lib/toast";
import { closeTask, go, nav } from "../useHead";
import type { Area, Project, RepeatRule, Task, Waiting } from "../types";
import { openSheet } from "./sheets";
import {
  AreaEditor, ChoicePicker, ConfirmSheet, ContextPicker, DatePicker, EstimatePicker, MenuSheet, MovePicker,
  ProjectEditor, RepeatEditor, WaitingPicker, type MenuItem, type MoveResult, type WhenResult,
} from "./pickers";

const T = (id: string) => db.tasks.get(id);
const join = (fns: H.Undo[]) => async () => { for (const f of fns) await f(); };

export async function openMenu(title: string, items: (MenuItem | "-")[]) {
  const i = await openSheet<number>(MenuSheet, { title, items });
  if (i === undefined) return;
  const it = items[i];
  if (it && it !== "-") await it.run();
}

export async function complete(id: string) {
  const t = await T(id);
  if (!t) return;
  if (t.status === "done") return toast("↺ Not done", await H.uncompleteTask(id));
  const u = await H.completeTask(id);
  if (t.repeat) {
    const next = (await db.tasks.toArray()).filter((x) => x.title === t.title && x.status === "open" && x.id !== id && x.repeat).sort((a, b) => b.createdAt - a.createdAt)[0];
    toast("✓ Next: " + (next && (next.when || next.due) ? C.relLabel(next.when || next.due) : C.describeRule(t.repeat)), u);
  } else toast("✓ Done", u);
}

export async function completeMany(ids: string[]) {
  const undos: H.Undo[] = [];
  for (const id of ids) undos.push(await H.completeTask(id));
  toast(`✓ ${undos.length} done`, join(undos));
}

export async function schedule(ids: string | string[], opts: { title?: string } = {}) {
  const list = ([] as string[]).concat(ids);
  const first = await T(list[0]);
  if (!first) return;
  const r = await openSheet<WhenResult>(DatePicker, { value: first.when, tod: first.tod, mode: "when", title: opts.title });
  if (r === undefined) return;
  const undos: H.Undo[] = [];
  for (const id of list) {
    const t = await T(id);
    // One task: the picker's time of day is the answer ("Anytime" = none). Several: keep each one's own unless one was picked.
    undos.push(await H.updateTask(id, { when: r.when, tod: r.when ? (list.length === 1 ? r.tod ?? null : r.tod ?? t?.tod ?? null) : null, someday: !!r.someday }));
  }
  const label = r.someday ? "💤 Someday" : r.when ? `📅 ${C.relLabel(r.when)}${r.tod === "evening" && r.when === C.today() ? " evening" : ""}` : "✕ No date";
  toast(list.length > 1 ? `${list.length} · ${label}` : label, join(undos));
  return r;
}

export async function setDue(id: string) {
  const t = await T(id);
  if (!t) return;
  const r = await openSheet<WhenResult>(DatePicker, { value: t.due, mode: "due" });
  if (r === undefined) return;
  toast(r.due ? `⚑ ${C.relLabel(r.due)}` : "✕ No deadline", await H.updateTask(id, { due: r.due ?? null }));
}

export async function move(ids: string | string[]) {
  const list = ([] as string[]).concat(ids);
  const r = await openSheet<MoveResult>(MovePicker, {});
  if (r === undefined) return;
  const undos: H.Undo[] = [];
  for (const id of list) undos.push(await H.updateTask(id, { areaId: r.areaId, projectId: r.projectId, sectionId: r.sectionId }));
  const dest = r.projectId ? (await db.projects.get(r.projectId))?.name : r.areaId ? (await db.areas.get(r.areaId))?.name : "Inbox";
  toast(`↪ ${dest}`, join(undos));
  return r;
}

export async function setContexts(ids: string | string[]) {
  const list = ([] as string[]).concat(ids);
  const first = await T(list[0]);
  if (!first) return;
  const r = await openSheet<string[]>(ContextPicker, { value: list.length > 1 ? [] : first.contexts || [] });
  if (r === undefined) return;
  const undos: H.Undo[] = [];
  for (const id of list) {
    const t = await T(id);
    undos.push(await H.updateTask(id, { contexts: list.length > 1 ? [...new Set([...(t?.contexts || []), ...r])] : r }));
  }
  if (list.length > 1) toast("@ Added", join(undos));
  return r;
}

export async function setRepeat(id: string) {
  const t = await T(id);
  if (!t) return;
  const r = await openSheet<RepeatRule | null>(RepeatEditor, { value: t.repeat, base: t.when || t.due || C.today() });
  if (r === undefined) return;
  const ch: Partial<Task> = { repeat: r };
  if (r && !t.when && !t.due && r.freq !== "after") ch.when = r.anchor ?? null;
  await H.updateTask(id, ch);
}

export async function setWaiting(id: string) {
  const t = await T(id);
  if (!t) return;
  const r = await openSheet<Waiting | null>(WaitingPicker, { value: t.waiting });
  if (r === undefined) return;
  toast(r ? `⏳ ${r.who}` : "✓ Not waiting", await H.updateTask(id, { waiting: r }, { history: r ? "waiting on " + r.who : "no longer waiting" }));
}

export async function setEstimate(id: string) {
  const t = await T(id);
  const r = await openSheet<number | null>(EstimatePicker, { value: t?.est ?? null });
  if (r !== undefined) await H.updateTask(id, { est: r });
}

export async function setEnergy(id: string) {
  const t = await T(id);
  const r = await openSheet<string | null>(ChoicePicker, {
    title: "⚡ Energy", value: t?.energy ?? null, clear: "Any", options: [
      { id: "low", name: "Low — tired is fine", icon: "🔋" }, { id: "med", name: "Medium", icon: "🔋" }, { id: "high", name: "High — fresh", icon: "⚡" },
    ],
  });
  if (r !== undefined) await H.updateTask(id, { energy: r as Task["energy"] });
}

export async function setPriority(id: string) {
  const t = await T(id);
  const r = await openSheet<string>(ChoicePicker, {
    title: "⚑ Priority", value: t?.priority || "normal", options: [
      { id: "high", name: "High", icon: "🔺" }, { id: "normal", name: "Normal", icon: "▫" }, { id: "low", name: "Low", icon: "🔻" },
    ],
  });
  if (r !== undefined) await H.updateTask(id, { priority: r as Task["priority"] });
}

export async function toggleImportant(ids: string | string[]) {
  const list = ([] as string[]).concat(ids);
  const tasks = await Promise.all(list.map(T));
  const on = !tasks.every((t) => t?.important);
  const undos: H.Undo[] = [];
  for (const id of list) undos.push(await H.updateTask(id, { important: on }));
  if (list.length > 1) toast(on ? "⚑ Flagged" : "Unflagged", join(undos));
}

export async function remove(ids: string | string[]) {
  const list = ([] as string[]).concat(ids);
  const undos: H.Undo[] = [];
  for (const id of list) undos.push(await H.deleteTask(id));
  if (nav.get().selected && list.includes(nav.get().selected!)) closeTask();
  toast(list.length > 1 ? `🗑 ${list.length} deleted` : "🗑 Deleted", join(undos));
}

export async function toSomeday(ids: string | string[]) {
  const list = ([] as string[]).concat(ids);
  const undos: H.Undo[] = [];
  for (const id of list) undos.push(await H.updateTask(id, { someday: true, when: null, tod: null }));
  toast("💤 Someday", join(undos));
}

export async function duplicate(id: string) {
  const n = await H.duplicateTask(id);
  if (!n) return;
  toast("⧉ Duplicated", async () => { await H.deleteTask(n.id); });
  nav.set((s) => ({ ...s, selected: n.id }));
}

export async function toProject(t: Task) {
  const pid = await H.taskToProject(t.id);
  if (!pid) return;
  closeTask();
  go("project", pid);
  toast("📁 Now a project. Add the small steps.");
}

export async function newArea() {
  const r = await openSheet<Partial<Area>>(AreaEditor, {});
  if (!r) return;
  const id = await H.createArea(r as { name: string });
  go("area", id);
}

export async function editArea(id: string) {
  const a = await db.areas.get(id);
  const r = await openSheet<Partial<Area>>(AreaEditor, { area: a });
  if (!r) return;
  await H.updateArea(id, { name: r.name, color: r.color, icon: r.icon, listMode: r.listMode });
}

export async function newProject(areaId?: string | null) {
  const r = await openSheet<Partial<Project>>(ProjectEditor, { areaId });
  if (!r) return;
  const id = await H.createProject(r);
  go("project", id);
  return id;
}

export async function editProject(id: string) {
  const p = await db.projects.get(id);
  const r = await openSheet<Partial<Project>>(ProjectEditor, { project: p });
  if (!r) return;
  toast("✓ Saved", await H.updateProject(id, r));
}

export async function confirm(title: string, body?: string, confirmText = "OK", danger = false) {
  return !!(await openSheet<boolean>(ConfirmSheet, { title, body, confirm: confirmText, danger }));
}

/* Waiting For: follow up by text, email or copied message (Clearhead's followUp menu). */
export function followUpMessage(t: Task) {
  return `Hi ${t.waiting!.who}, just following up on ${t.title.replace(/^follow up (on|with) /i, "")}. Any update?`;
}
function openLink(href: string) {
  const a = document.createElement("a");
  a.href = href; a.target = "_top"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}
export async function followUp(t: Task) {
  if (!t.waiting) return;
  const msg = followUpMessage(t);
  await openMenu("⏳ " + t.waiting.who, [
    { text: "Text message", icon: "💬", run: () => openLink("sms:?&body=" + encodeURIComponent(msg)) },
    { text: "Email", icon: "✉", run: () => openLink("mailto:?subject=" + encodeURIComponent("Following up: " + t.title) + "&body=" + encodeURIComponent(msg)) },
    { text: "Copy message", icon: "⧉", run: async () => toast((await copyText(msg)) ? "⧉ Copied" : msg) },
    "-",
    { text: "Remind me on…", icon: "📅", run: async () => {
      const r = await openSheet<WhenResult>(DatePicker, { value: t.waiting!.followUp, mode: "due", title: "Follow up on" });
      if (r !== undefined) await H.updateTask(t.id, { waiting: { ...t.waiting!, followUp: r.due ?? null } });
    } },
    { text: "Followed up today", icon: "✓", run: () => H.updateTask(t.id, { waiting: { ...t.waiting!, followUp: C.addDays(C.today(), 3) } }, { history: "followed up" }) },
    { text: "Got it — not waiting", icon: "✅", run: () => H.updateTask(t.id, { waiting: null }, { history: "no longer waiting" }) },
  ]);
}
