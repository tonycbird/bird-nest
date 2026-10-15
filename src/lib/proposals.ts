import { db, type ProposalStatus } from "./db";
import { CLOUD, supabase } from "./supabase";
import type { Proposal } from "./db";

const COLS = "id,kind,payload,reason,status,needs_google,created_at,updated_at";

/** Pull pending proposals from Supabase into the local cache. Safe to call often. */
export async function refreshProposals(): Promise<void> {
  if (!CLOUD || !navigator.onLine) return;
  const { data, error } = await supabase
    .from("proposals").select(COLS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  await db.transaction("rw", db.proposals, async () => {
    await db.proposals.clear();
    await db.proposals.bulkPut((data ?? []) as Proposal[]);
  });
  await flushOutbox();
}

/** ✓ or ✕ — written locally first, then queued for the server. */
export async function decide(id: string, status: ProposalStatus): Promise<() => Promise<void>> {
  const before = await db.proposals.get(id);
  const now = new Date().toISOString();
  await db.proposals.update(id, { status, updated_at: now });
  const op_id = crypto.randomUUID();
  await db.outbox.put({ op_id, table: "proposals", row_id: id, patch: { status }, queued_at: now });
  void flushOutbox();
  // Undo for 10 seconds: put it back and queue the reverse.
  return async () => {
    if (!before) return;
    await db.proposals.put(before);
    await db.outbox.delete(op_id);
    await db.outbox.put({ op_id: crypto.randomUUID(), table: "proposals", row_id: id, patch: { status: before.status }, queued_at: new Date().toISOString() });
    void flushOutbox();
  };
}

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (!CLOUD || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const ops = await db.outbox.orderBy("queued_at").toArray();
    for (const op of ops) {
      const { error } = await supabase.from(op.table).update(op.patch).eq("id", op.row_id);
      if (error) break;              // keep it queued; try again when back online
      await db.outbox.delete(op.op_id);
    }
  } finally {
    flushing = false;
  }
}
