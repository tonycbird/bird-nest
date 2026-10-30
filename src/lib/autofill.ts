/* Phase 7 · the day fills itself. No more approving Claude's ideas one by one:
   - Claude's useful finds go straight in: a task from mail lands in the Head Inbox, groceries on the list.
     The rest (a whole-day plan, recaps, gym bookings…) is set aside quietly; Nest builds the day itself.
   - On a gym day the workout goes on the River by itself (warm-up, lifts, cool-down), today and tomorrow.
   - Events from the calendars he picks become River blocks by themselves.
   Each lands once: anything he takes off the River stays off (its deleted copy remembers). */
import { liveQuery } from "dexie";
import { db, type CalEvent, type Proposal } from "./db";
import { approve, decline } from "./apply";
import { acceptEvent } from "./calendar-accept";
import { addDays, today } from "./time";
import { fitApi, fitState } from "../body/host";
import { putPlanOnRiver } from "../body/river-body";

/** What goes in by itself. Everything else Claude suggests is set aside. */
export const AUTO_APPLY = new Set(["task", "grocery", "ramble_split"]);

export interface DayPrefs { workout: boolean; calendars: string[] | null }
export const DAY_DEFAULTS: DayPrefs = { workout: true, calendars: null };
export async function dayPrefs(): Promise<DayPrefs> {
  return { ...DAY_DEFAULTS, ...(((await db.settings.get("day"))?.value as Partial<DayPrefs> | undefined) ?? {}) };
}

/** The calendars that flow in by themselves: his pick, else the ones that look like his own. */
export function pickedCalendars(prefs: DayPrefs, names: string[]): Set<string> {
  if (prefs.calendars) return new Set(prefs.calendars);
  return new Set(names.filter((n) => /anthony|tony|bird/i.test(n)));
}
export const calendarNames = (events: CalEvent[]) => [...new Set(events.map((e) => e.calendar).filter((n): n is string => !!n))].sort();

let settling = false;
/** Claude's pending suggestions: the useful ones applied, the rest set aside. Quiet either way. */
export async function settleProposals(): Promise<number> {
  if (settling) return 0;
  settling = true;
  let n = 0;
  try {
    const pending: Proposal[] = await db.proposals.where("status").equals("pending").toArray();
    for (const p of pending) {
      try {
        if (!p.needs_google && AUTO_APPLY.has(p.kind)) { await approve(p); n++; }
        else await decline(p);
      } catch { await decline(p).catch(() => undefined); } // can't be done here (no grocery list yet…): set aside, never stuck
    }
  } finally { settling = false; }
  return n;
}

/** Has this ever been placed on that day (even if he took it off since)? */
async function placedBefore(day: string, type: "workout" | "calendar", id?: string): Promise<boolean> {
  return (await db.blocks.where("day").equals(day).toArray()).some((b) => b.source_type === type && (id == null || b.source_id === id));
}

/** A gym day's workout, on the River by itself. Rest days stay clear. */
export async function fillWorkout(day: string): Promise<number> {
  if (!(await dayPrefs()).workout) return 0;
  const api = fitApi();
  if (!api || !fitState.get().ready) return 0;
  if (await placedBefore(day, "workout")) return 0;
  let plan;
  try { plan = api.plan(day); } catch { return 0; }
  if (!plan || !plan.workout || !plan.blocks.some((b) => b.steps.length)) return 0;
  await putPlanOnRiver(plan);
  return plan.blocks.length;
}

/** His own calendar's timed events, on the River by themselves. */
export async function fillCalendar(day: string): Promise<number> {
  const events = await db.calendar.where("day").equals(day).toArray();
  if (!events.length) return 0;
  const picked = pickedCalendars(await dayPrefs(), calendarNames(await db.calendar.toArray()));
  let n = 0;
  for (const e of events) {
    if (e.all_day || !e.start || !e.calendar || !picked.has(e.calendar)) continue;
    if (await placedBefore(day, "calendar", e.id)) continue;
    await acceptEvent(e);
    n++;
  }
  return n;
}

let running = false, again = false;
export async function fillDays(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      const t = today();
      for (const day of [t, addDays(t, 1)]) { await fillWorkout(day).catch(() => 0); await fillCalendar(day).catch(() => 0); }
    } while (again);
  } finally { running = false; }
}

let started = false;
export function startAutofill(): void {
  if (started) return;
  started = true;
  let t = 0;
  const soon = () => { window.clearTimeout(t); t = window.setTimeout(() => void fillDays(), 400); };
  let wasReady = false;
  fitState.subscribe(() => { const r = fitState.get().ready; if (r && !wasReady) soon(); wasReady = r; });
  liveQuery(() => db.calendar.count()).subscribe({ next: soon, error: () => undefined });
  liveQuery(() => db.settings.get("day")).subscribe({ next: soon, error: () => undefined });
  liveQuery(() => db.proposals.where("status").equals("pending").count()).subscribe({ next: (n) => { if (n) void settleProposals(); }, error: () => undefined });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") soon(); });
  soon();
}
