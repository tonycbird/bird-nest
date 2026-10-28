/* What buzzes, and when. Two things, picked by Anthony:
   1. Rest timer done (Body) — so the phone can be locked between sets.
   2. Shutdown time (Head settings) — once each evening, skipping off days and days already shut down. */
import { liveQuery } from "dexie";
import * as C from "../head/core/clearhead.js";
import { db } from "./db";
import { HEAD_DEFAULTS } from "../head/store";
import { fitState } from "../body/host";
import { cancelBuzz, onPushPrefs, pushPrefs, refreshPush, scheduleBuzz, type Buzz } from "./push";

interface ShutdownSettings { shutdownTime?: string; offDays?: number[]; lastShutdown?: string | null }

/** The next week of shutdown buzzes (pure, for tests). */
export function shutdownBuzzes(s: ShutdownSettings, today: string, now: number, days = 7): Buzz[] {
  const out: Buzz[] = [];
  const time = /^\d{2}:\d{2}$/.test(s.shutdownTime || "") ? s.shutdownTime! : "19:00";
  for (let i = 0; i < days; i++) {
    const d = C.addDays(today, i) as string;
    if (C.isOffDay(s, d)) continue;
    if (i === 0 && s.lastShutdown === today) continue;
    const at = new Date(`${d}T${time}:00`).getTime();
    if (!(at > now + 60_000)) continue;
    out.push({ id: `shutdown:${d}`, at, title: "Shutdown", body: "Close out today, then rest.", tag: "shutdown", url: "/?open=shutdown", ttl: 1800 });
  }
  return out;
}

/** The rest buzz for a running Body timer, or null (Hold timers and short ones don't buzz). */
export function restBuzz(t: { on: boolean; end: number; label: string } | null, now: number): Buzz | null {
  if (!t || !t.on || t.label === "Hold" || t.end - now < 12_000) return null;
  const label = t.label || "Rest";
  return { id: "rest", at: t.end, title: `${label} done — go`, body: label === "Rest" ? "Time for your next set." : undefined, tag: "rest", url: "/?open=body", ttl: 120 };
}

const SIG = "nest:push:shutdown";
const readSig = () => { try { return localStorage.getItem(SIG) || ""; } catch { return ""; } };
const writeSig = (s: string) => { try { localStorage.setItem(SIG, s); } catch { /* storage blocked */ } };
let lastHead: ShutdownSettings | null = null;

/** Send the week's shutdown buzzes when they changed (a new day, a new time, shut down early). */
export async function syncShutdown(force = false): Promise<void> {
  const p = pushPrefs();
  if (!p.on) return;
  const s = lastHead ?? { ...HEAD_DEFAULTS, ...(((await db.settings.get("head"))?.value as ShutdownSettings | undefined) ?? {}) };
  const items = p.shutdown ? shutdownBuzzes(s, C.today() as string, Date.now()) : [];
  const sig = JSON.stringify(items.map((i) => [i.id, i.at]));
  if (!force && sig === readSig()) return;
  const ok = items.length ? await scheduleBuzz(items, "shutdown:") : await cancelBuzz([], "shutdown:");
  if (ok) writeSig(sig);
}

let started = false;
export function startBuzz(): void {
  if (started) return;
  started = true;

  // Rest timer: plan the buzz when it starts or moves (±15), cancel it when skipped or done.
  let planned = 0, deb = 0;
  fitState.subscribe(() => {
    const p = pushPrefs();
    if (!p.on || !p.rest) return;
    const t = fitState.get().timer;
    const want = t && t.on && t.label !== "Hold" ? t.end : 0;
    if (want === planned) return;
    planned = want;
    window.clearTimeout(deb);
    deb = window.setTimeout(() => {
      const b = restBuzz(t, Date.now());
      void (b ? scheduleBuzz([b]) : cancelBuzz(["rest"]));
    }, 600);
  });

  // Shutdown: when Head settings change (time, off days, "shut down" tonight) and on every open.
  liveQuery(() => db.settings.get("head")).subscribe({
    next: (row) => { lastHead = { ...HEAD_DEFAULTS, ...((row?.value as ShutdownSettings | undefined) ?? {}) }; void syncShutdown(); },
    error: () => { /* keep going */ },
  });
  onPushPrefs(() => { void syncShutdown(true); if (!pushPrefs().rest) void cancelBuzz(["rest"]); });
  const opened = () => { if (document.visibilityState === "visible") { void refreshPush(); void syncShutdown(); } };
  document.addEventListener("visibilitychange", opened);
  window.setTimeout(opened, 2500);
}
