import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type CalEvent } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import { acceptEvent, acceptedOn } from "../src/lib/calendar-accept";
import { loadDay, softDelete } from "../src/lib/river";

const D = "2026-10-22";
const ev = (id: string, title: string, start: string | null, end: string | null): CalEvent => ({ id, day: D, start, end, title, all_day: !start });
beforeEach(async () => { C.setNow(new Date(2026, 9, 22, 9, 0)); await db.delete(); await db.open(); });

describe("calendar items: hold to make them yours", () => {
  it("a timed item becomes a River block at its time; undo takes it back", async () => {
    const e = ev("g1|" + D, "Market at The Heart", "16:00", "20:00");
    await db.calendar.put(e);
    expect((await acceptedOn(D)).has(e.id)).toBe(false);
    const undo = await acceptEvent(e);
    const [b] = await loadDay(D);
    expect([b.title, b.start, b.end, b.source_type, b.source_id]).toEqual(["Market at The Heart", "16:00", "20:00", "calendar", e.id]);
    expect((await acceptedOn(D)).has(e.id)).toBe(true);
    await undo();
    expect(await loadDay(D)).toHaveLength(0);
    expect((await acceptedOn(D)).has(e.id)).toBe(false);
  });
  it("taking the block off the River un-accepts it", async () => {
    const e = ev("g2|" + D, "Morning Prayer", "07:00", null);
    await acceptEvent(e);
    const [b] = await loadDay(D);
    expect(b.end).toBe("07:30"); // no end: half an hour
    await softDelete(b.id);
    expect((await acceptedOn(D)).has(e.id)).toBe(false);
  });
  it("an all-day item becomes a task that day", async () => {
    const e = ev("g3|" + D, "Rischa Off", null, null);
    const undo = await acceptEvent(e);
    const t = (await db.tasks.toArray())[0];
    expect([t.title, t.when, (t as { calId?: string }).calId]).toEqual(["Rischa Off", D, e.id]);
    expect((await acceptedOn(D)).has(e.id)).toBe(true);
    await undo();
    expect((await acceptedOn(D)).has(e.id)).toBe(false);
  });
});
