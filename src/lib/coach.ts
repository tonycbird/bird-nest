/* Today as a coach: what's now, what's next, what's after that. By the clock, not by what's ticked:
   a drive or a work block that went by without a tap simply went by. The most specific block wins:
   Staff Chapel inside Work is "now" while it runs, then Work is again. */
import type { RiverBlock } from "./river";
import type { Task } from "../head/types";
import { minutes } from "./time";
import { taskIcon } from "../ui/colors";

export const startMin = (b: { start: string }) => minutes(b.start);
/** End in minutes; no end = 30 min; past midnight = +24h. */
export function endOf(b: { start: string; end: string | null }): number {
  const s = minutes(b.start);
  if (!b.end) return s + 30;
  const e = minutes(b.end);
  return e <= s ? e + 1440 : e;
}

export interface Moment {
  now: RiverBlock | null;          // the block running now
  free: { from: number | null; until: number | null } | null; // between blocks (from = null: before the day starts)
  next: RiverBlock | null;
  later: RiverBlock | null;
  over: boolean;                   // the day's last block has ended
}

const live = (b: RiverBlock) => b.status === "open";

export function moment(blocks: RiverBlock[], nowMin: number): Moment {
  const open = blocks.filter(live);
  const covering = open.filter((b) => startMin(b) <= nowMin && nowMin < endOf(b));
  // The one that started last; a tie goes to the shorter one.
  covering.sort((a, b) => startMin(b) - startMin(a) || (endOf(a) - startMin(a)) - (endOf(b) - startMin(b)));
  const now = covering[0] ?? null;
  const ahead = open.filter((b) => b !== now && startMin(b) > nowMin).sort((a, b) => startMin(a) - startMin(b) || endOf(b) - endOf(a));
  const next = ahead[0] ?? null;
  const later = ahead[1] ?? null;
  const all = blocks.filter((b) => b.status !== "skipped");
  const lastEnd = all.length ? Math.max(...all.map(endOf)) : null;
  // What's behind him: blocks that ended, and ones he finished early (free from the moment he did).
  const ended = all.filter((b) => endOf(b) <= nowMin || (b.status === "done" && startMin(b) <= nowMin));
  const free = now ? null : { from: ended.length ? Math.max(...ended.map((b) => Math.min(endOf(b), nowMin))) : null, until: next ? startMin(next) : null };
  return { now, free, next, later, over: !now && !next && lastEnd != null && nowMin >= lastEnd };
}

/** "25m", "1h", "1h 20m" */
export function dur(m: number): string {
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

/* ---------- tasks that fit the moment ---------- */

type Fit = "drive" | "handyman" | "study" | "free" | null;
/** What kind of tasks a block has room for. Family time, work, sleep and the gym have none. */
export function fitOf(b: { icon: string; title: string } | null): Fit {
  if (!b) return "free";
  if (b.icon === "drive") return "drive";
  if (b.icon === "job" || /handyman/i.test(b.title)) return "handyman";
  if (b.icon === "study") return "study";
  if (b.icon === "weekend" || /day off/i.test(b.title)) return "free";
  return null;
}

/** Up to `max` open tasks for this moment: calls on the drive, jobs on handyman day, study at study time,
    anything in free time. Earliest due first, then the order Head keeps. */
export function tasksThatFit(fit: Fit, tasks: Task[], areaName: (t: Task) => string, max = 3): Task[] {
  if (!fit) return [];
  const ok = (t: Task): boolean => {
    const icon = taskIcon(t.title);
    if (fit === "drive") return icon === "call";
    if (fit === "study") return icon === "study";
    if (fit === "handyman") return icon === "job" || icon === "doc" || /handyman|business|job/i.test(areaName(t));
    return !t.grocery; // free time: anything but groceries (they have their own list)
  };
  return tasks.filter(ok).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, max);
}
