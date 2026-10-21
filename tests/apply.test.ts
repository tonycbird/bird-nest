import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Proposal } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import * as H from "../src/head/store";
import { addBlock, loadDay } from "../src/lib/river";
import { approve, decline } from "../src/lib/apply";

const D = "2031-03-13";
const P = (kind: string, payload: Record<string, unknown>, extra: Partial<Proposal> = {}): Proposal => ({
  id: crypto.randomUUID(), kind, payload, reason: "why", status: "pending", needs_google: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), day_key: D, ...extra,
});
async function put(p: Proposal) { await db.proposals.put(p); return p; }

beforeEach(async () => {
  C.setNow(new Date(2026, 9, 17, 9, 0, 0));
  await db.delete(); await db.open();
});

describe("✓ on Claude's proposals", () => {
  it("day plan replaces the River's open blocks, keeps done ones, sets the sentence; undo puts it back", async () => {
    await addBlock({ day: D, start: "05:00", kind: "body", title: "Old gym", steps: [{ label: "a", done: true }] }); // done
    await addBlock({ day: D, start: "09:00", kind: "head", title: "Old open", steps: [{ label: "x" }] });
    const p = await put(P("day_plan", { sentence: "Legs first, then the quote.", blocks: [
      { start: "05:00", end: "06:00", kind: "body", icon: "🏋", title: "Legs", steps: [{ label: "Squat", value: "3×8 · 225" }, { label: "RDL" }] },
      { start: "08:30", kind: "head", title: "Write quote", steps: [{ label: "Open" }, { label: "Do 25 min" }, { label: "Note next step" }], source_type: "task", source_id: "t1" },
      { start: "bad", title: "skipped: bad time" },
    ] }));
    const undo = await approve(p);
    let day = await loadDay(D);
    expect(day.map((b) => b.title)).toEqual(["Old gym", "Legs", "Write quote"]);
    expect(day[1].steps.map((s) => [s.label, s.value])).toEqual([["Squat", "3×8 · 225"], ["RDL", null]]);
    expect(day[2].source_type).toBe("task");
    expect((await db.days.get(D))?.sentence).toBe("Legs first, then the quote.");
    expect((await db.proposals.get(p.id))?.status).toBe("applied");
    expect((await db.outbox.toArray()).map((o) => o.patch.status)).toEqual(["applied"]);
    await undo();
    day = await loadDay(D);
    expect(day.map((b) => b.title)).toEqual(["Old gym", "Old open"]);
    expect((await db.days.get(D))?.sentence ?? null).toBe(null);
    expect((await db.proposals.get(p.id))?.status).toBe("pending");
  });

  it("✕ leaves the River alone", async () => {
    await addBlock({ day: D, start: "09:00", kind: "head", title: "Mine", steps: [] });
    const p = await put(P("day_plan", { blocks: [{ start: "05:00", title: "Theirs", steps: [] }] }));
    await decline(p);
    expect((await loadDay(D)).map((b) => b.title)).toEqual(["Mine"]);
    expect((await db.proposals.get(p.id))?.status).toBe("declined");
  });

  it("a mail task lands in the Inbox with its link; undo removes it", async () => {
    const p = await put(P("task", { title: "Send Dave the tile quote", due: "2031-03-14", link: "https://mail.google.com/x" }));
    const undo = await approve(p);
    const t = (await db.tasks.toArray()).find((x) => x.title === "Send Dave the tile quote")!;
    expect(t.due).toBe("2031-03-14");
    expect(t.notes).toContain("https://mail.google.com/x");
    await undo();
    expect((await db.tasks.get(t.id))?.status ?? "gone").not.toBe("open");
  });

  it("rollover moves to tomorrow, and repeat offenders to Someday", async () => {
    const a = await H.createTask({ title: "A", when: D });
    const b = await H.createTask({ title: "B", when: D });
    const undo = await approve(await put(P("rollover", { to: "2031-03-14", move: [a.id], someday: [b.id] })));
    expect((await db.tasks.get(a.id))?.when).toBe("2031-03-14");
    expect((await db.tasks.get(b.id))?.someday).toBe(true);
    await undo();
    expect((await db.tasks.get(a.id))?.when).toBe(D);
    expect((await db.tasks.get(b.id))?.someday).toBeFalsy();
  });

  it("groceries go to Head's list without duplicates", async () => {
    await H.seedAreas();
    await H.addGrocery("Eggs");
    const undo = await approve(await put(P("grocery", { items: [{ name: "Eggs", amt: "1 dozen" }, { name: "Spinach", amt: "1 bag" }] })));
    const titles = (await db.tasks.toArray()).map((t) => t.title).sort();
    expect(titles).toEqual(["Eggs", "Spinach · 1 bag"]);
    await undo();
    expect((await db.tasks.toArray()).filter((t) => t.status === "open").map((t) => t.title)).toEqual(["Eggs"]);
  });

  it("recap is saved on the day; weekly review becomes a block", async () => {
    await approve(await put(P("recap", { lines: ["✓ Legs done", "6 of 8 steps", "Quote moved to tomorrow", "extra line dropped"] })));
    expect((await db.days.get(D))?.recap).toEqual(["✓ Legs done", "6 of 8 steps", "Quote moved to tomorrow"]);
    await approve(await put(P("weekly_review", { prompts: ["Clear inbox", "Check projects"], start: "17:50" })));
    const wr = (await loadDay(D)).find((b) => b.title === "Weekly review")!;
    expect(wr.start).toBe("17:50");
    expect(wr.steps.length).toBe(2);
  });

  it("a calendar booking waits for Claude's applier (approved, not applied)", async () => {
    const p = await put(P("calendar_book", { title: "Gym", day: D, start: "05:00", end: "06:15" }, { needs_google: true }));
    await approve(p);
    expect((await db.proposals.get(p.id))?.status).toBe("approved");
    expect(await loadDay(D)).toEqual([]);
  });

  it("an unknown kind is refused, nothing changes", async () => {
    const p = await put(P("launch_rockets", {}));
    await expect(approve(p)).resolves.toBeTypeOf("function"); // unknown kinds just get approved for Claude to handle
    expect((await db.proposals.get(p.id))?.status).toBe("approved");
  });
});
