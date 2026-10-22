import { db, type ProposalStatus } from "./db";
import { CLOUD, supabase } from "./supabase";
import type { Proposal } from "./db";

const COLS = "id,kind,payload,reason,status,needs_google,created_at,updated_at,day_key,note";

/** Pull proposals from Supabase into the local copy. Local decisions go up first, so none are lost. */
export async function refreshProposals(): Promise<void> {
  if (!CLOUD || !navigator.onLine) return;
  await flushOutbox();
  if ((await db.outbox.count()) > 0) return; // still offline-ish: keep the local decisions as they are
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data, error } = await supabase
    .from("proposals").select(COLS)
    .is("deleted_at", null)
    .or(`status.in.(pending,approved),created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) throw error;
  await db.transaction("rw", db.proposals, db.outbox, async () => {
    // A ✓ tapped while this was loading is newer than what came down: keep the phone's copy of that card.
    const queued = new Set((await db.outbox.toArray()).filter((o) => o.table === "proposals").map((o) => o.row_id));
    const local = new Map((await db.proposals.toArray()).map((p) => [p.id, p]));
    const rows = ((data ?? []) as Proposal[]).map((r) => {
      const l = local.get(r.id);
      return l && (queued.has(r.id) || (l.updated_at ?? "") > (r.updated_at ?? "")) ? l : r;
    });
    await db.proposals.clear();
    await db.proposals.bulkPut(rows);
  });
}

/** ✓ or ✕ — written locally first, then queued for the server. Returns Undo (10 seconds). */
export async function decide(id: string, status: ProposalStatus): Promise<() => Promise<void>> {
  const before = await db.proposals.get(id);
  const now = new Date().toISOString();
  await db.proposals.update(id, { status, updated_at: now });
  const op_id = crypto.randomUUID();
  await db.outbox.put({ op_id, table: "proposals", row_id: id, patch: { status }, queued_at: now });
  void flushOutbox();
  return async () => {
    if (!before) return;
    await db.proposals.put(before);
    await db.outbox.delete(op_id);
    // Going back from "applied" goes through "approved" on the server, then back to where it was.
    await db.outbox.put({ op_id: crypto.randomUUID(), table: "proposals", row_id: id, patch: { status: before.status }, queued_at: new Date().toISOString() });
    void flushOutbox();
  };
}

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (!CLOUD || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    // Signed out, an update quietly changes nothing. Keep the decisions until there's someone to send them as.
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) return;
    const ops = await db.outbox.orderBy("queued_at").toArray();
    for (const op of ops) {
      const { error } = await supabase.from(op.table).update(op.patch).eq("id", op.row_id).select("id");
      if (error) {
        // A rule the server won't allow (e.g. undoing "applied") will never pass: drop it rather than block the queue.
        if (/Only status|can only approve/i.test(error.message)) { await db.outbox.delete(op.op_id); continue; }
        break; // keep it queued; try again when back online
      }
      await db.outbox.delete(op.op_id);
    }
  } finally {
    flushing = false;
  }
}
