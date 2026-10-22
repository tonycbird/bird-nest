import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import * as H from "../src/head/store";
import { completeBlock, loadDay, toggleStep, updateBlock } from "../src/lib/river";
import { installRiverBridge, putGroceriesOnRiver, putTaskOnRiver, putTasksOnRiver, stepsForTask } from "../src/head/river-bridge";
import { exportAll, restoreAll } from "../src/lib/backup";

const D = "2026-10-15";
beforeEach(async () => {
  C.setNow(new Date(2026, 9, 15, 9, 0, 0));
  await db.delete(); await db.open();
  installRiverBridge();
});

describe("Head ⇄ River", () => {
  it("a task's checklist becomes the block's steps (max 7)", async () => {
    const t = await H.createTask({ title: "Hang shelf", checklist: Array.from({ length: 9 }, (_, i) => ({ id: "c" + i, text: "Step " + i, done: i === 0 })) });
    const s = stepsForTask(t);
    expect(s.length).toBe(7);
    expect(s[0]).toEqual({ label: "Step 0", done: true });
  });

  it("a task with no checklist gets three plain steps, with its estimate", async () => {
    const t = await H.createTask({ title: "Write paper", est: 90 });
    expect(stepsForTask(t).map((x) => x.label)).toEqual(["Get set up", "Work 1h 30m", "Note the next step"]);
  });

  it("finishing the block finishes the task; undo brings both back", async () => {
    const t = await H.createTask({ title: "Call Smith", when: D, checklist: [{ id: "a", text: "Dial", done: false }, { id: "b", text: "Book visit", done: false }] });
    await putTaskOnRiver(t.id, D, 9 * 60);
    let [b] = await loadDay(D);
    expect(b.title).toBe("Call Smith");
    expect(b.start).toBe("09:00");
    expect(b.source_id).toBe(t.id);
    await toggleStep(b.steps[0].id);
    const res = await toggleStep(b.steps[1].id);
    expect(res.blockDone).toBe(true);
    let task = (await db.tasks.get(t.id))!;
    expect(task.status).toBe("done");
    expect(task.checklist.every((c) => c.done)).toBe(true);
    await res.undo();
    [b] = await loadDay(D);
    task = (await db.tasks.get(t.id))!;
    expect(b.status).toBe("open");
    expect(task.status).toBe("open");
    expect(task.checklist.map((c) => c.done)).toEqual([true, false]); // matches the River after undo
  });

  it("undoing an edit on a finished task-block leaves the task done", async () => {
    const t = await H.createTask({ title: "Pay Avista", when: D });
    await putTaskOnRiver(t.id, D, 10 * 60);
    let [b] = await loadDay(D);
    await completeBlock(b.id);
    expect((await db.tasks.get(t.id))!.status).toBe("done");
    [b] = await loadDay(D);
    const undoEdit = await updateBlock(b.id, { start: b.start, end: b.end, kind: b.kind, icon: b.icon, title: "Pay Avista bill", steps: b.steps.map((x) => ({ label: x.label, value: x.value })) });
    await undoEdit();
    expect((await db.tasks.get(t.id))!.status).toBe("done");
  });

  it("a timed task lands at its time; others stack after it; no doubles", async () => {
    const a = await H.createTask({ title: "Dentist", when: D, time: "14:00", est: 60 });
    const b = await H.createTask({ title: "Email Pastor", when: D, est: 15 });
    await putTasksOnRiver([a.id, b.id], D);
    await putTasksOnRiver([a.id, b.id], D);
    const r = await loadDay(D);
    expect(r.length).toBe(2);
    expect(r.find((x) => x.title === "Dentist")!.start).toBe("14:00");
  });

  it("groceries become one shopping block; finishing it checks them off", async () => {
    await H.seedAreas();
    const g = (await db.areas.toArray()).find((a) => a.listMode === "groceries")!;
    for (const x of ["Bananas", "Ground beef", "Milk"]) await H.addGrocery(x, g.id);
    await putGroceriesOnRiver(g.id, D);
    const [b] = await loadDay(D);
    expect(b.steps.map((s) => s.label)).toEqual(["Bananas", "Ground beef", "Milk"]);
    for (const s of b.steps) await toggleStep(s.id);
    const open = (await db.tasks.toArray()).filter((t) => t.grocery && t.status === "open");
    expect(open.length).toBe(0);
  });

  it("backup carries Head data too", async () => {
    await H.seedAreas();
    await H.createTask({ title: "Keep me" });
    const b = await exportAll();
    await db.delete(); await db.open();
    await restoreAll(JSON.parse(JSON.stringify(b)));
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(["Keep me"]);
    expect(await db.areas.count()).toBe(6);
  });
});

describe("River order from Plan My Day", () => {
  it("evening tasks wait for evening; afternoon from noon; timed at their time", async () => {
    const F = "2031-03-12"; // a day that is never "today", so the plan starts at Plan-by time (7:00)
    const e = await H.createTask({ title: "Flashcards", when: F, tod: "evening", est: 30 });
    const a = await H.createTask({ title: "Mow", when: F, tod: "afternoon", est: 60 });
    const m = await H.createTask({ title: "Call supplier", when: F, est: 15 });
    const x = await H.createTask({ title: "Dentist", when: F, time: "10:00", est: 60 });
    await putTasksOnRiver([e.id, a.id, m.id, x.id], F);
    const r = await loadDay(F);
    const at = Object.fromEntries(r.map((b) => [b.title, b.start]));
    expect(at["Call supplier"]).toBe("07:00");
    expect(at["Dentist"]).toBe("10:00");
    expect(at["Mow"]).toBe("12:00");
    expect(at["Flashcards"]).toBe("18:00");
  });
});

describe("Live step sync", () => {
  it("ticking a River step ticks the task's checklist item and note checkbox", async () => {
    const t = await H.createTask({ title: "Prep tile", when: D, checklist: [{ id: "a", text: "Mix thinset", done: false }, { id: "b", text: "Set tile", done: false }] });
    await putTaskOnRiver(t.id, D, 600);
    const [b] = await loadDay(D);
    await toggleStep(b.steps[0].id);
    expect((await db.tasks.get(t.id))!.checklist.map((c) => c.done)).toEqual([true, false]);
    const n = await H.createTask({ title: "Shop", when: D, notes: "- [ ] Grout\n- [ ] Spacers" });
    await putTaskOnRiver(n.id, D, 700);
    const blk = (await loadDay(D)).find((x) => x.title === "Shop")!;
    await toggleStep(blk.steps[1].id);
    expect((await db.tasks.get(n.id))!.notes).toBe("- [ ] Grout\n- [x] Spacers");
  });
});
