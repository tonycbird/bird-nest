import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { loadDay, softDelete, updateBlock } from "../src/lib/river";
import { blocksFor, dayShape, defaultWeek, dowOf, dropEvery, fillWeek, keepEvery, loadWeek, resetWeek } from "../src/lib/week";
import { moment, fitOf, tasksThatFit } from "../src/lib/coach";
import type { Task } from "../src/head/types";

const WED = "2026-11-18", THU = "2026-11-19", SAT = "2026-11-21", SUN = "2026-11-22", MON = "2026-11-23", TUE = "2026-11-24";
const titles = async (d: string) => (await loadDay(d)).map((b) => `${b.start} ${b.title}`);
beforeEach(async () => { await db.delete(); await db.open(); });

describe("his usual week", () => {
  it("matches what he said: up at 4:30, work Wed/Thu 8–4:30, Fri 11–5, Sat 2–8, Sun 6:30–5, Tuesday handyman, Monday off, study evenings", () => {
    const w = defaultWeek();
    expect(dowOf(WED)).toBe(3);
    const work = (d: string) => blocksFor(w, d).find((b) => b.key === "work");
    expect([work(WED)?.start, work(WED)?.end]).toEqual(["08:00", "16:30"]);
    expect([work("2026-11-20")?.start, work("2026-11-20")?.end]).toEqual(["11:00", "17:00"]);
    expect([work(SAT)?.start, work(SAT)?.end]).toEqual(["14:00", "20:00"]);
    expect([work(SUN)?.start, work(SUN)?.end]).toEqual(["06:30", "17:00"]);
    expect(work(MON)).toBeUndefined();
    expect(blocksFor(w, TUE).some((b) => b.title === "Handyman jobs")).toBe(true);
    for (let i = 0; i < 7; i++) expect(w.days[i][0]).toMatchObject({ key: "morning", start: "04:30" });
    expect(blocksFor(w, SAT).some((b) => b.key === "study")).toBe(false); // works till 8
    expect(blocksFor(w, THU).find((b) => b.key === "wind")?.steps?.[0].label).toBe("Gym bag by the door"); // Friday is a gym day
    expect(blocksFor(w, SAT).find((b) => b.key === "wind")?.steps?.[0].label).toBe("Phone on charger"); // no gym Sunday
    // no two blocks of a day overlap, and each ends after it starts
    for (const day of w.days) {
      const s = [...day].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < s.length; i++) {
        expect(s[i].end > s[i].start).toBe(true);
        if (i) expect(s[i].start >= s[i - 1].end).toBe(true);
      }
    }
  });

  it("lands on the River once; the gym drive waits for Body; what he takes off stays off", async () => {
    expect(await fillWeek(WED, undefined)).toBe(8); // Body not ready yet: everything but the gym drive
    expect(await titles(WED)).toEqual(["04:30 Morning", "07:40 Drive to work", "08:00 Work", "16:30 Drive home", "17:00 Home · Abby + baby", "19:00 Shutdown", "19:30 Study", "20:30 Wind down"]);
    expect(await fillWeek(WED, "06:15")).toBe(1); // ends when Body's workout starts
    expect((await titles(WED))[1]).toBe("05:55 Drive to the gym");
    expect(await fillWeek(WED, "06:00")).toBe(0);
    const study = (await loadDay(WED)).find((b) => b.title === "Study")!;
    expect(study.steps.map((s) => s.label)).toEqual(["Open this week's lesson", "Read", "Write 3 notes"]);
    await softDelete(study.id);
    expect(await fillWeek(WED, "06:00")).toBe(0);
    expect((await titles(WED)).includes("19:30 Study")).toBe(false);
    expect(await fillWeek(MON, null)).toBe(4); // a rest day: no gym drive
  });

  it("'Every Wednesday' keeps his change, and today's untouched blocks follow; undo puts it back", async () => {
    await fillWeek(WED, null);
    await fillWeek(THU, null);
    const work = (await loadDay(WED)).find((b) => b.title === "Work")!;
    await updateBlock(work.id, { start: "08:00", end: "17:00", kind: "head", title: "Work", icon: "briefcase", steps: [] });
    const undo = await keepEvery({ ...work, end: "17:00" }, [], WED);
    expect(blocksFor(await loadWeek(), "2026-11-25").find((b) => b.key === "work")?.end).toBe("17:00");
    expect(blocksFor(await loadWeek(), THU).find((b) => b.key === "work")?.end).toBe("16:30"); // only Wednesdays
    await undo();
    expect(blocksFor(await loadWeek(), "2026-11-25").find((b) => b.key === "work")?.end).toBe("16:30");
  });

  it("'Not on Wednesdays' takes it off the week and off today; a block he made joins the week", async () => {
    await fillWeek(WED, null);
    const study = (await loadDay(WED)).find((b) => b.title === "Study")!;
    const undo = await dropEvery(study, WED);
    expect(blocksFor(await loadWeek(), WED).some((b) => b.key === "study")).toBe(false);
    expect((await titles(WED)).includes("19:30 Study")).toBe(false);
    await undo();
    expect((await titles(WED)).includes("19:30 Study")).toBe(true);
    // a block he added himself → every Wednesday
    const { addBlock } = await import("../src/lib/river");
    const { id } = await addBlock({ day: WED, start: "12:00", end: "12:30", kind: "life", title: "Lunch walk", steps: [] });
    await keepEvery((await db.blocks.get(id))!, [], WED);
    expect(blocksFor(await loadWeek(), "2026-11-25").some((b) => b.title === "Lunch walk")).toBe(true);
    expect(await fillWeek(WED, null)).toBe(0); // it's already there: not twice
  });

  it("a change to the week moves tomorrow's untouched blocks, never ones he changed or ticked", async () => {
    await fillWeek(THU, null);
    const before = await loadDay(THU);
    const study = before.find((b) => b.title === "Study")!;
    const { toggleStep } = await import("../src/lib/river");
    await toggleStep(study.steps[0].id); // he started studying
    const w = await loadWeek();
    const next = { v: 1 as const, days: w.days.map((d, i) => (i === 4 ? d.map((b) => (b.key === "study" || b.key === "morning" ? { ...b, start: b.key === "morning" ? "05:00" : "19:45" } : b)) : d)) };
    const { saveWeek } = await import("../src/lib/week");
    await saveWeek(next, WED);
    const after = await loadDay(THU);
    expect(after.find((b) => b.title === "Morning")?.start).toBe("05:00");
    expect(after.find((b) => b.title === "Study")?.start).toBe("19:30");
    await resetWeek(WED);
    expect((await loadDay(THU)).find((b) => b.title === "Morning")?.start).toBe("04:30");
  });

  it("the morning buzz says the day's shape and the first step", () => {
    const w = defaultWeek();
    expect(dayShape(w, WED, { title: "Shoulders & Abs", start: "06:00" })).toEqual({ title: "Shoulders & Abs at 6 · work 8–4:30 · study 7:30", body: "First: Morning — water + coffee.", at: "04:30" });
    expect(dayShape(w, TUE, null).title).toBe("Handyman jobs · study 7:30");
    expect(dayShape(w, MON, null).title).toBe("Day off · study 7:30");
  });
});

describe("Today as a coach", () => {
  const B = (id: string, start: string, end: string | null, extra: Record<string, unknown> = {}) => ({ id, day: WED, start, end, kind: "head", icon: "x", title: id, status: "open", steps: [], doneCount: 0, created_at: "", updated_at: "", deleted_at: null, done_at: null, ...extra }) as never;
  const day = [B("Morning", "04:30", "05:30"), B("Drive", "07:40", "08:00"), B("Work", "08:00", "16:30"), B("Chapel", "08:30", "09:00"), B("Lunch", "12:00", "13:00"), B("Home", "17:00", "19:00")];
  const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); return moment(day, h * 60 + m); };
  it("now is what's running by the clock; the most specific block wins", () => {
    expect(at("07:45").now?.id).toBe("Drive");
    expect([at("07:45").next?.id, at("07:45").later?.id]).toEqual(["Work", "Chapel"]);
    expect(at("08:40").now?.id).toBe("Chapel");
    expect(at("08:40").next?.id).toBe("Lunch");
    expect(at("09:10").now?.id).toBe("Work");
    expect(at("13:05").next?.id).toBe("Home");
  });
  it("between blocks it's free time until the next; before the day and after it are rest", () => {
    expect(at("06:00").free).toEqual({ from: 330, until: 460 });
    expect(at("03:00").free).toEqual({ from: null, until: 270 });
    expect(at("20:00").over).toBe(true);
    expect(at("20:00").now).toBeNull();
  });
  it("a block he finished or skipped isn't now any more", () => {
    const m = moment([B("Lift", "06:00", "07:00", { status: "done" }), B("Work", "08:00", "16:30")], 6 * 60 + 30);
    expect(m.now).toBeNull();
    expect(m.free).toEqual({ from: 390, until: 480 });
  });
  it("calls fit the drive, jobs fit handyman day, anything fits free time; family and work stay clear", () => {
    const T = (title: string, extra: Partial<Task> = {}) => ({ id: title, title, grocery: null, due: null, ...extra }) as Task;
    const tasks = [T("Call Dave back"), T("Fix the Jones gate"), T("Pay Prime Visa", { due: "2026-11-20" }), T("Read chapter 4"), T("Eggs", { grocery: { cat: "x", store: null } })];
    const area = () => "";
    expect(tasksThatFit(fitOf({ icon: "drive", title: "Drive to work" }), tasks, area).map((t) => t.title)).toEqual(["Call Dave back"]);
    expect(tasksThatFit(fitOf({ icon: "job", title: "Handyman jobs" }), tasks, area).map((t) => t.title)).toEqual(["Fix the Jones gate"]);
    expect(tasksThatFit(fitOf({ icon: "study", title: "Study" }), tasks, area).map((t) => t.title)).toEqual(["Read chapter 4"]);
    expect(tasksThatFit(fitOf(null), tasks, area).map((t) => t.title)).toEqual(["Pay Prime Visa", "Call Dave back", "Fix the Jones gate"]);
    expect(tasksThatFit(fitOf({ icon: "heart", title: "Home · Abby + baby" }), tasks, area)).toEqual([]);
    expect(tasksThatFit(fitOf({ icon: "briefcase", title: "Work" }), tasks, area)).toEqual([]);
  });
});
