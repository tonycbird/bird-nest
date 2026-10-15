import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import * as H from "../src/head/store";
import { loadDay, toggleStep } from "../src/lib/river";
import { addGroceries, fitDb, importFitness, readFitnessBackup, type FitPlan } from "../src/body/host";
import { capSteps, missingFromRiver, putPlanOnRiver, syncPlanToRiver } from "../src/body/river-body";
import { exportAll, restoreAll } from "../src/lib/backup";

const F = "2031-03-13"; // a future day, so "now" never moves the blocks
const plan = (done: boolean[] = []): FitPlan => ({
  date: F, workout: "Legs",
  blocks: [
    { key: "warm", icon: "🔥", title: "Warm-up", start: 300, minutes: 30, steps: [{ label: "Walk", value: "10 min", done: false }, { label: "Stair climber", value: "10 min", done: false }] },
    { key: "main", icon: "🏋", title: "Legs", start: 330, minutes: 55, wid: "legs",
      steps: ["Back Squat", "Romanian Deadlift", "Leg Press", "Walking Lunge", "Leg Curl", "Leg Extension", "Calf Raise", "Plank"].map((label, i) => ({ label, value: "3 × 8-10", done: !!done[i] })) },
    { key: "cool", icon: "🧘", title: "Cool-down", start: 385, minutes: 35, steps: [{ label: "Pigeon", value: "45s", done: false }] },
  ],
});

beforeEach(async () => {
  C.setNow(new Date(2026, 9, 15, 9, 0, 0));
  await db.delete(); await db.open();
});

describe("Body storage (the old app's db, answered by Nest)", () => {
  it("docs and months round-trip through the fit table", async () => {
    await fitDb.doc("fit/settings").set({ units: "lb", _u: 5 });
    await fitDb.doc("logs/2026-10").set({ sessions: { a: { date: "2026-10-01" } }, _u: 6 });
    const fit = await fitDb.collection("fit").get();
    expect(fit.docs.map((d) => d.id)).toEqual(["settings"]);
    expect(fit.docs[0].data()).toEqual({ units: "lb", _u: 5 });
    const logs = await fitDb.collection("logs").get();
    expect(logs.docs[0].id).toBe("2026-10");
    await fitDb.doc("logs/2026-10").delete();
    expect((await fitDb.collection("logs").get()).docs.length).toBe(0);
  });

  it("a Bird Fitness backup imports; a wrong file is refused", async () => {
    expect(() => readFitnessBackup({ app: "clearhead" })).toThrow(/Bird Fitness/);
    const b = readFitnessBackup({ app: "bird-fitness", v: 1, docs: { settings: { units: "kg" }, program: { workouts: [] } }, logs: { "2026-09": { sessions: { s1: {}, s2: {} } }, "2026-10": { sessions: { s3: {} } } } });
    const r = await importFitness(b);
    expect(r).toEqual({ sessions: 3, months: 2 });
    expect((await db.fit.get("fit/settings"))!.value.units).toBe("kg");
    expect((await db.fit.get("logs/2026-09"))!._u).toBeGreaterThan(0);
  });

  it("Body data is in the Nest backup, and an older backup without it leaves it alone", async () => {
    await fitDb.doc("fit/settings").set({ units: "lb", _u: 1 });
    const b = await exportAll();
    expect(b.tables.fit.length).toBe(1);
    const old = JSON.parse(JSON.stringify(b)); delete old.tables.fit;
    await restoreAll(old);
    expect(await db.fit.count()).toBe(1);
    await db.fit.clear();
    await restoreAll(b);
    expect(await db.fit.count()).toBe(1);
  });
});

describe("Groceries: one list, in Head", () => {
  it("returns null when Head has no grocery list", async () => {
    expect(await addGroceries([{ name: "Eggs", amt: "1 dozen" }])).toBeNull();
  });
  it("adds to Head groceries with amounts and skips what's already there", async () => {
    await H.seedAreas();
    await H.addGrocery("eggs");
    const n = await addGroceries([{ name: "Eggs", amt: "1 dozen" }, { name: "Chicken thighs", amt: "2 lb" }, { name: "Spinach", amt: "1 bag" }]);
    expect(n).toBe(2);
    expect(await addGroceries([{ name: "Chicken thighs", amt: "3 lb" }])).toBe(0);
    const titles = (await db.tasks.toArray()).map((t) => t.title).sort();
    expect(titles).toEqual(["Chicken thighs · 2 lb", "Spinach · 1 bag", "eggs"]);
  });
});

describe("Body ⇄ River", () => {
  it("more than 7 lifts fold into the 7th step", () => {
    const s = capSteps(plan().blocks[1].steps);
    expect(s.length).toBe(7);
    expect(s[6]).toEqual({ label: "Calf Raise + Plank", value: "2 more", done: false });
  });

  it("a gym day becomes Warm-up, the workout and Cool-down at the gym time; adding twice adds nothing", async () => {
    await putPlanOnRiver(plan());
    const day = await loadDay(F);
    expect(day.map((b) => [b.start, b.icon, b.title, b.steps.length, b.kind])).toEqual([
      ["05:00", "🔥", "Warm-up", 2, "body"], ["05:30", "🏋", "Legs", 7, "body"], ["06:25", "🧘", "Cool-down", 1, "body"],
    ]);
    expect(day[1].steps[0]).toMatchObject({ label: "Back Squat", value: "3 × 8-10" });
    expect(await missingFromRiver(plan())).toEqual([]);
    await putPlanOnRiver(plan());
    expect((await loadDay(F)).length).toBe(3);
  });

  it("undo takes the blocks back off", async () => {
    const undo = await putPlanOnRiver(plan());
    await undo();
    expect((await loadDay(F)).length).toBe(0);
  });

  it("logging in Body ticks River steps; a River tick is never undone by the sync", async () => {
    await putPlanOnRiver(plan());
    let main = (await loadDay(F))[1];
    await toggleStep(main.steps[4].id); // ticked by hand on the River
    await syncPlanToRiver(plan([true, true]));
    main = (await loadDay(F))[1];
    expect(main.steps.map((s) => !!s.done_at)).toEqual([true, true, false, false, true, false, false]);
    await syncPlanToRiver(plan([true, true, true, true, true, true, true, true]));
    main = (await loadDay(F))[1];
    expect(main.status).toBe("done");
  });

  it("a finished session finishes the block; a swap renames untouched steps", async () => {
    await putPlanOnRiver(plan());
    const p = plan(); p.blocks[1].steps[0] = { label: "Hack Squat", value: "3 × 8-10 · 180", done: false };
    await syncPlanToRiver(p);
    expect((await loadDay(F))[1].steps[0]).toMatchObject({ label: "Hack Squat", value: "3 × 8-10 · 180" });
    p.blocks[1].done = true;
    await syncPlanToRiver(p);
    const main = (await loadDay(F))[1];
    expect(main.status).toBe("done");
    expect(main.steps.every((s) => s.done_at)).toBe(true);
  });
});
