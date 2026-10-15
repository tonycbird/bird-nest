/* Body ⇄ River. A gym day becomes three blocks: 🔥 Warm-up, 🏋 the workout (one step per lift,
   with today's target), 🧘 Cool-down. Rest days get the stretch session. Logging in Body ticks
   the matching River steps; ticking on the River never erases a log. */
import { db, nowISO, type Block } from "../lib/db";
import { addBlock, MAX_STEPS, type StepInput, type Undo } from "../lib/river";
import { nextFreeSlot } from "../head/river-bridge";
import type { FitPlan, FitPlanBlock, FitStep } from "./host";

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (m: number) => { const x = Math.max(0, Math.min(Math.round(m), 23 * 60 + 45)); return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
export const sourceId = (date: string, key: string) => `${date}|${key}`;

/** At most 7 steps: anything past the sixth folds into one last step. */
export function capSteps(steps: FitStep[]): FitStep[] {
  if (steps.length <= MAX_STEPS) return steps;
  const head = steps.slice(0, MAX_STEPS - 1), rest = steps.slice(MAX_STEPS - 1);
  return [...head, { label: rest.map((s) => s.label).join(" + "), value: `${rest.length} more`, done: rest.every((s) => s.done) }];
}

export async function workoutBlocks(day: string): Promise<Block[]> {
  return (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at && b.source_type === "workout");
}

/** Which plan blocks are not on the River yet. */
export async function missingFromRiver(plan: FitPlan): Promise<FitPlanBlock[]> {
  const on = new Set((await workoutBlocks(plan.date)).map((b) => b.source_id));
  return plan.blocks.filter((b) => !on.has(sourceId(plan.date, b.key)) && b.steps.length > 0);
}

/** Puts the day's Body plan on the River. Blocks already there are left alone. */
export async function putPlanOnRiver(plan: FitPlan): Promise<Undo> {
  const todo = await missingFromRiver(plan);
  const undos: Undo[] = [];
  for (const b of todo) {
    const start = b.start != null ? b.start : await nextFreeSlot(plan.date);
    const steps: StepInput[] = capSteps(b.steps).map((s) => ({ label: s.label, value: s.value || null, done: s.done }));
    const { undo } = await addBlock({
      day: plan.date, start: hhmm(start), end: b.minutes ? hhmm(start + b.minutes) : null, kind: "body", icon: b.icon, title: b.title,
      steps, source_type: "workout", source_id: sourceId(plan.date, b.key),
    });
    undos.push(undo);
  }
  return async () => { for (const u of undos.reverse()) await u(); };
}

/** Logged in Body → ticked on the River. Labels follow swaps while nothing is ticked yet. */
export async function syncPlanToRiver(plan: FitPlan): Promise<number> {
  let changed = 0;
  const t = nowISO();
  const blocks = await workoutBlocks(plan.date);
  for (const blk of blocks) {
    const key = (blk.source_id || "").split("|")[1];
    const pb = plan.blocks.find((b) => b.key === key);
    if (!pb) continue;
    const want = capSteps(pb.steps);
    const steps = (await db.steps.where("block_id").equals(blk.id).toArray()).filter((s) => !s.deleted_at).sort((a, b) => a.n - b.n);
    await db.transaction("rw", db.blocks, db.steps, async () => {
      const untouched = steps.every((s) => !s.done_at);
      if (untouched && steps.length === want.length) {
        for (let i = 0; i < steps.length; i++) {
          if (steps[i].label !== want[i].label || (steps[i].value ?? "") !== want[i].value) {
            await db.steps.update(steps[i].id, { label: want[i].label, value: want[i].value || null, updated_at: t });
            changed++;
          }
        }
      }
      for (let i = 0; i < Math.min(steps.length, want.length); i++) {
        if (want[i].done && !steps[i].done_at) { await db.steps.update(steps[i].id, { done_at: t, updated_at: t }); steps[i].done_at = t; changed++; }
      }
      const allDone = steps.length > 0 && steps.every((s) => s.done_at);
      if ((allDone || pb.done) && blk.status === "open") {
        if (pb.done) for (const s of steps) if (!s.done_at) await db.steps.update(s.id, { done_at: t, updated_at: t });
        await db.blocks.update(blk.id, { status: "done", done_at: t, updated_at: t });
        changed++;
      }
    });
  }
  return changed;
}
