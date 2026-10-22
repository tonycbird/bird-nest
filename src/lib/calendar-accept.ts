import { db, type CalEvent } from "./db";
import { addBlock, type Undo } from "./river";
import { minutes } from "./time";
import { cut } from "./text";
import * as H from "../head/store";
import { taskIcon } from "../ui/colors";

/* Calendar items Claude copies in are only suggestions: most of them aren't Anthony's to do
   (someone's sabbatical, a day off, an on-call slot). They sit on Today as small faded lines until
   he holds one down to accept it. Then it becomes his own: a River block at its time, or, for an
   all-day item, a task that day. Taking the block off the River (or deleting the task) un-accepts it. */

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Make a calendar item Anthony's own. Returns Undo. */
export async function acceptEvent(e: CalEvent): Promise<Undo> {
  const title = e.title.trim() || "Calendar";
  if (e.all_day || !e.start) {
    const t = await H.createTask({ title, when: e.day, notes: "From your calendar." });
    await H.updateTask(t.id, { calId: e.id });
    return async () => { await H.deleteTask(t.id); };
  }
  const s = minutes(e.start);
  const end = e.end && minutes(e.end) > s ? e.end : hhmm(s + 30);
  const { undo } = await addBlock({
    day: e.day, start: e.start, end, kind: "life", icon: taskIcon(title, "calendar"), title: cut(title, 48),
    steps: [], source_type: "calendar", source_id: e.id,
  });
  return undo;
}

/** Which of a day's calendar items are already accepted (a live block, or a task that came from it). */
export async function acceptedOn(day: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const b of await db.blocks.where("day").equals(day).toArray()) if (!b.deleted_at && b.source_type === "calendar" && b.source_id) out.add(b.source_id);
  for (const t of await db.tasks.where("when").equals(day).toArray()) { const id = (t as { calId?: string | null }).calId; if (id) out.add(id); }
  return out;
}
