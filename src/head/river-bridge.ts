/* Head ⇄ River. Plan My Day puts tasks on the River as blocks with steps; finishing a block finishes
   the task (and its checklist). Undo on the block undoes the task too. Groceries become one shopping block. */
import * as C from "./core/clearhead.js";
import { cut } from "../lib/text";
import * as H from "./store";
import { db, type Kind } from "../lib/db";
import { addBlock, MAX_STEPS, setBlockDoneHandler, setStepHandler, softDelete, type StepInput, type Undo } from "../lib/river";
import { minutes as toMin, nowHHMM, today as riverToday } from "../lib/time";
import type { Task } from "./types";
import { ic } from "./ui/bits";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(Math.min(m, 23 * 60 + 45) / 60))}:${pad(Math.min(m, 23 * 60 + 45) % 60)}`;
const roundUp15 = (m: number) => Math.ceil(m / 15) * 15;

/** Up to 7 steps for a task: its checklist, else checkbox lines in its notes, else a simple three-step start. */
export function stepsForTask(t: Task): StepInput[] {
  const cl = (t.checklist || []).filter((c) => c.text.trim());
  if (cl.length) return cl.slice(0, MAX_STEPS).map((c) => ({ label: c.text, done: c.done }));
  const boxes = (t.notes || "").split("\n").map((l) => l.match(/^\s*[-*] \[( |x|X)\] (.*)$/)).filter(Boolean) as RegExpMatchArray[];
  if (boxes.length) return boxes.slice(0, MAX_STEPS).map((m) => ({ label: m[2], done: m[1].toLowerCase() === "x" }));
  const work = t.est ? `Work ${C.fmtMinutes(t.est)}` : "Work 25 min";
  return [{ label: "Get set up" }, { label: work }, { label: "Note the next step" }];
}

async function kindAndIcon(t: Task): Promise<{ kind: Kind; icon: string }> {
  const data = await H.loadData();
  const area = C.areaOfTask(t, data);
  if (t.grocery || area?.listMode === "groceries") return { kind: "life", icon: "🛒" };
  if (area && /handyman|business/i.test(area.name)) return { kind: "life", icon: "🔨" };
  if (area && /family|home/i.test(area.name)) return { kind: "life", icon: ic(area.icon) };
  return { kind: "head", icon: area ? ic(area.icon) : "🧠" };
}

/** The first free time on a day: after the last block, or now (rounded up) on today. */
export async function nextFreeSlot(day: string): Promise<number> {
  const blocks = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at);
  let start = 0;
  for (const b of blocks) start = Math.max(start, b.end ? toMin(b.end) : toMin(b.start) + 30);
  const settings = await H.loadSettings();
  const floor = day === riverToday() ? roundUp15(toMin(nowHHMM())) : toMin(settings.planTime || "07:00");
  return Math.max(start, floor);
}

export async function blockForTask(taskId: string, day: string) {
  return (await db.blocks.where("day").equals(day).toArray()).find((b) => !b.deleted_at && b.source_type === "task" && b.source_id === taskId);
}

/** One task → one block. Uses the task's own time if it has one. */
const placing = new Set<string>();
export async function putTaskOnRiver(taskId: string, day: string = riverToday(), at?: number): Promise<Undo> {
  // Two quick taps would both pass the "already there?" check below before either block is written.
  const key = taskId + "|" + day;
  if (placing.has(key)) return async () => {};
  placing.add(key);
  try { return await placeTask(taskId, day, at); } finally { placing.delete(key); }
}

async function placeTask(taskId: string, day: string, at?: number): Promise<Undo> {
  const t = await db.tasks.get(taskId);
  if (!t) return async () => {};
  if (await blockForTask(taskId, day)) return async () => {};
  const start = t.time && t.when === day ? toMin(t.time) : at ?? (await nextFreeSlot(day));
  const { kind, icon } = await kindAndIcon(t);
  const { id } = await addBlock({
    day, start: hhmm(start), end: hhmm(start + (t.est || 30)), kind, icon, title: cut(t.title, 48),
    steps: stepsForTask(t), source_type: "task", source_id: t.id,
  });
  return () => softDelete(id).then(() => {});
}

/** Several tasks in a row, back to back from the next free slot, in a sensible order:
    timed ones at their time; then "start with", morning, anytime, afternoon (from noon), evening (from 6 PM). */
export async function putTasksOnRiver(ids: string[], day: string = riverToday()): Promise<Undo> {
  const undos: Undo[] = [];
  const tasks = (await Promise.all(ids.map((id) => db.tasks.get(id)))).filter((t): t is Task => !!t);
  const rank = (t: Task) => (t.first === day ? 0 : ({ morning: 1, afternoon: 3, evening: 4 } as Record<string, number>)[t.tod || ""] ?? 2);
  tasks.sort((a, b) => rank(a) - rank(b) || (a.todayOrder ?? a.order) - (b.todayOrder ?? b.order));
  let at = await nextFreeSlot(day);
  for (const t of tasks) {
    if (await blockForTask(t.id, day)) continue;
    if (t.time && t.when === day) { undos.push(await putTaskOnRiver(t.id, day)); continue; }
    const floor = t.tod === "evening" ? 18 * 60 : t.tod === "afternoon" ? 12 * 60 : 0;
    const start = Math.max(at, floor);
    undos.push(await putTaskOnRiver(t.id, day, start));
    at = start + (t.est || 30);
  }
  return async () => { for (const u of undos) await u(); };
}

/** Open grocery items → a shopping block, grouped by aisle (first 7 aisles' worth of items). */
export async function putGroceriesOnRiver(areaId: string, day: string = riverToday(), title = "Groceries"): Promise<Undo | null> {
  const items = (await db.tasks.toArray()).filter((t) => t.areaId === areaId && t.status === "open" && t.grocery);
  if (!items.length) return null;
  const order = C.GROCERY_CATS.map((c) => c.id);
  items.sort((a, b) => order.indexOf(a.grocery!.cat) - order.indexOf(b.grocery!.cat) || a.order - b.order);
  const take = items.slice(0, MAX_STEPS);
  const start = await nextFreeSlot(day);
  const { id } = await addBlock({
    day, start: hhmm(start), end: hhmm(start + 45), kind: "life", icon: "🛒", title,
    steps: take.map((t) => ({ label: t.title, value: C.GROCERY_CATS.find((c) => c.id === t.grocery!.cat)?.name ?? null })),
    source_type: "groceries", source_id: take.map((t) => t.id).join(","),
  });
  return () => softDelete(id).then(() => {});
}

/* Finishing a block finishes what it came from. Undo of the block brings it back. */
const pending = new Map<string, Undo>();
export function installRiverBridge() {
  // A step ticked on the River ticks the same item on the task's checklist (or in its notes).
  setStepHandler(async (block, label, done) => {
    if (block.source_type !== "task" || !block.source_id) return;
    const t = await db.tasks.get(block.source_id);
    if (!t) return;
    if (t.checklist?.some((c) => c.text === label)) {
      await H.updateTask(t.id, { checklist: t.checklist.map((c) => (c.text === label ? { ...c, done } : c)) });
    } else if (t.notes) {
      const lines = t.notes.split("\n");
      const i = lines.findIndex((l) => { const m = l.match(/^\s*[-*] \[( |x|X)\] (.*)$/); return !!m && m[2] === label; });
      if (i >= 0) { lines[i] = lines[i].replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]"); await H.updateTask(t.id, { notes: lines.join("\n") }); }
    }
  });
  setBlockDoneHandler(async (block) => {
    if (block.source_type === "task" && block.source_id) {
      const t = await db.tasks.get(block.source_id);
      if (!t || t.status !== "open") return;
      if (t.checklist?.length) await H.updateTask(t.id, { checklist: t.checklist.map((c) => ({ ...c, done: true })) });
      const undoDone = await H.completeTask(t.id);
      pending.set(block.id, undoDone);
    }
    if (block.source_type === "groceries" && block.source_id) {
      const undos: Undo[] = [];
      for (const id of block.source_id.split(",")) undos.push(await H.completeTask(id));
      pending.set(block.id, async () => { for (const u of undos) await u(); });
    }
  }, async (blockId) => {
    const b = await db.blocks.get(blockId);
    // Only an undo that takes the block back out of "done" un-finishes the task. Undoing an edit or a moved
    // time on a block that's still done leaves the task (and its next repeat) alone.
    const u = pending.get(blockId);
    if (u && b && b.status !== "done") { pending.delete(blockId); await u(); }
    // After an undo, the task's checklist matches the River's steps again.
    if (b?.source_type === "task" && b.source_id) {
      const t = await db.tasks.get(b.source_id);
      const steps = await db.steps.where("block_id").equals(blockId).toArray();
      if (t?.checklist?.length) {
        const done = new Map(steps.filter((x) => !x.deleted_at).map((x) => [x.label, !!x.done_at]));
        const next = t.checklist.map((c) => (done.has(c.text) ? { ...c, done: done.get(c.text)! } : c));
        if (JSON.stringify(next) !== JSON.stringify(t.checklist)) await H.updateTask(t.id, { checklist: next });
      }
    }
  });
}
