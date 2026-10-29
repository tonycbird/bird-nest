/* Types for the money rules (money-core.js). The JS is the source of truth; it's shared with Claude's tools. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MoneySummary } from "./money";

export interface Envelope { key: string; name: string; group: string; order: number; archived: boolean }
export interface BudgetGroup { id: string; name: string; isIncome: boolean }
export interface Plan { month: string; amounts: Record<string, number>; carry?: Record<string, number> }
export interface Bill { id: string; type: "expense" | "income"; name: string; amount: number; dueDay: number; cadence: string; dueMonth: number | null; anchorDate: string; categoryId: string }
export interface Label { key: string; categoryId: string }
export interface Setup { v: number; from: string; made: string; envelopes: Envelope[]; groups: BudgetGroup[]; plans: Plan[]; bills: Bill[]; labels: Label[] }
export interface SortTxn { id: string; account_id: string; month: string; date: string; amount: number; merchant: string; name: string; hint: string }
export type How = "you" | "rule" | "hint" | null;
export interface SortCtx { sorts: Map<string, string>; labels: Label[]; envelopes: Envelope[]; keys: Set<string> }

export const SKIP: "_skip";
export function tidyPayee(raw: string): string;
export function merchantKey(raw: string | null | undefined): string;
export function labelSlug(key: string): string;
export function ruleFor(key: string, labels: Label[]): Label | null;
export function learnMerchants(list: any[], textOf: (t: any) => string): Record<string, string>;
export function hintEnvelope(hint: string, envelopes: Envelope[]): string | null;
export function storeKeyFor(t: { merchant: string; name: string }): string | null;
export function sortOf(t: SortTxn, ctx: SortCtx): { cat: string | null; how: How };
export function planFor(month: string, plans: Plan[], bills: Bill[]): { amounts: Record<string, number>; carry: Record<string, number>; own: boolean };
export function nestSummary(d: {
  envelopes: Envelope[]; groups: BudgetGroup[]; plans: Plan[]; bills: Bill[]; labels: Label[];
  sorts: Map<string, string>; txns: SortTxn[]; accounts: Set<string>; marks?: any[];
}, todayISO: string): MoneySummary & { source: "nest"; sorted: { you: number; rule: number; hint: number }; plan_own: boolean };
export function buildSetup(bb: any, made?: string): Setup;
export function summarize(data: any, todayISO: string): MoneySummary;
export function billDaysInMonth(r: any, y: number, m: number): number[];
export function txnLines(t: any): { categoryId: string; amount: number }[];
export function needsCategory(t: any): boolean;
export const isTransfer: (t: any) => boolean;
