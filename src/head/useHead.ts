import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db } from "../lib/db";
import type { HeadData, HeadSettings } from "./types";
import { HEAD_DEFAULTS } from "./store";

const EMPTY: HeadData = { areas: new Map(), projects: new Map(), tasks: new Map() };

/** Everything Head shows, live from the phone's database. Small enough to keep whole in memory. */
export function useHeadData(): { data: HeadData; ready: boolean } {
  const r = useLiveQuery(async () => {
    const [areas, projects, tasks] = await Promise.all([db.areas.toArray(), db.projects.toArray(), db.tasks.toArray()]);
    return {
      areas: new Map(areas.map((a) => [a.id, a])),
      projects: new Map(projects.map((p) => [p.id, p])),
      tasks: new Map(tasks.map((t) => [t.id, t])),
    } as HeadData;
  }, []);
  return { data: r ?? EMPTY, ready: !!r };
}

export function useHeadSettings(): HeadSettings {
  return useLiveQuery(async () => ({ ...HEAD_DEFAULTS, ...(((await db.settings.get("head"))?.value as Partial<HeadSettings>) ?? {}) }), [], HEAD_DEFAULTS);
}

/* A tiny store for screen state that non-React code (flows, actions) also changes. */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (next: T | ((s: T) => T)) => {
      state = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      subs.forEach((f) => f());
    },
    use: (): T => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state, () => state),
    /** For code outside React: called after every change. Returns the unsubscribe. */
    subscribe: (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

export type HeadView =
  | "inbox" | "today" | "upcoming" | "anytime" | "someday" | "waiting" | "logbook" | "projects"
  | "project" | "area" | "groceries" | "search" | "trash" | "settings";

export const nav = createStore<{ view: HeadView; id: string | null; selected: string | null; overlay: { name: string; props: Record<string, unknown> } | null }>({
  view: "today", id: null, selected: null, overlay: null,
});

/* Drill-down screens (a project, an area, settings, trash) remember where you came from, so they get a back button. */
const LIST_VIEWS = new Set<HeadView>(["inbox", "today", "upcoming", "anytime", "someday", "waiting", "logbook", "projects", "search"]);
let trail: { view: HeadView; id: string | null }[] = [];
export const go = (view: HeadView, id: string | null = null) => nav.set((s) => {
  if (LIST_VIEWS.has(view)) trail = [];
  else if (s.view !== view || s.id !== id) trail = [...trail, { view: s.view, id: s.id }].slice(-10);
  return { ...s, view, id, overlay: null };
});
export const backFrom = (): { view: HeadView; id: string | null } | null => trail[trail.length - 1] ?? null;
export const goBack = () => {
  const b = trail.pop();
  nav.set((s) => ({ ...s, view: b?.view ?? "today", id: b?.id ?? null, overlay: null }));
};
export const openTask = (id: string) => nav.set((s) => ({ ...s, selected: id }));
/** Save whatever field is still being typed in (its onBlur saves) before the screen it's on goes away.
    A sheet removed while a field has focus never gets a blur on iPhone, so the edit would be lost. */
export const commitTyping = () => { try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* no document */ } };
export const closeTask = () => { commitTyping(); nav.set((s) => ({ ...s, selected: null })); };
export const openOverlay = (name: string, props: Record<string, unknown> = {}) => nav.set((s) => ({ ...s, overlay: { name, props } }));
export const closeOverlay = () => { commitTyping(); nav.set((s) => ({ ...s, overlay: null })); };

/* Which bottom tab the app shows. Head flows can send Anthony back to the River. */
export type AppTab = "today" | "head" | "body" | "ok" | "settings" | "money";
export const appNav = createStore<{ tab: AppTab }>({ tab: "today" });
export const goTab = (tab: AppTab) => appNav.set({ tab });

/* Select mode (Clearhead's bulk bar): pick several tasks, act on all of them. */
export const multi = createStore<{ on: boolean; ids: string[] }>({ on: false, ids: [] });
export const toggleMulti = (id: string) => multi.set((m) => ({ on: true, ids: m.ids.includes(id) ? m.ids.filter((x) => x !== id) : [...m.ids, id] }));
export const clearMulti = () => multi.set({ on: false, ids: [] });
