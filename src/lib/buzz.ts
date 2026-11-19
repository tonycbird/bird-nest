/* What buzzes, and when. Three things, picked by Anthony:
   1. Morning (Nov 19) — once, when his day starts: the day's shape and the first step.
   2. Rest timer done (Body) — so the phone can be locked between sets.
   3. Shutdown — once each evening at his week's shutdown time (Head's time if the week is off),
      skipping off days, days with no shutdown (Saturday: he works till 8) and nights already shut down. */
import { liveQuery } from "dexie";
import * as C from "../head/core/clearhead.js";
import { db } from "./db";
import { HEAD_DEFAULTS } from "../head/store";
import { fitApi, fitState } from "../body/host";
import { cancelBuzz, onPushPrefs, pushPrefs, refreshPush, scheduleBuzz, type Buzz } from "./push";
import { blocksFor, dayShape, loadWeek, type Week } from "./week";

interface ShutdownSettings { shutdownTime?: string; offDays?: number[]; lastShutdown?: string | null }

/** The next week of shutdown buzzes (pure, for tests). With his week, each day's own shutdown time. */
export function shutdownBuzzes(s: ShutdownSettings, today: string, now: number, days = 7, week?: Week | null): Buzz[] {
  const out: Buzz[] = [];
  const fallback = /^\d{2}:\d{2}$/.test(s.shutdownTime || "") ? s.shutdownTime! : "19:00";
  for (let i = 0; i < days; i++) {
    const d = C.addDays(today, i) as string;
    if (C.isOffDay(s, d)) continue;
    if (i === 0 && s.lastShutdown === today) continue;
    const time = week ? blocksFor(week, d).find((b) => b.key === "shutdown")?.start : fallback;
    if (!time) continue;
    const at = new Date(`${d}T${time}:00`).getTime();
    if (!(at > now + 60_000)) continue;
    out.push({ id: `shutdown:${d}`, at, title: "Shutdown", body: "Close out today, then rest.", tag: "shutdown", url: "/?open=shutdown", ttl: 1800 });
  }
  return out;
}

/** The next week of morning buzzes: when the day starts, what it holds, and the first step (pure, for tests). */
export function morningBuzzes(week: Week, today: string, now: number, workoutOf: (day: string) => { title: string; start: string } | null, days = 7): Buzz[] {
  const out: Buzz[] = [];
  for (let i = 0; i < days; i++) {
    const d = C.addDays(today, i) as string;
    if (!blocksFor(week, d).length) continue;
    const shape = dayShape(week, d, workoutOf(d));
    const at = new Date(`${d}T${shape.at}:00`).getTime();
    if (!(at > now + 60_000)) continue;
    out.push({ id: `morning:${d}`, at, title: shape.title, body: shape.body, tag: "morning", url: "/?open=today", ttl: 3600 });
  }
  return out;
}

/** The rest buzz for a running Body timer, or null (Hold timers and short ones don't buzz). */
export function restBuzz(t: { on: boolean; end: number; label: string } | null, now: number): Buzz | null {
  if (!t || !t.on || t.label === "Hold" || t.end - now < 12_000) return null;
  const label = t.label || "Rest";
  return { id: "rest", at: t.end, title: `${label} done — go`, body: label === "Rest" ? "Time for your next set." : undefined, tag: "rest", url: "/?open=body", ttl: 120 };
}

const readSig = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const writeSig = (k: string, s: string) => { try { localStorage.setItem(k, s); } catch { /* storage blocked */ } };
let lastHead: ShutdownSettings | null = null;

/** Body's workout that day, for the morning words (null on a rest day or before Body is ready). */
function workoutOf(day: string): { title: string; start: string } | null {
  const api = fitApi();
  if (!api || !fitState.get().ready) return null;
  try {
    const p = api.plan(day);
    if (!p?.workout) return null;
    const starts = p.blocks.map((b) => b.start).filter((x): x is number => x != null);
    const m = starts.length ? Math.min(...starts) : 360;
    return { title: p.workout, start: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
  } catch { return null; }
}

async function usualWeek(): Promise<Week | null> {
  const day = (await db.settings.get("day"))?.value as { week?: boolean } | undefined;
  return day?.week === false ? null : loadWeek();
}

async function plan(prefix: string, items: Buzz[], force: boolean): Promise<void> {
  const key = `nest:push:${prefix}`;
  const sig = JSON.stringify(items.map((i) => [i.id, i.at, i.title, i.body]));
  if (!force && sig === readSig(key)) return;
  const ok = items.length ? await scheduleBuzz(items, `${prefix}:`) : await cancelBuzz([], `${prefix}:`);
  if (ok) writeSig(key, sig);
}

/** Send the week's morning and shutdown buzzes when they changed (a new day, a new time, shut down early). */
export async function syncShutdown(force = false): Promise<void> {
  const p = pushPrefs();
  if (!p.on) return;
  const s = lastHead ?? { ...HEAD_DEFAULTS, ...(((await db.settings.get("head"))?.value as ShutdownSettings | undefined) ?? {}) };
  const week = await usualWeek();
  const today = C.today() as string, now = Date.now();
  await plan("shutdown", p.shutdown ? shutdownBuzzes(s, today, now, 7, week) : [], force);
  await plan("morning", p.morning !== false && week ? morningBuzzes(week, today, now, workoutOf) : [], force);
}

let started = false;
export function startBuzz(): void {
  if (started) return;
  started = true;

  // Rest timer: plan the buzz when it starts or moves (±15), cancel it when skipped or done.
  let planned = 0, deb = 0, wasReady = false;
  fitState.subscribe(() => {
    const st = fitState.get();
    if (st.ready && !wasReady) void syncShutdown(); // the morning words can name the workout now
    wasReady = st.ready;
    const p = pushPrefs();
    if (!p.on || !p.rest) return;
    const t = st.timer;
    const want = t && t.on && t.label !== "Hold" ? t.end : 0;
    if (want === planned) return;
    planned = want;
    window.clearTimeout(deb);
    deb = window.setTimeout(() => {
      const b = restBuzz(t, Date.now());
      void (b ? scheduleBuzz([b]) : cancelBuzz(["rest"]));
    }, 600);
  });

  // Morning + shutdown: when Head settings or his week change, and on every open.
  liveQuery(() => db.settings.get("head")).subscribe({
    next: (row) => { lastHead = { ...HEAD_DEFAULTS, ...((row?.value as ShutdownSettings | undefined) ?? {}) }; void syncShutdown(); },
    error: () => { /* keep going */ },
  });
  liveQuery(() => Promise.all([db.settings.get("week"), db.settings.get("day")])).subscribe({ next: () => void syncShutdown(), error: () => undefined });
  onPushPrefs(() => { void syncShutdown(true); if (!pushPrefs().rest) void cancelBuzz(["rest"]); });
  const opened = () => { if (document.visibilityState === "visible") { void refreshPush(); void syncShutdown(); } };
  document.addEventListener("visibilitychange", opened);
  window.setTimeout(opened, 2500);
}
