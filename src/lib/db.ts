import Dexie, { type Table } from "dexie";

/** Phase 0 keeps only a cache of proposals, so ✓ works with no signal.
 *  Phase 1 adds days, blocks, steps and the outbox. */
export type ProposalStatus = "pending" | "approved" | "declined" | "applied" | "failed";
export interface Proposal {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  reason: string | null;
  status: ProposalStatus;
  needs_google: boolean;
  created_at: string;
  updated_at: string;
}
export interface OutboxOp {
  op_id: string;          // makes a retry safe: the server ignores an op it already applied
  table: "proposals";
  row_id: string;
  patch: Partial<Proposal>;
  queued_at: string;
}

class NestDB extends Dexie {
  proposals!: Table<Proposal, string>;
  outbox!: Table<OutboxOp, string>;
  constructor() {
    super("bird-nest");
    this.version(1).stores({
      proposals: "id, status, created_at",
      outbox: "op_id, queued_at",
    });
  }
}
export const db = new NestDB();
