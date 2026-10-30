import Dexie, { type Table } from "dexie";
import type { Area, Project, Task, Template, TrashEntry, Photo } from "../head/types";

/* Bird Nest local database (IndexedDB via Dexie).
   The UI reads only from here. Phase 4 syncs rows whose updated stamp is newer than the last sync
   (upsert by id, last-write-wins), so every row carries an update stamp and deletes are soft. */

export type Kind = "body" | "head" | "life" | "money";
export type BlockStatus = "open" | "done" | "skipped";

export interface Row { id: string; created_at: string; updated_at: string; deleted_at: string | null; }

export interface Day extends Omit<Row, "id"> { day: string; sentence: string | null; recap?: string[] | null; }

export interface Block extends Row {
  day: string;            // YYYY-MM-DD in Anthony's time zone
  start: string;          // "HH:MM" 24h
  end: string | null;     // "HH:MM" or null
  kind: Kind;
  icon: string;
  title: string;
  status: BlockStatus;
  done_at: string | null;
  source_type?: "task" | "groceries" | "workout" | "calendar" | "bill" | null;  // made from Head (a task, grocery items), Body (a workout part), or a calendar event Anthony accepted
  source_id?: string | null;    // task id; grocery task ids joined by ","; "YYYY-MM-DD|warm|main|cool|…" for Body; the calendar event id
}

export interface Step extends Row {
  block_id: string;
  n: number;              // 1-based order inside the block
  label: string;          // 6 words or fewer
  value: string | null;   // "4×5 · 245", "2 min"
  done_at: string | null;
}

/** Body (Bird Fitness) documents, stored as the old app saved them: key "fit/settings" or "logs/2026-10". */
export interface FitDoc { key: string; value: Record<string, unknown>; _u: number; updated_at: string; }

export interface Setting { key: string; value: unknown; updated_at: string; }

export type ProposalStatus = "pending" | "approved" | "declined" | "applied" | "failed";
export interface Proposal {
  id: string; kind: string; payload: Record<string, unknown>; reason: string | null;
  status: ProposalStatus; needs_google: boolean; created_at: string; updated_at: string;
  day_key?: string | null; note?: string | null;
}
/** A Google Calendar event Claude copied in. Read-only; shown on the River as a thin locked block. */
export interface CalEvent { id: string; day: string; start: string | null; end: string | null; title: string; all_day: boolean; calendar?: string | null }
/** Mail Claude flagged: a summary line and a link, never the body. */
export interface MailItem { id: string; received: string | null; sender: string | null; subject: string | null; ask: string | null; due: string | null; link: string; created_at: string; dismissed_at: string | null }

/** Testing mode: what went wrong, with the screen it happened on. Synced so Claude can read and fix it. */
export interface Report extends Row {
  kind: "design" | "stuck" | "bug" | "idea";
  text: string;
  photo: string | null;                  // small JPEG data URL from Photos
  ctx: Record<string, unknown>;          // tab, screen, open sheets, look, version, phone
  errors: { at: string; msg: string }[]; // errors the app caught before the report
  trail: { at: string; what: string }[]; // the last taps
  dom: string | null;                    // the screen's HTML, so it can be redrawn
  frame_dom: string | null;              // the Body frame's HTML, when on Body
  status: "open" | "fixed" | "later";
  status_at: string | null;
  fix_note: string | null;
  fixed_at: string | null;
}

/** Phase 6: the money summary Claude works out from Bird Budgeting (claude/tools/money.mjs). Pulled, never pushed. */
export interface MoneyRow { key: "summary"; data: import("./money").MoneySummary; updated_at: string }

/** Phase 7: bank transactions from Plaid, through the helper's Bank (worker/bank.ts). Pulled, never pushed.
    Spending is negative. `category` and `note` are Nest's own and survive the bank editing a row. */
export interface Txn { id: string; item_id: string; account_id: string; date: string; month: string; amount: number; name: string; merchant: string; pending: boolean; hint: string; category?: string | null; note?: string | null; updated_at: string }
/** The bank's last status and where the pull got to (key "status", "seq"). */
export interface BankRow { key: string; data: unknown; updated_at: string }

/** Phase 7: Nest's own budget, one table for all of it (synced like everything else):
    envelopes, monthly plans, bills, store rules, his own sorts, and prefs. */
export type BudgetKind = "envelope" | "plan" | "bill" | "label" | "sort" | "mark" | "history" | "prefs";
export interface BudgetRow {
  id: string; kind: BudgetKind; updated_at: string; deleted_at?: string | null;
  // envelope
  key?: string; name?: string; group?: string; order?: number; archived?: boolean;
  keywords?: string[]; target?: number | null; priority?: string; rollover?: boolean;
  // plan
  month?: string; amounts?: Record<string, number>; carry?: Record<string, number>;
  // bill
  type?: "expense" | "income"; amount?: number; dueDay?: number; cadence?: string; dueMonth?: number | null; anchorDate?: string; categoryId?: string; variesBy?: number;
  // sort (his pick for one purchase; from "bird" when it came from Bird Budgeting's history)
  txn?: string; from?: "bird" | "suggested"; // a plan: "suggested" when Nest wrote it at the start of the month
  // mark (a bill paid by hand: no bank row to show it)
  billId?: string; date?: string;
  // history (Bird Budgeting's rows: [date, cents, envelope, short name])
  entries?: [string, number, string, string][];
  // prefs: the accounts that count as the budget, and where the setup came from
  accounts?: string[]; setup_made?: string; setup_v?: number; groups?: { id: string; name: string; isIncome: boolean }[];
  mixed?: Record<string, Record<string, number>>; // stores he files more than one way: {store key: {envelope: times}}
}

export type OutboxOp =
  | { op_id: string; table: "proposals"; row_id: string; patch: Partial<Proposal>; queued_at: string }
  | { op_id: string; table: "mail_items"; row_id: string; patch: { dismissed_at: string }; queued_at: string };

export class NestDB extends Dexie {
  days!: Table<Day, string>;
  blocks!: Table<Block, string>;
  steps!: Table<Step, string>;
  settings!: Table<Setting, string>;
  proposals!: Table<Proposal, string>;
  outbox!: Table<OutboxOp, string>;
  // Head (ported from Clearhead; rows keep Clearhead's field names so its logic runs unchanged)
  areas!: Table<Area, string>;
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  templates!: Table<Template, string>;
  trash!: Table<TrashEntry, string>;
  photos!: Table<Photo, string>;
  // Body (ported from Bird Fitness; documents keep the old app's shape so its logic runs unchanged)
  fit!: Table<FitDoc, string>;
  // Phase 4: copies of what Claude wrote (calendar, flagged mail). Pulled from the cloud, never pushed.
  calendar!: Table<CalEvent, string>;
  mail!: Table<MailItem, string>;
  reports!: Table<Report, string>;
  money!: Table<MoneyRow, string>;
  txns!: Table<Txn, string>;
  bank!: Table<BankRow, string>;
  budget!: Table<BudgetRow, string>;
  constructor(name = "bird-nest") {
    super(name);
    this.version(1).stores({ proposals: "id, status, created_at", outbox: "op_id, queued_at" });
    this.version(2).stores({
      days: "day, updated_at",
      blocks: "id, day, [day+start], status, deleted_at, updated_at",
      steps: "id, block_id, [block_id+n], updated_at",
      settings: "key",
      proposals: "id, status, created_at",
      outbox: "op_id, queued_at",
    });
    this.version(3).stores({
      areas: "id",
      projects: "id, areaId, status",
      tasks: "id, status, areaId, projectId, when, due",
      templates: "id",
      trash: "id, group, deletedAt",
      photos: "id, owner",
    });
    this.version(4).stores({ fit: "key, updated_at" });
    this.version(5).stores({ calendar: "id, day", mail: "id, created_at" });
    this.version(6).stores({ reports: "id, created_at, status" });
    this.version(7).stores({ money: "key" });
    this.version(8).stores({ txns: "id, date, month, account_id, item_id", bank: "key" });
    this.version(9).stores({ budget: "id, kind, updated_at" });
  }
}
export const db = new NestDB();

export const TABLES = ["days", "blocks", "steps", "settings", "proposals", "areas", "projects", "tasks", "templates", "trash", "photos", "fit", "budget"] as const;
export type TableName = (typeof TABLES)[number];

export const nowISO = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
