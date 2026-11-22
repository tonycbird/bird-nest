import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as C from "../src/head/core/clearhead.js";
import { findRange, parseQuick } from "../src/head/ranges";
import { db } from "../src/lib/db";
import { loadDay } from "../src/lib/river";
import { fillWeek } from "../src/lib/week";
import { freeIn, laneOf, moveSlot, plan, slideUnfinished, slotTasks } from "../src/lib/slots";
import * as H from "../src/head/store";

const THU = "2026-11-19";
const at = (h: number, m = 0) => h * 60 + m;
beforeEach(async () => { C.setNow(new Date(2026, 10, 19, 7, 0)); await db.delete(); await db.open(); });

describe("a time range is a start and a length", () => {
  const r = (t: string) => { const x = findRange(t); return x && `${x.from}-${x.to}`; };
  it("reads the ways he says it", () => {
    expect(r("Dance rehearsal tonight 6-7")).toBe("18:00-19:00");
    expect(r("Dance rehearsal 6-7pm")).toBe("18:00-19:00");
    expect(r("Christmas rehearsal 6pm-7pm today")).toBe("18:00-19:00");
    expect(r("Staff thing 11-1pm")).toBe("11:00-13:00");
    expect(r("Bid walk-through tomorrow 9:30 to 11")).toBe("09:30-11:00");
    expect(r("Meet Thomas 6–7am Wednesday")).toBe("06:00-07:00");
    expect(r("Lunch with Abby 12-1 today")).toBe("12:00-13:00");
  });
  it("leaves counts and dates alone", () => {
    expect(r("Buy 6-7 bags of mulch")).toBeNull();
    expect(r("2x4s 8-10 ft")).toBeNull();
  });
  it("quick add: the time, the length, a clean title, a colored mark where he typed it", () => {
    const p = parseQuick("Dance rehearsal tonight 6-7", {});
    expect(p.title).toBe("Dance rehearsal");
    expect(p.fields).toMatchObject({ when: THU, time: "18:00", est: 60 });
    const tok = p.tokens.find((t) => t.type === "time")!;
    expect("Dance rehearsal tonight 6-7".slice(tok.start, tok.end)).toBe("6-7");
    expect(tok.label).toBe("6–7pm");
  });
});

describe("where a task belongs", () => {
  it("calls wait for the drive, home for free time, class for study, the rest is work", () => {
    expect(laneOf({ title: "Call Thomas about Dec 2", grocery: null })).toBe("call");
    expect(laneOf({ title: "Mow the lawn", grocery: null })).toBe("home");
    expect(laneOf({ title: "Read chapter 6", grocery: null })).toBe("study");
    expect(laneOf({ title: "Fix the gate latch", grocery: null }, "Handyman Business")).toBe("handyman");
    expect(laneOf({ title: "Order furnace filters for the sanctuary", grocery: null })).toBe("work");
    expect(laneOf({ title: "Schedule the carpet cleaners", grocery: null })).toBe("work");
  });
});

describe("planning the work day", () => {
  it("free stretches go around meetings", () => {
    expect(freeIn({ from: at(8), to: at(16, 30) }, [{ from: at(8, 30), to: at(9, 30) }, { from: at(12), to: at(13) }]))
      .toEqual([{ from: at(8), to: at(8, 30) }, { from: at(9, 30), to: at(12) }, { from: at(13), to: at(16, 30) }]);
  });
  it("in the order he said them, first stretch that fits; what doesn't fit is over", () => {
    const p = plan(
      [{ id: "a", mins: 30, lane: "work" }, { id: "b", mins: 60, lane: "work" }, { id: "c", mins: 30, lane: "call" }, { id: "d", mins: 120, lane: "work" }, { id: "e", mins: 120, lane: "work" }],
      [{ from: at(8), to: at(12) }], [{ from: at(8, 30), to: at(9, 30) }], at(7, 50));
    expect(p.placed).toEqual([{ id: "a", from: at(8), to: at(8, 30) }, { id: "b", from: at(9, 30), to: at(10, 30) }, { id: "d", from: at(10, 30), to: at(12) }]);
    expect(p.over).toEqual(["e"]);
    expect(p.waiting).toEqual(["c"]);
  });
});

describe("the morning dump, on a Thursday", () => {
  const names = () => ({ area: "", project: "" });
  it("work things get their own times inside Work; a call waits; what doesn't fit goes to tomorrow; undo takes it all back", async () => {
    await fillWeek(THU, null);
    const mk = (title: string, est?: number) => H.createTask({ title, when: THU, est: est ?? null });
    const ts = [await mk("Order furnace filters", 30), await mk("Call Thomas for Dec 2 details"), await mk("Walk the roof with Bobby", 60)];
    for (let i = 0; i < 8; i++) ts.push(await mk("Paperwork pile " + (i + 1), 60));
    const r = await slotTasks(ts.map((t) => t.id), THU, at(7), names);
    const day = await loadDay(THU);
    const slotted = day.filter((b) => b.slot);
    expect(slotted[0]).toMatchObject({ start: "08:00", end: "08:30", title: "Order furnace filters" });
    expect(slotted[1]).toMatchObject({ start: "08:30", end: "09:30", title: "Walk the roof with Bobby" });
    expect(slotted.every((b) => b.start >= "08:00" && b.end! <= "16:30")).toBe(true);
    expect(r.waiting).toEqual([{ id: ts[1].id, lane: "call" }]);
    expect(r.over.length).toBe(1); // 8½ h of work hours, 9½ h of work
    expect((await db.tasks.get(r.over[0]))?.when).toBe("2026-11-20");
    await r.undo();
    expect((await loadDay(THU)).filter((b) => b.slot)).toHaveLength(0);
    expect((await db.tasks.get(r.over[0]))?.when).toBe(THU);
  });
  it("meetings already on the River are worked around", async () => {
    await fillWeek(THU, null);
    const { addBlock } = await import("../src/lib/river");
    await addBlock({ day: THU, start: "08:30", end: "09:00", kind: "head", title: "Staff Chapel", steps: [], source_type: "calendar", source_id: "x" });
    const t1 = await H.createTask({ title: "Email the alarm company", when: THU, est: 45 });
    await slotTasks([t1.id], THU, at(7), names);
    expect((await loadDay(THU)).find((b) => b.slot)).toMatchObject({ start: "09:00", end: "09:45" });
  });
  it("one that runs over slides to the next open time; earlier/later swap; tomorrow takes it off today", async () => {
    await fillWeek(THU, null);
    const a = await H.createTask({ title: "Order filters", when: THU, est: 30 });
    const b = await H.createTask({ title: "Fix sanctuary door", when: THU, est: 30 });
    await slotTasks([a.id, b.id], THU, at(7), names);
    expect(await slideUnfinished(THU, at(8, 35))).toBe(1); // filters (8:00–8:30) not done → next open time
    let day = (await loadDay(THU)).filter((x) => x.slot);
    expect(day.map((x) => `${x.start} ${x.title}`)).toEqual(["08:30 Fix sanctuary door", "09:00 Order filters"]);
    const door = day[0];
    await moveSlot(door.id, "later");
    day = (await loadDay(THU)).filter((x) => x.slot);
    expect(day.map((x) => x.title)).toEqual(["Order filters", "Fix sanctuary door"]);
    await moveSlot(door.id, "tomorrow");
    expect((await loadDay(THU)).filter((x) => x.slot).map((x) => x.title)).toEqual(["Order filters"]);
    expect((await db.tasks.get(b.id))?.when).toBe("2026-11-20");
  });
});

describe("the dump reads dates that are the topic, not the day", () => {
  it("'text Thomas about Dec 2 details' is for today, about Dec 2", async () => {
    const { planDump } = await import("../src/head/dump-sort");
    const data = await H.loadData();
    const s = await H.loadSettings();
    const it = planDump("text Thomas about Dec 2 details today", data, s).items[0];
    expect(it.title).toMatch(/Dec 2/);
    expect(it.dest).toBe("today");
  });
  it("'dance rehearsal tonight 6-7' lands at 6 for an hour", async () => {
    const { planDump } = await import("../src/head/dump-sort");
    const it = planDump("dance rehearsal tonight 6-7", await H.loadData(), await H.loadSettings()).items[0];
    expect([it.title, it.time, it.est, it.dest]).toEqual(["Dance rehearsal", "18:00", 60, "today"]);
  });
});

describe("how long, said in words", () => {
  it("'30 min', 'for an hour', '1.5 hours', '2 hrs' become the length; the title stays clean", () => {
    const q = (t: string) => { const p = parseQuick(t, {}); return [p.title, p.fields.est]; };
    expect(q("Order furnace filters for the sanctuary 30 min")).toEqual(["Order furnace filters for the sanctuary", 30]);
    expect(q("Walk the roof with Bobby for an hour")).toEqual(["Walk the roof with Bobby", 60]);
    expect(q("Bid 1.5 hours tomorrow")).toEqual(["Bid", 90]);
    expect(q("Paint trim 2 hrs")).toEqual(["Paint trim", 120]);
    expect(q("Buy 4 mowers")).toEqual(["Buy 4 mowers", undefined]);
    expect(parseQuick("call the bank in 2 hours", {}).fields.est).toBeUndefined();
  });
});

describe("things dumped ahead of time get their times on the day", () => {
  it("Sunday's 'tasks for Tuesday' land in Tuesday's handyman stretch the first time Nest opens Tuesday; once", async () => {
    const { slotToday } = await import("../src/lib/slots");
    const TUESDAY = "2026-11-24";
    C.setNow(new Date(2026, 10, 24, 6, 0));
    await fillWeek(TUESDAY, null);
    let order = 1; // the dump keeps the order he said them in
    for (const title of ["Call Chris about the leak", "Empty the baptismal", "Clean the cafeteria upstairs"]) await H.createTask({ title, when: TUESDAY, order: order++ });
    expect(await slotToday(TUESDAY, at(6))).toBe(2); // the call waits for free time
    const day = (await loadDay(TUESDAY)).filter((b) => b.slot);
    expect(day.map((b) => `${b.start} ${b.title}`)).toEqual(["07:30 Empty the baptismal", "08:00 Clean the cafeteria upstairs"]);
    expect(await slotToday(TUESDAY, at(6))).toBe(0);
  });
});
