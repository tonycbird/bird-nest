import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { addBlock, copyDay, loadDay, moveBlock, nextLine, nowBlock, softDelete, toggleStep, updateBlock } from "../src/lib/river";
import { counts, exportAll, restoreAll, validate } from "../src/lib/backup";

const D = "2026-10-15";

beforeEach(async () => { await db.delete(); await db.open(); });

async function legs() {
  return addBlock({ day: D, start: "05:30", kind: "body", title: "Legs", steps: [
    { label: "Back squat", value: "4×5" }, { label: "RDL", value: "3×8" }, { label: "Calf raise", value: "4×15" }] });
}

describe("River", () => {
  it("orders blocks by start time and names the next step", async () => {
    await addBlock({ day: D, start: "20:00", kind: "head", title: "Study", steps: [{ label: "Read" }] });
    await legs();
    const r = await loadDay(D);
    expect(r.map((b) => b.title)).toEqual(["Legs", "Study"]);
    expect(nextLine(r)).toBe("Next up: Legs · step 1 of 3");
  });

  it("auto-completes a block when its last step is ticked, and the next block becomes now", async () => {
    const { id } = await legs();
    await addBlock({ day: D, start: "20:00", kind: "head", title: "Study", steps: [{ label: "Read" }] });
    let r = await loadDay(D);
    const steps = r.find((b) => b.id === id)!.steps;
    await toggleStep(steps[0].id);
    await toggleStep(steps[1].id);
    r = await loadDay(D);
    expect(nextLine(r)).toBe("Next up: Legs · step 3 of 3");
    const res = await toggleStep(steps[2].id);
    expect(res.blockDone).toBe(true);
    r = await loadDay(D);
    expect(r[0].status).toBe("done");
    expect(nowBlock(r)?.title).toBe("Study");
    await res.undo();
    r = await loadDay(D);
    expect(r[0].status).toBe("open");
    expect(r[0].doneCount).toBe(2);
  });

  it("keeps done steps when a block is edited", async () => {
    const { id } = await legs();
    const s = (await loadDay(D))[0].steps;
    await toggleStep(s[0].id);
    await updateBlock(id, { start: "05:45", kind: "body", title: "Legs A", steps: [
      { label: "Back squat", value: "5×5" }, { label: "Lunge" }] });
    const b = (await loadDay(D))[0];
    expect(b.title).toBe("Legs A");
    expect(b.steps.map((x) => x.label)).toEqual(["Back squat", "Lunge"]);
    expect(b.steps[0].done_at).not.toBeNull();
    expect(b.steps[0].value).toBe("5×5");
  });

  it("caps a block at 7 steps", async () => {
    await addBlock({ day: D, start: "06:00", kind: "life", title: "Many", steps: Array.from({ length: 10 }, (_, i) => ({ label: `S${i}` })) });
    expect((await loadDay(D))[0].steps.length).toBe(7);
  });

  it("moves to tomorrow fresh, and undo brings it back", async () => {
    const { id } = await legs();
    await toggleStep((await loadDay(D))[0].steps[0].id);
    const undo = await moveBlock(id);
    expect((await loadDay(D)).length).toBe(0);
    const t = await loadDay("2026-10-16");
    expect(t[0].doneCount).toBe(0);
    await undo();
    expect((await loadDay(D))[0].doneCount).toBe(1);
  });

  it("delete goes to Trash and undo restores", async () => {
    const { id } = await legs();
    const undo = await softDelete(id);
    expect((await loadDay(D)).length).toBe(0);
    await undo();
    expect((await loadDay(D)).length).toBe(1);
  });

  it("copies a day as fresh blocks", async () => {
    await legs();
    await toggleStep((await loadDay(D))[0].steps[0].id);
    await copyDay(D, "2026-10-16");
    const t = await loadDay("2026-10-16");
    expect(t.length).toBe(1);
    expect(t[0].doneCount).toBe(0);
  });
});

describe("Backup", () => {
  it("round-trips everything exactly", async () => {
    await legs();
    await toggleStep((await loadDay(D))[0].steps[1].id);
    const b = validate(JSON.parse(JSON.stringify(await exportAll())));
    await db.delete(); await db.open();
    expect((await loadDay(D)).length).toBe(0);
    await restoreAll(b);
    const after = await exportAll();
    expect(counts(after)).toEqual(counts(b));
    expect(after.tables.steps).toEqual(b.tables.steps);
    expect((await loadDay(D))[0].doneCount).toBe(1);
  });
  it("rejects a file that isn't a backup", () => {
    expect(() => validate({ hello: 1 })).toThrow();
  });
});
