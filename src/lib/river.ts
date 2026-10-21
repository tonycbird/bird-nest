import { db, nowISO, uid, type Block, type Kind, type Step } from "./db";
import { addDays } from "./time";

/* The River: a day's blocks, each with numbered steps.
   Every action returns an undo function, so the UI can offer Undo for 10 seconds. */

export type Undo = () => Promise<void>;

/* Icons are Nest icon names (src/ui/icons.ts). Older blocks may still hold an emoji; the UI maps those. */
export const KIND_ICON: Record<Kind, string> = { body: "lift", head: "head", life: "home", money: "coin" };
export const MAX_STEPS = 7;

export interface StepInput { label: string; value?: string | null; done?: boolean; }
export interface BlockInput {
  day: string; start: string; end?: string | null; kind: Kind; title: string; icon?: string; steps: StepInput[];
  source_type?: "task" | "groceries" | "workout" | null; source_id?: string | null;
}

/* ---------- reading ---------- */

export interface RiverBlock extends Block { steps: Step[]; doneCount: number; }

export async function loadDay(day: string): Promise<RiverBlock[]> {
  const blocks = (await db.blocks.where("day").equals(day).toArray())
    .filter((b) => !b.deleted_at)
    .sort((a, b) => a.start.localeCompare(b.start) || a.created_at.localeCompare(b.created_at));
  const ids = blocks.map((b) => b.id);
  const steps = ids.length ? await db.steps.where("block_id").anyOf(ids).toArray() : [];
  return blocks.map((b) => {
    const s = steps.filter((x) => x.block_id === b.id && !x.deleted_at).sort((x, y) => x.n - y.n);
    return { ...b, steps: s, doneCount: s.filter((x) => x.done_at).length };
  });
}

/** The block that is "now": the first one, by time, that isn't done or skipped. */
export function nowBlock(blocks: RiverBlock[]): RiverBlock | null {
  return blocks.find((b) => b.status === "open") ?? null;
}

/** The step that is "now" inside a block: the first one not done. */
export function nowStep(b: RiverBlock): Step | null {
  return b.steps.find((s) => !s.done_at) ?? null;
}

/** "Next up: Legs · step 2 of 6" */
export function nextLine(blocks: RiverBlock[]): string {
  const b = nowBlock(blocks);
  if (!b) return blocks.length ? "All done today ✓" : "";
  if (!b.steps.length) return `Next up: ${b.title}`;
  return `Next up: ${b.title} · step ${Math.min(b.doneCount + 1, b.steps.length)} of ${b.steps.length}`;
}

/* ---------- snapshots for undo ---------- */

async function snapshot(blockId: string): Promise<Undo> {
  const block = await db.blocks.get(blockId);
  const steps = await db.steps.where("block_id").equals(blockId).toArray();
  return async () => {
    await db.transaction("rw", db.blocks, db.steps, async () => {
      // Put everything back as it was, with a fresh updated_at so sync sees the change.
      const t = nowISO();
      const current = await db.steps.where("block_id").equals(blockId).toArray();
      const keep = new Set(steps.map((s) => s.id));
      for (const s of current) if (!keep.has(s.id)) await db.steps.update(s.id, { deleted_at: t, updated_at: t });
      if (block) await db.blocks.put({ ...block, updated_at: t });
      await db.steps.bulkPut(steps.map((s) => ({ ...s, updated_at: t })));
    });
    if (onBlockRestored) await onBlockRestored(blockId);
  };
}

/* ---------- writing ---------- */

function cleanSteps(steps: StepInput[]): StepInput[] {
  return steps
    .map((s) => ({ label: s.label.trim(), value: s.value?.trim() || null, done: !!s.done }))
    .filter((s) => s.label)
    .slice(0, MAX_STEPS);
}

export async function addBlock(input: BlockInput): Promise<{ id: string; undo: Undo }> {
  const t = nowISO();
  const id = uid();
  const steps: Step[] = cleanSteps(input.steps).map((s, i) => ({
    id: uid(), block_id: id, n: i + 1, label: s.label, value: s.value ?? null, done_at: s.done ? t : null,
    created_at: t, updated_at: t, deleted_at: null,
  }));
  const allDone = steps.length > 0 && steps.every((s) => s.done_at);
  const block: Block = {
    id, day: input.day, start: input.start, end: input.end ?? null, kind: input.kind,
    icon: input.icon || KIND_ICON[input.kind], title: input.title.trim(), status: allDone ? "done" : "open", done_at: allDone ? t : null,
    created_at: t, updated_at: t, deleted_at: null,
    source_type: input.source_type ?? null, source_id: input.source_id ?? null,
  };
  await db.transaction("rw", db.blocks, db.steps, async () => {
    await db.blocks.add(block);
    if (steps.length) await db.steps.bulkAdd(steps);
  });
  return { id, undo: async () => { await softDelete(id); } };
}

/** Edit title/time/kind/steps. Steps keep their done state when the label is unchanged. */
export async function updateBlock(id: string, input: Omit<BlockInput, "day"> & { day?: string }): Promise<Undo> {
  const undo = await snapshot(id);
  const t = nowISO();
  await db.transaction("rw", db.blocks, db.steps, async () => {
    const old = (await db.steps.where("block_id").equals(id).toArray()).filter((s) => !s.deleted_at).sort((a, b) => a.n - b.n);
    const wanted = cleanSteps(input.steps);
    const used = new Set<string>();
    const next: Step[] = wanted.map((w, i) => {
      const match = old.find((o) => !used.has(o.id) && o.label === w.label);
      if (match) { used.add(match.id); return { ...match, n: i + 1, value: w.value ?? null, updated_at: t }; }
      return { id: uid(), block_id: id, n: i + 1, label: w.label, value: w.value ?? null, done_at: null, created_at: t, updated_at: t, deleted_at: null };
    });
    for (const o of old) if (!used.has(o.id)) await db.steps.update(o.id, { deleted_at: t, updated_at: t });
    await db.steps.bulkPut(next);
    const allDone = next.length > 0 && next.every((s) => s.done_at);
    await db.blocks.update(id, {
      title: input.title.trim(), start: input.start, end: input.end ?? null, kind: input.kind,
      icon: input.icon || KIND_ICON[input.kind], ...(input.day ? { day: input.day } : {}),
      status: allDone ? "done" : "open", done_at: allDone ? t : null, updated_at: t,
    });
  });
  return undo;
}

/** Tick a step. When the last step is done, the block completes itself. */
export async function toggleStep(stepId: string): Promise<{ undo: Undo; blockDone: boolean }> {
  const step = await db.steps.get(stepId);
  if (!step) return { undo: async () => {}, blockDone: false };
  const undo = await snapshot(step.block_id);
  const t = nowISO();
  let blockDone = false;
  await db.transaction("rw", db.blocks, db.steps, async () => {
    await db.steps.update(stepId, { done_at: step.done_at ? null : t, updated_at: t });
    const all = (await db.steps.where("block_id").equals(step.block_id).toArray()).filter((s) => !s.deleted_at);
    blockDone = all.length > 0 && all.every((s) => s.done_at);
    const block = await db.blocks.get(step.block_id);
    if (block && block.status !== "skipped") {
      await db.blocks.update(step.block_id, { status: blockDone ? "done" : "open", done_at: blockDone ? t : null, updated_at: t });
    }
  });
  if (onStepToggled) {
    const b = await db.blocks.get(step.block_id);
    if (b) await onStepToggled(b, step.label, !step.done_at);
  }
  if (blockDone) await notifyBlockDone(step.block_id);
  return { undo, blockDone };
}

/** Mark a block with no steps (or all of it) done in one tap. */
export async function completeBlock(id: string): Promise<Undo> {
  const undo = await snapshot(id);
  const t = nowISO();
  await db.transaction("rw", db.blocks, db.steps, async () => {
    const steps = await db.steps.where("block_id").equals(id).toArray();
    for (const s of steps) if (!s.done_at && !s.deleted_at) await db.steps.update(s.id, { done_at: t, updated_at: t });
    await db.blocks.update(id, { status: "done", done_at: t, updated_at: t });
  });
  await notifyBlockDone(id);
  return undo;
}

/* A finished block can finish the thing it came from (a Head task). Head registers the handler. */
type DoneHandler = (block: Block) => Promise<void>;
let onBlockDone: DoneHandler | null = null;
let onBlockRestored: ((id: string) => Promise<void>) | null = null;
let onStepToggled: ((block: Block, label: string, done: boolean) => Promise<void>) | null = null;
export function setStepHandler(fn: typeof onStepToggled): void { onStepToggled = fn; }
export function setBlockDoneHandler(fn: DoneHandler | null, restored: ((id: string) => Promise<void>) | null = null): void {
  onBlockDone = fn;
  onBlockRestored = restored;
}
const doneListeners = new Set<DoneHandler>();
/** Extra listeners (Body) that hear about every finished block. */
export function onAnyBlockDone(fn: DoneHandler): () => void { doneListeners.add(fn); return () => { doneListeners.delete(fn); }; }
async function notifyBlockDone(id: string): Promise<void> {
  const b = await db.blocks.get(id);
  if (b && onBlockDone) await onBlockDone(b);
  if (b) for (const fn of doneListeners) { try { await fn(b); } catch { /* a listener never blocks the River */ } }
}

export async function skipBlock(id: string): Promise<Undo> {
  const undo = await snapshot(id);
  const b = await db.blocks.get(id);
  const t = nowISO();
  await db.blocks.update(id, { status: b?.status === "skipped" ? "open" : "skipped", updated_at: t });
  return undo;
}

/** Send to another day (tomorrow by default). Steps reset so the block starts fresh there. */
export async function moveBlock(id: string, toDay?: string): Promise<Undo> {
  const undo = await snapshot(id);
  const b = await db.blocks.get(id);
  if (!b) return undo;
  const t = nowISO();
  await db.transaction("rw", db.blocks, db.steps, async () => {
    await db.blocks.update(id, { day: toDay ?? addDays(b.day, 1), status: "open", done_at: null, updated_at: t });
    const steps = await db.steps.where("block_id").equals(id).toArray();
    for (const s of steps) if (s.done_at) await db.steps.update(s.id, { done_at: null, updated_at: t });
  });
  return undo;
}

export async function softDelete(id: string): Promise<Undo> {
  const undo = await snapshot(id);
  const t = nowISO();
  await db.blocks.update(id, { deleted_at: t, updated_at: t });
  return undo;
}

export async function restoreBlock(id: string): Promise<void> {
  await db.blocks.update(id, { deleted_at: null, updated_at: nowISO() });
}

/** Copy every block (fresh, unticked) from one day to another. */
export async function copyDay(from: string, to: string): Promise<Undo> {
  const src = await loadDay(from);
  const made: string[] = [];
  for (const b of src) {
    const { id } = await addBlock({
      day: to, start: b.start, end: b.end, kind: b.kind, icon: b.icon, title: b.title,
      steps: b.steps.map((s) => ({ label: s.label, value: s.value })),
    });
    made.push(id);
  }
  return async () => { for (const id of made) await softDelete(id); };
}

export async function trash(): Promise<Block[]> {
  return (await db.blocks.filter((b) => !!b.deleted_at).toArray())
    .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
}

/* ---------- the day's sentence ---------- */

export async function setSentence(day: string, sentence: string | null): Promise<void> {
  const t = nowISO();
  const old = await db.days.get(day);
  await db.days.put({ day, sentence: sentence?.trim() || null, created_at: old?.created_at ?? t, updated_at: t, deleted_at: null });
}

/** A warm default when Anthony hasn't written one: name the anchor of the day. */
export function defaultSentence(blocks: RiverBlock[]): string {
  if (!blocks.length) return "A quiet day. Add what matters.";
  const open = blocks.filter((b) => b.status === "open");
  if (!open.length) return "All done. Rest well.";
  // A workout anchors the day; otherwise name whatever is next.
  const first = open.find((b) => b.kind === "body") ?? open[0];
  const left = open.length - 1;
  return left > 0 ? `${first.title} first. ${left} more after.` : `${first.title}, then you're done.`;
}

/* ---------- sample day (from the concept page) ---------- */

export const SAMPLE: Omit<BlockInput, "day">[] = [
  { start: "05:00", end: "05:30", kind: "body", icon: "stretch", title: "Warm up + stretch", steps: [
    { label: "Water, lights on", value: "2 min" }, { label: "Easy bike", value: "5 min" },
    { label: "Hip flexors, each side", value: "2×1 min" }, { label: "Hamstring fold", value: "2×1 min" },
    { label: "Band pull-aparts", value: "2×15" }] },
  { start: "05:30", end: "06:30", kind: "body", icon: "lift", title: "Legs", steps: [
    { label: "Back squat", value: "4×5 · 245" }, { label: "Romanian deadlift", value: "3×8 · 185" },
    { label: "Leg press", value: "3×10" }, { label: "Walking lunge", value: "3×12" }, { label: "Calf raise", value: "4×15" }] },
  { start: "06:30", end: "06:45", kind: "body", icon: "stretch", title: "Cool-down stretch", steps: [
    { label: "Quad stretch, each side", value: "1 min" }, { label: "Pigeon pose, each side", value: "2 min" },
    { label: "Child's pose", value: "2 min" }] },
  { start: "07:15", end: "07:40", kind: "head", icon: "drive", title: "Commute", steps: [
    { label: "Play theology ch. 4 audio", value: "20 min" }, { label: "Voice-note one takeaway", value: "1 min" }] },
  { start: "17:30", end: "18:15", kind: "life", icon: "groceries", title: "Winco run", steps: [
    { label: "Chicken thighs, 5 lb", value: null }, { label: "Eggs, 5 dozen", value: null }, { label: "Rice, 10 lb", value: null },
    { label: "Greek yogurt", value: null }, { label: "Broccoli + bananas", value: null }, { label: "Oats + milk", value: null }] },
  { start: "20:00", end: "20:45", kind: "head", icon: "study", title: "Study", steps: [
    { label: "Read pp. 61–78", value: "25 min" }, { label: "Write 3 notes", value: "10 min" }, { label: "Flashcards", value: "10 min" }] },
  { start: "21:30", end: "21:40", kind: "head", icon: "sleep", title: "Wind down", steps: [
    { label: "Pack gym bag", value: "5 min" }, { label: "Phone on charger", value: "1 min" }, { label: "Tomorrow's top 3", value: "3 min" }] },
];

export async function loadSample(day: string): Promise<Undo> {
  const made: string[] = [];
  for (const b of SAMPLE) made.push((await addBlock({ ...b, day })).id);
  return async () => { for (const id of made) await softDelete(id); };
}
