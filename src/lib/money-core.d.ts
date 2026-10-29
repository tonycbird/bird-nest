/* Types for the money rules (money-core.js). The JS is the source of truth; it's shared with Claude's tools. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MoneySummary } from "./money";

export interface Envelope { key: string; name: string; group: string; order: number; archived: boolean; keywords?: string[]; target?: number | null; priority?: string; rollover?: boolean }
export interface BudgetGroup { id: string; name: string; isIncome: boolean }
export interface Plan { month: string; amounts: Record<string, number>; carry?: Record<string, number> }
export interface Bill { id: string; type: "expense" | "income"; name: string; amount: number; dueDay: number; cadence: string; dueMonth: number | null; anchorDate: string; categoryId: string; variesBy?: number }
export interface Label { key: string; categoryId: string }
export interface Mark { billId: string; month: string; kind: "manual"; amount: number; date: string }
export interface Setup { v: number; from: string; made: string; envelopes: Envelope[]; groups: BudgetGroup[]; plans: Plan[]; bills: Bill[]; labels: Label[]; marks?: Mark[]; history?: [string, number, string, string][]; mixed?: Record<string, Record<string, number>> }
export interface HistoryEntry { date: string; cents: number; cat: string; name: string }
export interface PaycheckBill { id: string; name: string; date: string; amount: number; paid?: boolean; optional?: boolean }
export interface Paycheck {
  start: string; end: string; in: number; expected: number; landed: number; upside: number;
  bills: PaycheckBill[]; billsTotal: number; extra: number; spent: number; left: number; daysLeft: number; perDay: number;
  next: { start: string; end: string; in: number; upside: number; bills: PaycheckBill[]; billsTotal: number; extra: number; left: number };
}
export interface SortTxn { id: string; account_id: string; month: string; date: string; amount: number; merchant: string; name: string; hint: string }
export type How = "you" | "rule" | "hint" | null;
export interface SortCtx { sorts: Map<string, string>; labels: Label[]; envelopes: Envelope[]; keys: Set<string>; income?: Set<string>; mixed?: Record<string, Record<string, number>> }

export const SKIP: "_skip";
export function tidyPayee(raw: string): string;
export function merchantKey(raw: string | null | undefined): string;
export function labelSlug(key: string): string;
export function ruleFor(key: string, labels: Label[]): Label | null;
export function learnMerchants(list: any[], textOf: (t: any) => string): Record<string, string>;
export function hintEnvelope(hint: string, envelopes: Envelope[]): string | null;
export function storeKeyFor(t: { merchant: string; name: string }): string | null;
export function sortOf(t: SortTxn & { amount: number }, ctx: SortCtx): { cat: string | null; how: How };
export function isBankAdjustment(text: string | null | undefined): boolean;
export function feeEnvelope(envelopes: Envelope[]): string | null;
export function keywordEnvelope(texts: (string | null | undefined)[], envelopes: Envelope[], skip?: Set<string> | null): string | null;
export function incomeKeys(envelopes: Envelope[], groups?: BudgetGroup[]): Set<string>;
export function makeCtx(d: { envelopes: Envelope[]; labels?: Label[]; sorts?: Map<string, string>; groups?: BudgetGroup[]; mixed?: Record<string, Record<string, number>> }): SortCtx & { income: Set<string> };
export function mixedFor(t: { merchant: string; name: string }, mixed?: Record<string, Record<string, number>>): Record<string, number> | null;
export function matchHistory(entries: HistoryEntry[], bankTxns: { id: string; date: string; amount: number; pending?: boolean }[]): {
  pairs: { txn: string; cat: string; date: string }[]; onlyBird: HistoryEntry[]; onlyBank: any[]; from: string | null; to: string | null; total: number; matched: number;
};
export function paydays(bills: Bill[], fromISO: string, toISO: string): { date: string; amount: number; upside: number }[];
export function payPeriod(d: { bills: Bill[]; income?: Set<string>; optional?: Set<string> }, todayISO: string, sorted: any[], statusOf?: (r: Bill, date: string) => boolean): Paycheck | null;
export const GROUP_NAMES: Record<string, string>;
export function planFor(month: string, plans: Plan[], bills: Bill[]): { amounts: Record<string, number>; carry: Record<string, number>; own: boolean };
export function nestSummary(d: {
  envelopes: Envelope[]; groups: BudgetGroup[]; plans: Plan[]; bills: Bill[]; labels: Label[];
  sorts: Map<string, string>; txns: SortTxn[]; accounts: Set<string>; marks?: any[]; mixed?: Record<string, Record<string, number>>;
}, todayISO: string): MoneySummary & { source: "nest"; sorted: { you: number; rule: number; hint: number }; plan_own: boolean; paycheck: Paycheck | null };
export function buildSetup(bb: any, made?: string): Setup;
export function summarize(data: any, todayISO: string): MoneySummary;
export function billDaysInMonth(r: any, y: number, m: number): number[];
export function txnLines(t: any): { categoryId: string; amount: number }[];
export function needsCategory(t: any): boolean;
export const isTransfer: (t: any) => boolean;
