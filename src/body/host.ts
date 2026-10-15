/* Nest's side of the Body frame. The old Fitness code asks for a "db" and "downloads";
   these answer with Nest's own database (the `fit` table) and the iPhone share sheet. */
import { db, nowISO, type FitDoc } from "../lib/db";
import { saveBlob } from "../lib/backup";
import * as H from "../head/store";
import { createStore } from "../head/useHead";

export const LS_PREFIX = "birdfit:v1:";
const DOC_KEYS = ["settings", "program", "body", "meals", "notes"];

/* ---------- storage, shaped like the old artifact database ---------- */

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function fitPut(path: string, value: Record<string, unknown>): Promise<void> {
  const v = plain(value);
  await db.fit.put({ key: path, value: v, _u: Number(v._u) || 0, updated_at: nowISO() });
}

export const fitDb = {
  collection(name: string) {
    return {
      async get() {
        const rows = await db.fit.where("key").startsWith(name + "/").toArray();
        return { docs: rows.map((r) => ({ id: r.key.slice(name.length + 1), data: () => plain(r.value) })) };
      },
      // Only this phone writes, so there is nothing to listen for yet. Phase 4 sync can call back here.
      onSnapshot() { return () => {}; },
    };
  },
  doc(path: string) {
    return {
      set: (value: Record<string, unknown>) => fitPut(path, value),
      delete: async () => { await db.fit.delete(path); },
    };
  },
};

const downloads = {
  async save({ filename, data }: { filename: string; data: string | Blob }) {
    const blob = typeof data === "string" ? new Blob([data], { type: filename.endsWith(".json") ? "application/json" : "text/plain" }) : data;
    saveBlob(blob, filename);
  },
};

/* ---------- live state the rest of Nest can watch ---------- */

export interface FitStep { label: string; value: string; done: boolean }
export interface FitPlanBlock { key: string; icon: string; title: string; start: number | null; minutes: number; steps: FitStep[]; wid?: string; done?: boolean }
export interface FitPlan { date: string; workout: string | null; blocks: FitPlanBlock[] }
export interface FitTimer { on: boolean; end: number; label: string; doneAt: number }
export interface FitApi {
  plan(date?: string): FitPlan;
  tab(): string;
  goTab(t: string): void;
  openWorkout(date: string, wid: string): void;
  openStretch(date: string, k: string): void;
  openToday(date?: string): void;
  checkIn(): void;
  refresh(): void;
  markWarm(date: string): void;
  timerAdd(s: number): void;
  timerStop(): void;
  exportAll(): unknown;
}

export const fitState = createStore({ ready: false, ver: 0, tab: "workout", depth: 1, timer: null as FitTimer | null, error: "" });
type FitStateT = ReturnType<typeof fitState.get>;
const patch = (p: Partial<FitStateT>) => fitState.set((s) => ({ ...s, ...p }));
let frameWin: (Window & { __fit?: FitApi }) | null = null;
export const fitApi = (): FitApi | null => frameWin?.__fit ?? null;
export function setFrame(w: Window | null) { frameWin = w as typeof frameWin; if (!w) patch({ ready: false }); }

let changedT = 0;
const listeners = new Set<() => void>();
/** Called (debounced) after any Fitness save, so the River can catch up. */
export function onFitChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/* ---------- groceries: one list, in Head ---------- */

const norm = (s: string) => s.toLowerCase().split(" · ")[0].replace(/\s+/g, " ").trim();

/** Adds Fitness grocery items to Head's grocery list, skipping ones already there. null = no grocery list in Head. */
export async function addGroceries(items: { name: string; amt?: string }[]): Promise<number | null> {
  const area = (await db.areas.toArray()).find((a) => a.listMode === "groceries" && !a.archived);
  if (!area) return null;
  const have = new Set((await db.tasks.where("areaId").equals(area.id).toArray()).filter((t) => t.status === "open").map((t) => norm(t.title)));
  let n = 0;
  for (const it of items) {
    if (have.has(norm(it.name))) continue;
    await H.addGrocery(it.amt ? `${it.name} · ${it.amt}` : it.name, area.id);
    have.add(norm(it.name));
    n++;
  }
  return n;
}

/* ---------- import a Bird Fitness backup ---------- */

export interface FitnessBackup { app: "bird-fitness"; v?: number; docs: Record<string, Record<string, unknown>>; logs?: Record<string, Record<string, unknown>> }

export function readFitnessBackup(x: unknown): FitnessBackup {
  const b = x as FitnessBackup;
  if (!b || b.app !== "bird-fitness" || !b.docs || typeof b.docs !== "object") throw new Error("That file isn't a Bird Fitness backup.");
  return b;
}

/** Replaces all Body data with the backup (the old app's import did the same). Returns counts. */
export async function importFitness(b: FitnessBackup): Promise<{ sessions: number; months: number }> {
  const now = Date.now();
  let sessions = 0;
  await db.transaction("rw", db.fit, async () => {
    await db.fit.clear();
    for (const k of DOC_KEYS) if (b.docs[k]) await fitPut("fit/" + k, { ...b.docs[k], _u: now });
    for (const [mk, m] of Object.entries(b.logs || {})) {
      sessions += Object.keys((m as { sessions?: object }).sessions || {}).length;
      await fitPut("logs/" + mk, { ...m, _u: now });
    }
  });
  await resetFitCache();
  return { sessions, months: Object.keys(b.logs || {}).length };
}

export async function fitCounts(): Promise<{ docs: number; months: number }> {
  const rows: FitDoc[] = await db.fit.toArray();
  return { docs: rows.filter((r) => r.key.startsWith("fit/")).length, months: rows.filter((r) => r.key.startsWith("logs/")).length };
}

/** The Fitness screens keep a quick copy in localStorage. After a restore or import, drop it and reload. */
export async function resetFitCache(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k); }
  } catch { /* storage blocked */ }
  try { frameWin?.location.reload(); } catch { /* no frame yet */ }
}

/* ---------- the object the frame finds on window.parent ---------- */

export function installFitHost() {
  (window as unknown as { __nestFit: unknown }).__nestFit = {
    db: fitDb,
    downloads,
    addGroceries,
    ready: () => patch({ ready: true, error: "", ver: fitState.get().ver + 1 }),
    error: (msg: string) => { if (!fitState.get().ready) patch({ error: String(msg).slice(0, 200) }); },
    changed: () => {
      window.clearTimeout(changedT);
      changedT = window.setTimeout(() => { patch({ ver: fitState.get().ver + 1 }); listeners.forEach((f) => f()); }, 400);
    },
    tab: (tab: string, depth: number) => { const s = fitState.get(); if (s.tab !== tab || s.depth !== depth) patch({ tab, depth }); },
    timer: (t: FitTimer) => patch({ timer: t.on || t.doneAt ? { ...t } : null }),
  };
}
