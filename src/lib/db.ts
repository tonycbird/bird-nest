import Dexie, { type Table } from "dexie";
import type { Area, Project, Task, Template, TrashEntry, Photo } from "../head/types";

/* Bird Nest local database (IndexedDB via Dexie).
   The UI reads only from here. Phase 4 syncs rows whose updated stamp is newer than the last sync
   (upsert by id, last-write-wins), so every row carries an update stamp and deletes are soft. */

export type Kind = "body" | "head" | "life" | "money";
export type BlockStatus = "open" | "done" | "skipped";

export interface Row { id: string; created_at: string; updated_at: string; deleted_at: string | null; }

export interface Day extends Omit<Row, "id"> { day: string; sentence: string | null; }

export interface Block extends Row {
  day: string;            // YYYY-MM-DD in Anthony's time zone
  start: string;          // "HH:MM" 24h
  end: string | null;     // "HH:MM" or null
  kind: Kind;
  icon: string;
  title: string;
  status: BlockStatus;
  done_at: string | null;
  source_type?: "task" | "groceries" | null;  // Phase 2: a block made from Head (a task, or grocery items)
  source_id?: string | null;    // task id, or grocery task ids joined by ","
}

export interface Step extends Row {
  block_id: string;
  n: number;              // 1-based order inside the block
  label: string;          // 6 words or fewer
  value: string | null;   // "4×5 · 245", "2 min"
  done_at: string | null;
}

export interface Setting { key: string; value: unknown; updated_at: string; }

export type ProposalStatus = "pending" | "approved" | "declined" | "applied" | "failed";
export interface Proposal {
  id: string; kind: string; payload: Record<string, unknown>; reason: string | null;
  status: ProposalStatus; needs_google: boolean; created_at: string; updated_at: string;
}
export interface OutboxOp { op_id: string; table: "proposals"; row_id: string; patch: Partial<Proposal>; queued_at: string; }

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
  }
}
export const db = new NestDB();

export const TABLES = ["days", "blocks", "steps", "settings", "proposals", "areas", "projects", "tasks", "templates", "trash", "photos"] as const;
export type TableName = (typeof TABLES)[number];

export const nowISO = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
