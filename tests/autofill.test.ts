import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type CalEvent, type Proposal } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import { loadDay, softDelete } from "../src/lib/river";

vi.mock("../src/lib/time", async (orig) => ({ ...(await orig<typeof import("../src/lib/time")>()), today: () => "2026-10-22" }));
const { calendarNames, fillCalendar, pickedCalendars, settleProposals, DAY_DEFAULTS } = await import("../src/lib/autofill");

const D = "2026-10-22";
const ev = (id: string, title: string, start: string | null, calendar: string | null): CalEvent => ({ id: id + "|" + D, day: D, start, end: start ? "08:00" : null, title, all_day: !start, calendar });
const P = (kind: string, payload: Record<string, unknown>, extra: Partial<Proposal> = {}): Proposal => ({
  id: crypto.randomUUID(), kind, payload, reason: "why", status: "pending", needs_google: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), day_key: D, ...extra,
});
beforeEach(async () => { C.setNow(new Date(2026, 9, 22, 6, 0)); await db.delete(); await db.open(); });

describe("Claude's finds go straight in", () => {
  it("a mail task lands in the Inbox by itself; a day plan, a recap and a gym booking are set aside", async () => {
    const task = P("task", { title: "Send Dave the tile quote", link: "https://mail.google.com/x" });
    const plan = P("day_plan", { sentence: "x", blocks: [{ start: "05:00", title: "Legs", kind: "body" }] });
    const gym = P("calendar_book", { title: "Gym" }, { needs_google: true });
    const recap = P("recap", { lines: ["a"] });
    await db.proposals.bulkPut([task, plan, gym, recap]);
    expect(await settleProposals()).toBe(1);
    const t = (await db.tasks.toArray()).find((x) => x.title === "Send Dave the tile quote");
    expect(t && !t.areaId).toBe(true); // the Inbox
    expect((await db.proposals.get(task.id))?.status).toBe("applied");
    for (const p of [plan, gym, recap]) expect((await db.proposals.get(p.id))?.status).toBe("declined");
    expect(await loadDay(D)).toHaveLength(0); // the plan never replaced the River
  });
  it("groceries with no grocery list yet are set aside, never stuck", async () => {
    const g = P("grocery", { items: [{ name: "Eggs" }] });
    await db.proposals.put(g);
    await settleProposals();
    expect((await db.proposals.get(g.id))?.status).toBe("declined");
  });
});

describe("his own calendar fills the River", () => {
  it("only the calendars he picked (by default the ones that look like his), timed events only", () => {
    const names = calendarNames([ev("a", "x", "07:00", "anthony@example.com"), ev("b", "y", "09:00", "The Heart Staff"), ev("c", "z", null, null)]);
    expect(names).toEqual(["The Heart Staff", "anthony@example.com"]);
    expect([...pickedCalendars(DAY_DEFAULTS, names)]).toEqual(["anthony@example.com"]);
    expect([...pickedCalendars({ ...DAY_DEFAULTS, calendars: ["The Heart Staff"] }, names)]).toEqual(["The Heart Staff"]);
  });
  it("an event lands once; one he takes off stays off; shared and all-day ones stay as lines", async () => {
    await db.calendar.bulkPut([ev("a", "Coffee with Landyn", "07:00", "anthony@example.com"), ev("b", "Freedom Night", "18:00", "The Heart Staff"), ev("c", "Halloween", null, "anthony@example.com")]);
    expect(await fillCalendar(D)).toBe(1);
    const [b] = await loadDay(D);
    expect([b.title, b.start, b.source_type]).toEqual(["Coffee with Landyn", "07:00", "calendar"]);
    expect(await fillCalendar(D)).toBe(0); // once
    await softDelete(b.id);
    expect(await fillCalendar(D)).toBe(0); // taken off: stays off
    expect(await loadDay(D)).toHaveLength(0);
  });
  it("with no calendar names yet, nothing moves by itself", async () => {
    await db.calendar.put(ev("a", "Dentist", "12:00", null));
    expect(await fillCalendar(D)).toBe(0);
  });
});
