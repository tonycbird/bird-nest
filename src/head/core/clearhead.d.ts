/* Types for the ported Clearhead core (core/clearhead.js). Loose on purpose: the JS is the source of truth. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Area, HeadData, Project, RepeatRule, Task, Template } from "../types";

export const DAY_MS: number;
export const WEEKDAYS: string[];
export const WD_SHORT: string[];
export const MONTHS: string[];
export const MON_SHORT: string[];
export const AREA_COLORS: string[];
export const AREA_ICONS: string[];
export const DEFAULT_CONTEXTS: string[];
export const ESTIMATES: number[];
export const TODS: { id: "morning" | "afternoon" | "evening" | null; name: string; icon: string }[];
export const PROJECT_STATUSES: { id: Project["status"]; name: string }[];
export const DEFAULT_SETTINGS: any;
export const SEED_AREAS: { name: string; color: string; icon: string; listMode?: "groceries" }[];
export const GROCERY_CATS: { id: string; name: string; words: string }[];
export const BUILTIN_TEMPLATES: Template[];

export function setNow(d: Date | null): void;
export function now(): Date;
export function today(): string;
export function ymd(d: Date): string;
export function parseYmd(s: string | null): Date;
export function addDays(s: string, n: number): string;
export function addMonths(s: string, n: number, clampDay?: number): string;
export function addYears(s: string, n: number): string;
export function daysInMonth(y: number, m: number): number;
export function weekday(s: string): number;
export function diffDays(a: string, b: string): number;
export function startOfWeek(s: string, weekStart?: number): string;
export function startOfMonth(s: string): string;
export function endOfMonth(s: string): string;
export function nextWeekday(from: string, wd: number, includeToday?: boolean): string;
export function nthWeekdayOfMonth(y: number, m: number, wd: number, n: number): string | null;
export function nthOfWeekdayInMonth(s: string): number;
export function isLastWeekdayOfMonth(s: string): boolean;
export function ordinal(n: number): string;
export function relLabel(s: string | null, opts?: { long?: boolean }): string;
export function longLabel(s: string): string;
export function monthLabel(s: string): string;
export function fmtTime(hhmm: string | null): string;
export function fmtMinutes(min: number | null): string;
export function timeAgo(ts: number): string;
export function nowHHMM(): string;

export function normalizeRule(r: Partial<RepeatRule> | null): RepeatRule | null;
export function nextAfter(r: RepeatRule, date: string): string | null;
export function matches(r: RepeatRule, date: string): boolean;
export function occurrencesBetween(r: RepeatRule, from: string, to: string, limit?: number): string[];
export function nextInstanceDates(task: Partial<Task>, completedOn?: string): { when: string | null; due: string | null };
export function describeRule(r: RepeatRule | null): string;
export function firstOnOrAfter(r: RepeatRule, date: string): string;

export function uid(prefix?: string): string;
export function guessGroceryCat(title: string): string;
export function isOpen(t: Task | undefined | null): boolean;
export function isDone(t: Task | undefined | null): boolean;
export function newTask(fields: Partial<Task>): Task;
export function isInbox(t: Task): boolean;
export function homeOf(t: Task, data: HeadData): { project: Project | null; area: Area | null };
export function areaOfTask(t: Task, data: HeadData): Area | null;
export function projectActive(t: Task, data: HeadData): boolean;
export function isGroceryItem(t: Task): boolean;
export function isActionable(t: Task, data: HeadData): boolean;
export function byOrder(a: Task, b: Task): number;
export function byToday(a: Task, b: Task): number;
export function allTasks(data: HeadData): Task[];
export function selectInbox(data: HeadData): Task[];
export function selectToday(data: HeadData): { main: Task[]; overdue: Task[]; groups: Record<"start" | "morning" | "afternoon" | "evening" | "anytime", Task[]> };
export function isOffDay(s: { offDays?: number[] }, date: string): boolean;
export function nextWorkDay(s: { offDays?: number[] }, from: string): string;
export function quietState(s: any, t: string, hm: string): { kind: "offday" | "night" | "evening"; date: string } | null;
export function selectDay(data: HeadData, date: string): { tasks: Task[]; repeats: Task[] };
export function selectUpcoming(data: HeadData, opts?: { horizon?: string }): { tasks: { task: Task; date: string; kind: string }[]; previews: { task: Task; date: string; kind: string }[] };
export function upcomingBuckets(weekStart?: number): { kind: "day" | "week" | "month" | "later"; from: string; to: string; key: string }[];
export function selectAnytime(data: HeadData, filters?: { context?: string | null; energy?: string | null; maxTime?: number | null }): Task[];
export function energyRank(e: string | null): number;
export function selectSomeday(data: HeadData): { tasks: Task[]; projects: Project[] };
export function selectWaiting(data: HeadData): Task[];
export function selectLogbook(data: HeadData): Task[];
export function projectTasks(data: HeadData, pid: string): Task[];
export function projectStats(data: HeadData, p: Project): { open: number; done: number; total: number; pct: number };
export function sortProjectTasks(p: Project, tasks: Task[]): Task[];
export function nextAction(data: HeadData, p: Project): Task | null;
export function activeProjects(data: HeadData): Project[];
export function areaList(data: HeadData, opts?: { includeArchived?: boolean }): Area[];
export function suggestForToday(data: HeadData, limit?: number): { task: Task; score: number; why: string[] }[];
export function bestNow(data: HeadData, opts: { context?: string | null; minutes?: number | null; energy?: string | null }): Task[];
export function completedBetween(data: HeadData, fromTs: number, toTs: number): Task[];
export function compactForLogbook(t: Task): Task;
export function searchAll(data: HeadData, q: string, archive?: Task[]): { tasks: Task[]; projects: Project[]; areas: Area[] };
export function csvForTasks(tasks: Task[], data: HeadData): string;

export function esc(s: string): string;
export function inline(s: string): string;
export function renderNotes(text: string): string;
export function toggleNoteLine(text: string, i: number): string;

export interface ParseToken { type: string; start: number; end: number; raw: string; label: string; value: any; unresolved?: boolean; symbol?: boolean; tod?: string; keep?: boolean; }
export function matchDateAt(s: string, ctx?: any): { len: number; date: string; tod?: string; keep?: boolean } | null;
export function matchTimeAt(s: string): { len: number; time: string } | null;
export function matchRepeatAt(s: string, ctx?: any): { len: number; rule: RepeatRule } | null;
export function parseEstimate(v: string): number | null;
export function matchName<T>(list: T[], raw: string, field?: string): T | null;
export function parseQuickAdd(text: string, ctx?: any): { title: string; fields: Partial<Task>; tokens: ParseToken[] };
export function parseDuration(s: string): number | null;

export function rambleprompt(input: any): string;
export function normalizeSorted(raw: any, opts?: { contexts?: string[] }): { todos: any[]; materials: string[]; notes: string[] };
export function splitRamble(text: string, ctx?: any): {
  todos: { title: string; when: string | null; due: string | null; contexts: string[]; est: number | null; waitingOn: string | null; phase: string | null; note: string | null }[];
  materials: string[];
  notes: string[];
};
