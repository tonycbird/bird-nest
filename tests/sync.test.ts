import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* A tiny fake of the parts of Supabase sync uses, so the push/pull logic runs for real. */
const server = { rows: new Map<string, Record<string, unknown>>(), upserts: 0, fail: false, claimed: 0, proposals: [] as Record<string, unknown>[] };
const store = new Map<string, string>();
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.document = { hidden: false, addEventListener() {} };
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  g.addEventListener = () => {};
});

const session = { user: { id: "u1", email: "a@b.c" } };
let authCb: ((e: string, s: unknown) => void) | null = null;
function q(table: string) {
  const api: Record<string, unknown> = {};
  let rows: Record<string, unknown>[] = [];
  const chain = new Proxy(api, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res({ data: rows, error: null }) : () => chain) });
  if (table === "proposals") rows = server.proposals;
  return {
    upsert: async (batch: Record<string, unknown>[]) => {
      if (server.fail) return { error: { message: "offline" } };
      server.upserts++;
      for (const r of batch) server.rows.set(`${r.tbl}|${r.id}`, r);
      return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => chain,
  };
}
vi.mock("../src/lib/supabase", () => ({
  CLOUD: true,
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {},
    },
    rpc: async () => { server.claimed++; return { data: true, error: null }; },
    from: (t: string) => q(t),
  },
}));

const { db } = await import("../src/lib/db");
const S = await import("../src/lib/sync");
const H = await import("../src/head/store");
const { addBlock } = await import("../src/lib/river");

beforeEach(async () => {
  await db.delete(); await db.open();
  server.rows.clear(); server.upserts = 0; server.fail = false;
});

describe("sync: the phone's copy goes up", () => {
  it("nothing is sent before sign-in; Nest still works", async () => {
    S.installSync();
    await H.createTask({ title: "Offline task" });
    expect(await S.syncNow()).toBe(false);
    expect(server.rows.size).toBe(0);
    expect(S.pendingCount()).toBeGreaterThan(0);
  });

  it("signing in sends everything once, ties Claude's door, and later edits follow", async () => {
    await addBlock({ day: "2031-03-13", start: "05:00", kind: "body", title: "Legs", steps: [{ label: "Squat" }] });
    authCb?.("SIGNED_IN", session);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.claimed).toBeGreaterThan(0);
    expect(await S.syncNow()).toBe(true);
    const tbls = new Set([...server.rows.values()].map((r) => r.tbl));
    expect(tbls.has("blocks") && tbls.has("steps") && tbls.has("tasks")).toBe(true);
    const blk = [...server.rows.values()].find((r) => r.tbl === "blocks")!;
    expect(blk.day).toBe("2031-03-13");
    expect(blk.user_id).toBe("u1");
    expect(S.pendingCount()).toBe(0);

    const t = await H.createTask({ title: "New one" });
    expect(S.pendingCount()).toBe(1);
    await S.syncNow();
    expect((server.rows.get(`tasks|${t.id}`)!.data as { title: string }).title).toBe("New one");
  });

  it("an offline push keeps the rows waiting, and sends them when back", async () => {
    authCb?.("SIGNED_IN", session);
    await new Promise((r) => setTimeout(r, 20));
    await S.syncNow();
    const t = await H.createTask({ title: "At the gym" });
    server.fail = true;
    expect(await S.syncNow()).toBe(false);
    expect(S.pendingCount()).toBe(1);
    server.fail = false;
    expect(await S.syncNow()).toBe(true);
    expect(server.rows.has(`tasks|${t.id}`)).toBe(true);
    expect(S.pendingCount()).toBe(0);
  });

  it("a deleted row goes up as deleted", async () => {
    authCb?.("SIGNED_IN", session);
    await new Promise((r) => setTimeout(r, 20));
    await db.fit.put({ key: "logs/2031-03", value: { sessions: {} }, _u: 1, updated_at: "" });
    await S.syncNow();
    await db.fit.delete("logs/2031-03");
    await S.syncNow();
    expect(server.rows.get("fit|logs/2031-03")!.deleted_at).toBeTruthy();
  });
});
