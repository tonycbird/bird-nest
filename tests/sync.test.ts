import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* A tiny fake of the parts of Supabase sync uses, so the push/pull logic runs for real. */
const server = { rows: new Map<string, Record<string, unknown>>(), upserts: 0, fail: false, claimed: 0, proposals: [] as Record<string, unknown>[], cloud: [] as Record<string, unknown>[] };
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
  let tbl: string | null = null;
  const chain: Record<string, unknown> = new Proxy(api, { get: (_t, k) => (k === "then"
    ? (res: (v: unknown) => void) => res({ data: tbl ? rows.filter((r) => r.tbl === tbl) : rows, error: null })
    : k === "eq" ? (col: string, v: string) => { if (col === "tbl") tbl = v; return chain; }
    : () => chain) });
  if (table === "proposals") rows = server.proposals;
  return {
    upsert: async (batch: Record<string, unknown>[]) => {
      if (server.fail) return { error: { message: "TypeError: Failed to fetch" } };
      // Like Postgres: a half emoji or NUL anywhere in the batch fails the whole batch.
      if (batch.some((r) => /[\uD800-\uDFFF]|\u0000/.test(JSON.stringify(r.data).replace(/\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}/g, "")) && /\\u(d[89ab]|0000)/i.test(JSON.stringify(r.data))))
        return { error: { message: "unsupported Unicode escape sequence", code: "22P05" } };
      if (batch.some((r) => (r.data as { title?: string })?.title === "REFUSE")) return { error: { message: "value violates check", code: "23514" } };
      server.upserts++;
      for (const r of batch) server.rows.set(`${r.tbl}|${r.id}`, r);
      return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    select: (cols?: string) => {
      if (table === "nest_rows" && server.cloud.length) rows = server.cloud.filter((r) => !cols || true);
      return chain;
    },
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
  server.rows.clear(); server.upserts = 0; server.fail = false; server.cloud = [];
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

  it("one row the cloud refuses is set aside; the rest still sync", async () => {
    authCb?.("SIGNED_IN", session);
    await new Promise((r) => setTimeout(r, 20));
    await S.syncNow();
    const bad = await H.createTask({ title: "REFUSE" });
    const good = await H.createTask({ title: "Fine" });
    expect(await S.syncNow()).toBe(true);
    expect(server.rows.has(`tasks|${good.id}`)).toBe(true);
    expect(server.rows.has(`tasks|${bad.id}`)).toBe(false);
    expect(Object.keys(S.stuckRows()).some((k) => k.includes(bad.id))).toBe(true);
    expect(S.pendingCount()).toBe(0);
  });

  it("a title cut in the middle of an emoji still syncs (cleaned on the way up)", async () => {
    authCb?.("SIGNED_IN", session);
    await new Promise((r) => setTimeout(r, 20));
    await S.syncNow();
    const t = await H.createTask({ title: "Gym 💪".slice(0, 5) });
    expect(await S.syncNow()).toBe(true);
    expect((server.rows.get(`tasks|${t.id}`)!.data as { title: string }).title).toBe("Gym \uFFFD");
  });
});

describe("sync: a new phone joins the cloud copy", () => {
  it("Body rows come from the cloud, so this phone's defaults don't overwrite the real ones", async () => {
    store.clear();
    vi.resetModules();
    const { db: db2 } = await import("../src/lib/db");
    const S2 = await import("../src/lib/sync");
    await db2.delete(); await db2.open();
    S2.installSync();
    // Fresh phone: Body wrote its defaults before sign-in.
    await db2.fit.put({ key: "fit/settings", value: { units: "lb", gymTime: 300, _u: 99 }, _u: 99, updated_at: "" });
    server.cloud = [{ tbl: "fit", id: "fit/settings", data: { key: "fit/settings", value: { units: "kg", gymTime: 330, _u: 5 }, _u: 5, updated_at: "" } }];
    authCb?.("SIGNED_IN", { user: { id: "u2", email: "x@y.z" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await S2.syncNow()).toBe(true);
    expect(((await db2.fit.get("fit/settings"))!.value as { units: string }).units).toBe("kg");
    expect(((server.rows.get("fit|fit/settings")!.data as { value: { units: string } }).value).units).toBe("kg");
  });
});
