/* ✓ on a proposal. The phone is the main copy, so the phone does the change, then marks the
   proposal applied. Only Google changes (calendar_book) wait for Claude's applier.
   Every ✓ comes back with an Undo that puts things the way they were. */
import { db, nowISO, type Kind, type Proposal } from "./db";
import { cut } from "./text";
import { addBlock, restoreBlock, setSentence, softDelete, MAX_STEPS, type StepInput, type Undo } from "./river";
import { decide } from "./proposals";
import { today } from "./time";
import * as H from "../head/store";
import type { Task } from "../head/types";
import { fitApi } from "../body/host";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]).filter((x) => x && typeof x === "object") : []);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: Kind[] = ["body", "head", "life", "money"];

/** Which proposals the phone applies itself. */
export const LOCAL_KINDS = new Set(["hello", "day_plan", "task", "ramble_split", "rollover", "recap", "grocery", "makeup", "workout_swap", "weekly_review"]);

function steps(v: unknown): StepInput[] {
  const s = arr(v).map((x) => ({ label: (str(x.label) ?? "").split(/\s+/).slice(0, 8).join(" "), value: str(x.value) })).filter((x) => x.label);
  return s.slice(0, MAX_STEPS);
}

async function areaIdByName(name: string | null): Promise<string | null> {
  if (!name) return null;
  const a = (await db.areas.toArray()).find((x) => x.name.toLowerCase() === name.toLowerCase() || x.id === name);
  return a?.id ?? null;
}

async function makeTask(x: Json): Promise<Task | null> {
  const title = str(x.title);
  if (!title) return null;
  const link = str(x.link);
  const notes = [str(x.notes), link ? `📧 ${link}` : null].filter(Boolean).join("\n");
  const when = str(x.when), due = str(x.due);
  return H.createTask({
    title, notes,
    when: when && /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : null,
    due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    est: num(x.est), areaId: await areaIdByName(str(x.area)),
  } as Partial<Task>);
}

/** Do what the proposal says. Returns how to undo it. */
export async function applyLocal(p: Proposal): Promise<Undo> {
  const P = (p.payload || {}) as Json;
  const day = str(P.day) ?? p.day_key ?? today();
  switch (p.kind) {
    case "hello":
      return async () => {};

    case "day_plan": {
      // Replaces the day's River: open blocks go to Trash, done and skipped ones stay.
      const before = (await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at && b.status === "open");
      const oldSentence = (await db.days.get(day))?.sentence ?? null;
      for (const b of before) await softDelete(b.id);
      const added: string[] = [];
      for (const b of arr(P.blocks)) {
        const title = str(b.title), start = str(b.start);
        if (!title || !start || !HHMM.test(start)) continue;
        const end = str(b.end);
        const kind = (KINDS.includes(b.kind as Kind) ? b.kind : "life") as Kind;
        const st = str(b.source_type);
        const { id } = await addBlock({
          day, start, end: end && HHMM.test(end) ? end : null, kind, icon: str(b.icon) ?? undefined, title: cut(title, 60),
          steps: steps(b.steps),
          source_type: st === "task" || st === "workout" || st === "groceries" ? st : null, source_id: str(b.source_id),
        });
        added.push(id);
      }
      const sentence = str(P.sentence);
      if (sentence) await setSentence(day, cut(sentence, 90));
      return async () => {
        for (const id of added) await softDelete(id);
        for (const b of before) await restoreBlock(b.id);
        await setSentence(day, oldSentence);
      };
    }

    case "task": {
      const t = await makeTask(P);
      return async () => { if (t) await H.deleteTask(t.id); };
    }

    case "ramble_split": {
      const made: Task[] = [];
      for (const x of arr(P.tasks)) { const t = await makeTask(x); if (t) made.push(t); }
      return async () => { for (const t of made) await H.deleteTask(t.id); };
    }

    case "rollover": {
      const to = str(P.to) ?? day;
      const undos: Undo[] = [];
      for (const id of (Array.isArray(P.move) ? P.move : []) as string[]) {
        const t = await db.tasks.get(id);
        if (t && t.status === "open") undos.push(await H.updateTask(id, { when: to }, { history: "rolled over by Claude" }));
      }
      for (const id of (Array.isArray(P.someday) ? P.someday : []) as string[]) {
        const t = await db.tasks.get(id);
        if (t && t.status === "open") undos.push(await H.updateTask(id, { when: null, someday: true }, { history: "to Someday (kept getting pushed)" }));
      }
      return async () => { for (const u of undos.reverse()) await u(); };
    }

    case "recap": {
      const lines = (Array.isArray(P.lines) ? P.lines : []).map(String).filter(Boolean).slice(0, 3);
      const row = await db.days.get(day);
      const old = row?.recap ?? null;
      const t = nowISO();
      await db.days.put({ ...(row ?? { day, sentence: null, created_at: t, deleted_at: null }), recap: lines, updated_at: t });
      return async () => { const r = await db.days.get(day); if (r) await db.days.put({ ...r, recap: old, updated_at: nowISO() }); };
    }

    case "grocery": {
      const area = (await db.areas.toArray()).find((a) => a.listMode === "groceries" && !a.archived);
      if (!area) throw new Error("Head has no grocery list yet");
      const have = new Set((await db.tasks.where("areaId").equals(area.id).toArray()).filter((t) => t.status === "open").map((t) => t.title.toLowerCase().split(" · ")[0]));
      const made: string[] = [];
      for (const it of arr(P.items)) {
        const name = str(it.name); if (!name || have.has(name.toLowerCase())) continue;
        const amt = str(it.amt);
        const t = await H.addGrocery(amt ? `${name} · ${amt}` : name, area.id);
        if (t) { made.push(t.id); have.add(name.toLowerCase()); }
      }
      return async () => { for (const id of made) await H.deleteTask(id); };
    }

    case "makeup":
    case "workout_swap": {
      const api = fitApi();
      if (!api) throw new Error("Open the Body tab once, then try again");
      const prev = p.kind === "makeup" ? api.makeup(str(P.missed) ?? str(P.date) ?? day) : api.setWorkout(str(P.date) ?? day, str(P.workout));
      return async () => { fitApi()?.restoreOverrides(prev); };
    }

    case "weekly_review": {
      const prompts = (Array.isArray(P.prompts) ? P.prompts : []).map(String).filter(Boolean);
      const start = str(P.start);
      const { id } = await addBlock({
        day, start: start && HHMM.test(start) ? start : "18:00", end: null, kind: "head", icon: "🗓", title: "Weekly review",
        steps: (prompts.length ? prompts : ["Clear the inbox", "Look at next week", "Pick 3 wins"]).slice(0, MAX_STEPS).map((label) => ({ label })),
      });
      return async () => { await softDelete(id); };
    }
  }
  throw new Error("Nest doesn't know how to do “" + p.kind + "” yet");
}

/** ✓: do it here (or leave it for Claude's applier when it needs Google), then record the decision. */
/** Returned when a ✓/✕ was already handled (a double tap, or a second phone): nothing to undo, nothing to say. */
export const ALREADY: Undo = async () => {};
const inFlight = new Set<string>();

/** One decision per card: a second tap while the first is still working, or on a card that's no longer pending, does nothing. */
async function once(p: Proposal, run: () => Promise<Undo>): Promise<Undo> {
  if (inFlight.has(p.id)) return ALREADY;
  inFlight.add(p.id);
  try {
    const cur = await db.proposals.get(p.id);
    if (cur && cur.status !== "pending") return ALREADY;
    return await run();
  } finally {
    inFlight.delete(p.id);
  }
}

export async function approve(p: Proposal): Promise<Undo> {
  return once(p, async () => {
    if (p.needs_google || !LOCAL_KINDS.has(p.kind)) return decide(p.id, "approved");
    const undoChange = await applyLocal(p);
    const undoStatus = await decide(p.id, "applied");
    return async () => { await undoChange(); await undoStatus(); };
  });
}

export async function decline(p: Proposal): Promise<Undo> {
  return once(p, () => decide(p.id, "declined"));
}
