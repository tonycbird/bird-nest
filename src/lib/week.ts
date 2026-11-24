/* Your week: Anthony's usual days, so the River is never empty and Today can always say what's now.
   Each weekday has a few plain blocks (Morning, Drive to work, Work, Home, Study, Wind down…).
   They land on the River by themselves for today and tomorrow, once each: one he takes off stays off.
   Change one on the River and tap "Every Wednesday" to keep it; the week follows, and so do today
   and tomorrow (only the blocks he hasn't changed himself). Until he changes anything, the week
   below is used as written (Nov 19, from his answers). */
import { db, type Block, type Kind } from "./db";
import { addBlock, softDelete, restoreBlock, type StepInput, type Undo } from "./river";
import { setSetting } from "./settings";
import { addDays } from "./time";

export interface WeekBlock {
  key: string;            // unique within its day ("work", "drive-in"…)
  start: string;          // "HH:MM"
  end: string;            // "HH:MM"
  title: string;
  icon: string;           // a Nest icon name
  kind: Kind;
  steps?: StepInput[];
  gym?: boolean;          // only on days Body has a workout
}
/** days[0] = Sunday … days[6] = Saturday. */
export interface Week { v: 1; days: WeekBlock[][] }

export const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dowOf = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); };

/* ---------- the week as he described it ---------- */

const morning = (): WeekBlock => ({ key: "morning", start: "04:30", end: "05:30", title: "Morning", icon: "morning", kind: "head",
  steps: [{ label: "Water + coffee" }, { label: "Bible + prayer", value: "20 min" }, { label: "Look over today", value: "2 min" }] });
const gym = (): WeekBlock => ({ key: "gym", start: "05:40", end: "06:00", title: "Drive to the gym", icon: "drive", kind: "body", gym: true });
const driveIn = (start: string, end: string): WeekBlock => ({ key: "drive-in", start, end, title: "Drive to work", icon: "drive", kind: "life" });
const work = (start: string, end: string): WeekBlock => ({ key: "work", start, end, title: "Work", icon: "briefcase", kind: "head" });
const driveHome = (start: string, end: string): WeekBlock => ({ key: "drive-home", start, end, title: "Drive home", icon: "drive", kind: "life" });
const family = (start: string): WeekBlock => ({ key: "family", start, end: "19:00", title: "Home · Abby + baby", icon: "heart", kind: "life" });
const shutdown = (): WeekBlock => ({ key: "shutdown", start: "19:00", end: "19:15", title: "Shutdown", icon: "shutdown", kind: "head" });
const study = (): WeekBlock => ({ key: "study", start: "19:30", end: "20:15", title: "Study", icon: "study", kind: "head",
  steps: [{ label: "Open this week's lesson" }, { label: "Read", value: "25 min" }, { label: "Write 3 notes", value: "10 min" }] });
const wind = (gymTomorrow: boolean): WeekBlock => ({ key: "wind", start: "20:30", end: "21:00", title: "Wind down", icon: "sleep", kind: "life",
  steps: [...(gymTomorrow ? [{ label: "Gym bag by the door" }] : []), { label: "Phone on charger" }, { label: "Lights out by 9" }] });

export function defaultWeek(): Week {
  return {
    v: 1,
    days: [
      /* Sun */ [morning(), driveIn("06:10", "06:30"), work("06:30", "17:00"), driveHome("17:00", "17:20"), family("17:30"), shutdown(), study(), wind(false)],
      /* Mon */ [morning(), { key: "dayoff", start: "08:00", end: "17:00", title: "Day off", icon: "weekend", kind: "life" }, study(), wind(false)],
      /* Tue */ [morning(), { key: "handyman", start: "07:30", end: "15:30", title: "Handyman jobs", icon: "job", kind: "life" }, family("16:00"), shutdown(), study(), wind(true)],
      /* Wed */ [morning(), gym(), driveIn("07:40", "08:00"), work("08:00", "16:30"), driveHome("16:30", "16:50"), family("17:00"), shutdown(), study(), wind(true)],
      /* Thu */ [morning(), gym(), driveIn("07:40", "08:00"), work("08:00", "16:30"), driveHome("16:30", "16:50"), family("17:00"), shutdown(), study(), wind(true)],
      /* Fri */ [morning(), gym(), driveIn("10:40", "11:00"), work("11:00", "17:00"), driveHome("17:00", "17:20"), family("17:30"), shutdown(), study(), wind(true)],
      /* Sat */ [morning(), gym(), driveIn("13:40", "14:00"), work("14:00", "20:00"), driveHome("20:00", "20:20"), wind(false)],
    ],
  };
}

export interface WeekPrefs { week: Week | null }
/** His week: the one he's changed, else the one above. */
export async function loadWeek(): Promise<Week> {
  const w = (await db.settings.get("week"))?.value as Week | null | undefined;
  return w && w.v === 1 && Array.isArray(w.days) && w.days.length === 7 ? w : defaultWeek();
}
export const blocksFor = (w: Week, day: string): WeekBlock[] => [...(w.days[dowOf(day)] ?? [])].sort((a, b) => a.start.localeCompare(b.start));

/* ---------- onto the River ---------- */

export const weekSourceId = (day: string, key: string) => `${day}|${key}`;
/** "work" for "2026-11-25|work", and for a swapped-in "2026-11-26|work~work" too. */
export const weekKeyOf = (b: Pick<Block, "source_type" | "source_id">) => (b.source_type === "week" ? ((b.source_id || "").split("|")[1] ?? "").split("~")[0] || null : null);

/** The week's blocks for a day, each placed once. `gym`: when Body's workout starts that day ("06:00"),
    null on a rest day, undefined while Body is still starting (the gym drive waits for it). */
export async function fillWeek(day: string, gym: string | null | undefined, w?: Week): Promise<number> {
  const week = w ?? (await loadWeek());
  if ((await db.settings.get("swap:" + day))?.value) return 0; // a day he made different keeps its own plan
  const there = (await db.blocks.where("day").equals(day).toArray()).filter((b) => b.source_type === "week");
  const placed = new Set(there.map((b) => b.source_id)); // deleted ones too: what he took off stays off
  let n = 0;
  for (const wb of blocksFor(week, day)) {
    if (wb.gym && !gym) continue;
    if (placed.has(weekSourceId(day, wb.key))) continue;
    // The drive to the gym ends when the workout starts, whatever time Body has it.
    const [start, end] = wb.gym && gym ? [addMinutes(gym, -lenOf(wb)), gym] : [wb.start, wb.end];
    await addBlock({ day, start, end, kind: wb.kind, icon: wb.icon, title: wb.title, steps: wb.steps ?? [], source_type: "week", source_id: weekSourceId(day, wb.key) });
    n++;
  }
  return n;
}

/** Blocks he hasn't changed (same time and title as the week said, nothing ticked) follow a change to the week. */
async function follow(day: string, before: Week, after: Week): Promise<{ moved: { id: string; was: Partial<Block> }[]; removed: string[] }> {
  const out = { moved: [] as { id: string; was: Partial<Block> }[], removed: [] as string[] };
  const blocks = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at && b.source_type === "week" && b.status === "open");
  const old = new Map(blocksFor(before, day).map((x) => [x.key, x]));
  const now = new Map(blocksFor(after, day).map((x) => [x.key, x]));
  for (const b of blocks) {
    const key = weekKeyOf(b)!;
    const o = old.get(key);
    if (!o || o.start !== b.start || o.end !== b.end || o.title !== b.title) continue; // he changed this one himself
    const ticked = (await db.steps.where("block_id").equals(b.id).toArray()).some((s) => s.done_at && !s.deleted_at);
    if (ticked) continue;
    const n = now.get(key);
    if (!n) { await softDelete(b.id); out.removed.push(b.id); continue; }
    if (n.start !== b.start || n.end !== b.end || n.title !== b.title || n.icon !== b.icon) {
      out.moved.push({ id: b.id, was: { start: b.start, end: b.end, title: b.title, icon: b.icon } });
      await db.blocks.update(b.id, { start: n.start, end: n.end, title: n.title, icon: n.icon, updated_at: new Date().toISOString() });
    }
  }
  return out;
}

/** Save a new week. Today and tomorrow follow; new blocks land. Undo puts it all back. */
export async function saveWeek(next: Week, today: string): Promise<Undo> {
  const before = await loadWeek();
  const row = await db.settings.get("week");
  await setSetting("week", next);
  const changes: Awaited<ReturnType<typeof follow>>[] = [];
  for (const d of [today, addDays(today, 1)]) changes.push(await follow(d, before, next));
  return async () => {
    await setSetting("week", row?.value ?? null);
    for (const c of changes) {
      for (const m of c.moved) await db.blocks.update(m.id, { ...m.was, updated_at: new Date().toISOString() });
      for (const id of c.removed) await restoreBlock(id);
    }
  };
}

const copy = (w: Week): Week => ({ v: 1, days: w.days.map((d) => d.map((b) => ({ ...b, steps: b.steps?.map((s) => ({ ...s })) }))) });
const rid = () => "b" + Math.random().toString(36).slice(2, 8);

/** "Every Wednesday": this block's time and title become the week's for that weekday. */
export async function keepEvery(b: Block, stepLabels: StepInput[], today: string): Promise<Undo> {
  const week = copy(await loadWeek());
  const dow = dowOf(b.day);
  const key = weekKeyOf(b);
  const entry: WeekBlock = { key: key ?? rid(), start: b.start, end: b.end ?? addMinutes(b.start, 30), title: b.title, icon: b.icon, kind: b.kind,
    steps: stepLabels.map((s) => ({ label: s.label, value: s.value ?? null })) };
  const list = week.days[dow];
  const i = list.findIndex((x) => x.key === entry.key);
  if (i >= 0) list[i] = { ...list[i], ...entry, gym: list[i].gym };
  else list.push(entry);
  const was = { source_type: b.source_type ?? null, source_id: b.source_id ?? null };
  if (!key) await db.blocks.update(b.id, { source_type: "week", source_id: weekSourceId(b.day, entry.key), updated_at: new Date().toISOString() });
  const undo = await saveWeek(week, today);
  return async () => { await undo(); if (!key) await db.blocks.update(b.id, { ...was, updated_at: new Date().toISOString() }); };
}

/** "Not on Wednesdays": off the week, and off this day. */
export async function dropEvery(b: Block, today: string): Promise<Undo> {
  const key = weekKeyOf(b);
  if (!key) return async () => {};
  const week = copy(await loadWeek());
  const dow = dowOf(b.day);
  week.days[dow] = week.days[dow].filter((x) => x.key !== key);
  const undoWeek = await saveWeek(week, today);
  const gone = await db.blocks.get(b.id);
  if (gone && !gone.deleted_at) await softDelete(b.id);
  return async () => { await undoWeek(); await restoreBlock(b.id); };
}

/* ---------- a day that isn't like the rest (Thanksgiving week, a sick day, a Saturday job) ---------- */

export type DayKind = "usual" | "work" | "handyman" | "off";
/** Which weekday's plan a kind of day borrows: his own if it already is one, else a typical one. */
function planFor(w: Week, day: string, kind: DayKind): WeekBlock[] {
  const own = blocksFor(w, day);
  const has = (k: string) => own.some((b) => b.key === k);
  if (kind === "usual") return own;
  if (kind === "work") return has("work") ? own : blocksFor(w, "2026-11-19"); // a Thursday: 8–4:30
  if (kind === "handyman") return has("handyman") ? own : blocksFor(w, "2026-11-24"); // a Tuesday
  return has("dayoff") ? own : blocksFor(w, "2026-11-23"); // a Monday
}
/** What kind of day it is now. */
export async function kindOf(day: string): Promise<DayKind> {
  return (((await db.settings.get("swap:" + day))?.value as { kind?: DayKind } | undefined)?.kind) ?? "usual";
}
/** Make a day a work day, a handyman day or a day off (or back to usual). Blocks he ticked or changed stay. */
export async function swapDay(day: string, kind: DayKind): Promise<Undo> {
  const w = await loadWeek();
  const row = (await db.settings.get("swap:" + day))?.value as { kind: DayKind; removed: string[] } | undefined;
  const all = (await db.blocks.where("day").equals(day).toArray()).filter((b) => b.source_type === "week");
  const untouched = async (b: Block) => b.status === "open" && !(await db.steps.where("block_id").equals(b.id).toArray()).some((x) => x.done_at && !x.deleted_at);
  const removed: string[] = [], restored: string[] = [], added: string[] = [];
  // Whatever an earlier swap put in goes (if untouched); what it took off comes back.
  for (const b of all) if (!b.deleted_at && (b.source_id || "").includes("~") && (await untouched(b))) { await softDelete(b.id); removed.push(b.id); }
  for (const id of row?.removed ?? []) { await restoreBlock(id); restored.push(id); }
  let tookOff: string[] = [];
  if (kind !== "usual") {
    // Take the usual plan off (only what he hasn't touched), put the other kind of day in.
    for (const b of all) if (!b.deleted_at && !(b.source_id || "").includes("~") && (await untouched(b))) { await softDelete(b.id); tookOff.push(b.id); }
    const kept = new Set(all.filter((b) => !b.deleted_at && !tookOff.includes(b.id) && !removed.includes(b.id)).map((b) => weekKeyOf(b)));
    for (const wb of planFor(w, day, kind)) {
      if (wb.gym || kept.has(wb.key)) continue; // the workout comes from Body; a block he's already into stays as the one
      const sid = `${weekSourceId(day, wb.key)}~${kind}`;
      const old = all.find((b) => b.source_id === sid);
      if (old) { if (old.deleted_at) { await restoreBlock(old.id); added.push(old.id); } continue; }
      const { id } = await addBlock({ day, start: wb.start, end: wb.end, kind: wb.kind, icon: wb.icon, title: wb.title, steps: wb.steps ?? [], source_type: "week", source_id: sid });
      added.push(id);
    }
  } else tookOff = [];
  await setSetting("swap:" + day, kind === "usual" ? null : { kind, removed: tookOff });
  return async () => {
    for (const id of [...added, ...tookOff]) await (added.includes(id) ? softDelete(id) : restoreBlock(id));
    for (const id of restored) await softDelete(id);
    for (const id of removed) await restoreBlock(id);
    await setSetting("swap:" + day, row ?? null);
  };
}

/** Back to the week he described (Nov 19). */
export async function resetWeek(today: string): Promise<Undo> {
  return saveWeek(defaultWeek(), today);
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const lenOf = (b: WeekBlock) => Math.max(5, toMin(b.end) - toMin(b.start));
function addMinutes(hhmm: string, m: number): string {
  const t = Math.max(0, Math.min(toMin(hhmm) + m, 23 * 60 + 59));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/* ---------- the morning buzz's words ---------- */

const short = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const h12 = ((h + 11) % 12) + 1; return m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`; };

/** "Gym, then work 8–4:30" — the day's shape in a few words, for the morning buzz. */
export function dayShape(w: Week, day: string, workout: { title: string; start: string } | null): { title: string; body: string; at: string } {
  const list = blocksFor(w, day).filter((b) => !b.gym || workout);
  const first = list[0];
  const job = list.find((b) => b.key === "work");
  const hm = list.find((b) => b.key === "handyman");
  const off = list.find((b) => b.key === "dayoff");
  const parts: string[] = [];
  if (workout) parts.push(`${workout.title} at ${short(workout.start)}`);
  if (job) parts.push(`work ${short(job.start)}–${short(job.end)}`);
  if (hm) parts.push("handyman jobs");
  if (off) parts.push("day off");
  const st = list.find((b) => b.key === "study");
  if (st) parts.push(`study ${short(st.start)}`);
  const lead = parts.length ? parts.join(" · ") : "an open day";
  const title = lead.charAt(0).toUpperCase() + lead.slice(1);
  const firstStep = first?.steps?.[0]?.label;
  return { title, body: first ? `First: ${first.title}${firstStep ? ` — ${firstStep.toLowerCase()}` : ""}.` : "Nothing planned. Rest well.", at: first?.start ?? "06:00" };
}
