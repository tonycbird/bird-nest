/* The morning dump gives today's tasks a time (Nov 19, his pick: "Lets do this").
   Work things get their own slots inside his work hours, in the order he said them, around meetings.
   Calls wait for the drive, home things for free time, class things for study. What doesn't fit moves
   to tomorrow, and he's told. A slotted task that runs over slides to the next open time in the same window. */
import { db, nowISO, type Block, type Kind } from "./db";
import { addBlock, softDelete, type RiverBlock, type Undo } from "./river";
import { addDays, minutes } from "./time";
import { taskIcon } from "../ui/colors";
import { cut } from "./text";
import { endOf, startMin } from "./coach";
import { weekKeyOf } from "./week";
import type { Task } from "../head/types";
import * as H from "../head/store";

export type Lane = "work" | "call" | "home" | "study" | "handyman" | "shop";
export interface Span { from: number; to: number }

const HOME_ICONS = new Set(["heart", "meal", "paw", "gift", "groceries"]);
/* "Clean" alone could be the church's cafeteria; these say home. */
const HOME_WORDS = /\b(?:laundry|dishes|lawn|mow|yard|garage|nursery|crib|diapers?|dog|trash cans?|(?:our|my|the) (?:house|home|room|bedroom|kitchen|truck|car|garage)|at home|around the house)\b/i;
const SAYS = new Set(["mail", "call", "bill", "coin", "doc", "job", "calendar", "laptop", "drive", "coffee", "church"]);
/** Where a task belongs in his day. */
export function laneOf(t: Pick<Task, "title" | "grocery">, area = "", project = ""): Lane {
  if (t.grocery) return "shop";
  const icon = taskIcon(t.title);
  if (icon === "call") return "call";
  if (/handyman|business/i.test(area) || /handyman/i.test(project)) return "handyman";
  if (icon === "study" || /theology|degree|school|class/i.test(area)) return "study";
  if (HOME_ICONS.has(icon) || HOME_WORDS.test(t.title) || /family|home/i.test(area)) return "home";
  return "work";
}
export const WAITS: Partial<Record<Lane, string>> = { call: "On the drive", home: "Free time", study: "At study", shop: "Shopping list", handyman: "Handyman day" };

/** The free stretches inside a window, around everything else on the River. */
export function freeIn(win: Span, busy: Span[]): Span[] {
  const out: Span[] = [];
  let at = win.from;
  for (const b of [...busy].filter((x) => x.to > win.from && x.from < win.to).sort((a, b) => a.from - b.from)) {
    if (b.from > at) out.push({ from: at, to: Math.min(b.from, win.to) });
    at = Math.max(at, b.to);
    if (at >= win.to) break;
  }
  if (at < win.to) out.push({ from: at, to: win.to });
  return out.filter((g) => g.to - g.from >= 10);
}

const BACKGROUND = new Set(["work", "handyman", "dayoff"]);
const live = (b: RiverBlock | Block) => !b.deleted_at && b.status !== "skipped";
/** His working stretches today (Work, Handyman jobs, the day off), else the rest of the day until wind-down. */
export function windowsOf(blocks: (RiverBlock | Block)[], handymanToo: boolean): Span[] {
  const keys = handymanToo ? BACKGROUND : new Set(["work", "dayoff"]);
  const w = blocks.filter((b) => live(b) && keys.has(weekKeyOf(b) ?? "")).map((b) => ({ from: startMin(b), to: endOf(b) }));
  if (w.length) return w.sort((a, b) => a.from - b.from);
  const wind = blocks.find((b) => live(b) && weekKeyOf(b) === "wind");
  return [{ from: 6 * 60, to: wind ? startMin(wind) : 21 * 60 }];
}
/** What already takes time (meetings, drives, the workout, other tasks), not the background blocks. */
export function busyOf(blocks: (RiverBlock | Block)[]): Span[] {
  return blocks.filter((b) => live(b) && !BACKGROUND.has(weekKeyOf(b) ?? "")).map((b) => ({ from: startMin(b), to: endOf(b) }));
}

export interface Want { id: string; mins: number; lane: Lane }
export interface Plan { placed: { id: string; from: number; to: number }[]; over: string[]; waiting: string[] }
const len = (m: number | null | undefined) => Math.min(120, Math.max(10, m || 30));

/** Pure: each work thing, in order, into the first free stretch that fits it. */
export function plan(wants: Want[], windows: Span[], busy: Span[], nowMin: number): Plan {
  const out: Plan = { placed: [], over: [], waiting: [] };
  const floor = Math.ceil(nowMin / 5) * 5;
  const taken = [...busy];
  for (const w of wants) {
    if (w.lane !== "work" && w.lane !== "handyman") { out.waiting.push(w.id); continue; }
    // The first stretch it fits in whole; failing that, the first one with at least 15 minutes.
    const gaps = windows.flatMap((win) => { const from = Math.max(win.from, floor); return from < win.to ? freeIn({ from, to: win.to }, taken) : []; });
    const spot = gaps.find((g) => g.to - g.from >= w.mins) ?? gaps.find((g) => g.to - g.from >= 15) ?? null;
    if (!spot) { out.over.push(w.id); continue; }
    const to = Math.min(spot.from + w.mins, spot.to);
    out.placed.push({ id: w.id, from: spot.from, to });
    taken.push({ from: spot.from, to });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

export interface Slotted { placed: { id: string; block: string }[]; over: string[]; waiting: { id: string; lane: Lane }[]; undo: Undo }

/** Give today's new tasks a time. `ids` in the order he said them. */
export async function slotTasks(ids: string[], day: string, nowMin: number, names: (t: Task) => { area: string; project: string }, overflow: "tomorrow" | "leave" = "tomorrow"): Promise<Slotted> {
  const tasks = (await Promise.all(ids.map((id) => db.tasks.get(id)))).filter((t): t is Task => !!t && t.status === "open");
  const blocks = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at);
  const onRiver = new Set(blocks.filter((b) => b.source_type === "task").map((b) => b.source_id));
  const todo = tasks.filter((t) => !onRiver.has(t.id) && !t.time);
  const lanes = new Map(todo.map((t) => { const n = names(t); return [t.id, laneOf(t, n.area, n.project)] as const; }));
  const handymanDay = blocks.some((b) => weekKeyOf(b) === "handyman");
  const wants: Want[] = todo.map((t) => {
    const lane = lanes.get(t.id)!;
    return { id: t.id, mins: len(t.est), lane: lane === "handyman" && !handymanDay ? "work" : lane };
  });
  const p = plan(wants, windowsOf(blocks, handymanDay), busyOf(blocks), nowMin);
  const made: { id: string; block: string }[] = [];
  for (const s of p.placed) {
    const t = todo.find((x) => x.id === s.id)!;
    const said = taskIcon(t.title);
    const kind: Kind = lanes.get(t.id) === "handyman" ? "life" : "head";
    // A work thing looks like work unless its words name something clearer (mail, a bill, a quote…): "walk the roof" isn't the gym.
    const icon = SAYS.has(said) ? said : kind === "life" ? "job" : "briefcase";
    const steps = (t.checklist || []).filter((c) => c.text.trim()).slice(0, 7).map((c) => ({ label: c.text, done: c.done }));
    const { id } = await addBlock({ day, start: hhmm(s.from), end: hhmm(s.to), kind, icon, title: cut(t.title, 48), steps, source_type: "task", source_id: t.id, slot: true });
    made.push({ id: t.id, block: id });
  }
  const tomorrow = addDays(day, 1);
  const moved: { id: string; when: string | null }[] = [];
  for (const id of overflow === "tomorrow" ? p.over : []) {
    const t = await db.tasks.get(id);
    if (!t) continue;
    moved.push({ id, when: t.when });
    await H.updateTask(id, { when: tomorrow });
  }
  return {
    placed: made, over: p.over,
    waiting: p.waiting.map((id) => ({ id, lane: lanes.get(id)! })),
    undo: async () => {
      for (const m of made) await softDelete(m.block);
      for (const m of moved) await H.updateTask(m.id, { when: m.when });
    },
  };
}

/** Move a slotted task: earlier/later swaps it with its neighbour; "tomorrow" and "no time" take it off today's River. */
export async function moveSlot(blockId: string, how: "earlier" | "later" | "tomorrow" | "untime"): Promise<Undo> {
  const b = await db.blocks.get(blockId);
  if (!b) return async () => {};
  if (how === "tomorrow" || how === "untime") {
    const t = b.source_id ? await db.tasks.get(b.source_id) : undefined;
    const was = t?.when ?? null;
    await softDelete(blockId);
    if (t && how === "tomorrow") await H.updateTask(t.id, { when: addDays(b.day, 1) });
    return async () => {
      await db.blocks.update(blockId, { deleted_at: null, updated_at: nowISO() });
      if (t && how === "tomorrow") await H.updateTask(t.id, { when: was });
    };
  }
  const mates = (await db.blocks.where("day").equals(b.day).toArray()).filter((x) => !x.deleted_at && x.slot && x.status === "open").sort((x, y) => x.start.localeCompare(y.start));
  const i = mates.findIndex((x) => x.id === blockId);
  const j = how === "earlier" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= mates.length) return async () => {};
  const a = mates[i], c = mates[j];
  // Swap places: each keeps its own length, in the other's spot.
  const first = how === "earlier" ? c : a, second = how === "earlier" ? a : c;
  const start = minutes(first.start), gap = minutes(second.start) - endOf(first);
  const newFirst = { start: hhmm(start), end: hhmm(start + (endOf(second) - minutes(second.start))) };
  const s2 = start + (endOf(second) - minutes(second.start)) + Math.max(0, gap);
  const newSecond = { start: hhmm(s2), end: hhmm(s2 + (endOf(first) - minutes(first.start))) };
  const t = nowISO();
  await db.blocks.update(second.id, { ...newFirst, updated_at: t });
  await db.blocks.update(first.id, { ...newSecond, updated_at: t });
  return async () => {
    const u = nowISO();
    await db.blocks.update(first.id, { start: first.start, end: first.end, updated_at: u });
    await db.blocks.update(second.id, { start: second.start, end: second.end, updated_at: u });
  };
}

let sliding = false;
/** A slotted task whose time ran out, not done: to the next open time in the same window (never past it). */
export async function slideUnfinished(day: string, nowMin: number): Promise<number> {
  if (sliding) return 0;
  sliding = true;
  try {
    const blocks = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at);
    const late = blocks.filter((b) => b.slot && b.status === "open" && endOf(b) <= nowMin);
    if (!late.length) return 0;
    const handymanDay = blocks.some((b) => weekKeyOf(b) === "handyman");
    const windows = windowsOf(blocks, handymanDay);
    let n = 0;
    for (const b of late.sort((x, y) => x.start.localeCompare(y.start))) {
      const t = b.source_id ? await db.tasks.get(b.source_id) : undefined;
      if (t && t.status !== "open") { await db.blocks.update(b.id, { status: "done", done_at: nowISO(), updated_at: nowISO() }); continue; }
      const win = windows.find((w) => w.from <= startMin(b) && startMin(b) < w.to) ?? windows.find((w) => w.to > nowMin);
      if (!win || win.to <= nowMin) continue;
      const others = busyOf(blocks.filter((x) => x.id !== b.id && !(x.slot && x.status === "open" && endOf(x) <= nowMin)));
      const want = endOf(b) - startMin(b);
      const gaps = freeIn({ from: Math.max(win.from, Math.ceil(nowMin / 5) * 5), to: win.to }, others);
      const gap = gaps.find((g) => g.to - g.from >= want) ?? gaps.find((g) => g.to - g.from >= 15);
      if (!gap) continue;
      const to = Math.min(gap.from + want, gap.to);
      await db.blocks.update(b.id, { start: hhmm(gap.from), end: hhmm(to), updated_at: nowISO() });
      b.start = hhmm(gap.from); b.end = hhmm(to);
      n++;
    }
    return n;
  } finally { sliding = false; }
}

/** The morning of a day he dumped things for ahead of time ("these are the tasks for Tuesday"): the first time Nest
    opens that day, those things get their times too. Once a day; what doesn't fit stays on today's list. */
export async function slotToday(day: string, nowMin: number): Promise<number> {
  const key = "nest:slotted:" + day;
  try { if (localStorage.getItem(key)) return 0; } catch { /* storage blocked: still once per open below */ }
  const blocks = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at);
  const windows = windowsOf(blocks, blocks.some((b) => weekKeyOf(b) === "handyman"));
  if (!windows.some((w) => w.to > nowMin)) return 0; // the day's work is over: nothing to place
  const onRiver = new Set(blocks.filter((b) => b.source_type === "task").map((b) => b.source_id));
  const data = await H.loadData();
  const todays = (await db.tasks.where("when").equals(day).toArray())
    .filter((t) => t.status === "open" && !t.time && !t.someday && !t.grocery && !onRiver.has(t.id))
    .sort((a, b) => (a.todayOrder ?? a.order) - (b.todayOrder ?? b.order) || a.createdAt - b.createdAt);
  try { localStorage.setItem(key, "1"); } catch { /* ok */ }
  if (!todays.length) return 0;
  const names = (t: Task) => ({ area: (t.areaId && data.areas.get(t.areaId)?.name) || "", project: (t.projectId && data.projects.get(t.projectId)?.name) || "" });
  return (await slotTasks(todays.map((t) => t.id), day, nowMin, names, "leave")).placed.length;
}
