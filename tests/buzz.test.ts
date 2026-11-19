import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import * as C from "../src/head/core/clearhead.js";
import { restBuzz, shutdownBuzzes } from "../src/lib/buzz";

/* Wed Oct 28, 2026, 2:00 PM (Los Angeles). */
const now = new Date(2026, 9, 28, 14, 0).getTime();
const today = "2026-10-28";

describe("shutdown buzzes", () => {
  test("a week of evenings at the shutdown time, skipping off days", () => {
    const sunday = C.weekday("2026-11-01");
    const b = shutdownBuzzes({ shutdownTime: "19:30", offDays: [sunday], lastShutdown: null }, today, now);
    expect(b.map((x) => x.id)).toEqual(["shutdown:2026-10-28", "shutdown:2026-10-29", "shutdown:2026-10-30", "shutdown:2026-10-31", "shutdown:2026-11-02", "shutdown:2026-11-03"]);
    expect(new Date(b[0].at).getHours()).toBe(19);
    expect(new Date(b[0].at).getMinutes()).toBe(30);
    expect(b[0].url).toBe("/?open=shutdown");
    expect(b[0].title).toBe("Shutdown");
  });
  test("not tonight if already shut down, or if the time has passed", () => {
    expect(shutdownBuzzes({ shutdownTime: "19:00", offDays: [], lastShutdown: today }, today, now)[0].id).toBe("shutdown:2026-10-29");
    expect(shutdownBuzzes({ shutdownTime: "13:00", offDays: [] }, today, now)[0].id).toBe("shutdown:2026-10-29");
  });
  test("a bad time falls back to 7 PM", () => {
    expect(new Date(shutdownBuzzes({ shutdownTime: "", offDays: [] }, today, now)[0].at).getHours()).toBe(19);
  });
});

describe("rest buzz", () => {
  test("a running rest timer buzzes at its end", () => {
    const b = restBuzz({ on: true, end: now + 90_000, label: "Rest" }, now)!;
    expect(b).toMatchObject({ id: "rest", at: now + 90_000, title: "Rest done — go", tag: "rest", url: "/?open=body" });
  });
  test("warm-up timers buzz with their own name", () => {
    expect(restBuzz({ on: true, end: now + 300_000, label: "Walk" }, now)!.title).toBe("Walk done — go");
  });
  test("holds, short timers and stopped timers don't", () => {
    expect(restBuzz({ on: true, end: now + 45_000, label: "Hold" }, now)).toBeNull();
    expect(restBuzz({ on: true, end: now + 8_000, label: "Rest" }, now)).toBeNull();
    expect(restBuzz({ on: false, end: now + 90_000, label: "Rest" }, now)).toBeNull();
    expect(restBuzz(null, now)).toBeNull();
  });
});

describe("morning buzz and his week (Nov 19)", async () => {
  const { morningBuzzes } = await import("../src/lib/buzz");
  const { defaultWeek } = await import("../src/lib/week");
  const week = defaultWeek();
  const wed = new Date(2026, 10, 18, 3, 0).getTime(); // Wed Nov 18, 3:00 AM
  test("one buzz each morning at 4:30 with the day's shape and the first step", () => {
    const b = morningBuzzes(week, "2026-11-18", wed, (d) => (d === "2026-11-18" ? { title: "Shoulders & Abs", start: "06:00" } : null));
    expect(b).toHaveLength(7);
    expect(b[0]).toMatchObject({ id: "morning:2026-11-18", title: "Shoulders & Abs at 6 · work 8–4:30 · study 7:30", body: "First: Morning — water + coffee.", url: "/?open=today", tag: "morning" });
    expect(new Date(b[0].at).getHours()).toBe(4);
    expect(new Date(b[0].at).getMinutes()).toBe(30);
    expect(b.find((x) => x.id === "morning:2026-11-24")?.title).toBe("Handyman jobs · study 7:30");
    for (const x of b) expect(x.title.length).toBeLessThanOrEqual(60); // the helper keeps 60
  });
  test("not today once 4:30 has passed", () => {
    expect(morningBuzzes(week, "2026-11-18", new Date(2026, 10, 18, 5, 0).getTime(), () => null)[0].id).toBe("morning:2026-11-19");
  });
  test("shutdown follows the week: none on Saturday (work till 8), none on his off day", () => {
    const sat = C.weekday("2026-11-21"), mon = C.weekday("2026-11-23");
    const b = shutdownBuzzes({ shutdownTime: "19:30", offDays: [mon] }, "2026-11-18", wed, 7, week);
    expect(b.map((x) => x.id)).toEqual(["shutdown:2026-11-18", "shutdown:2026-11-19", "shutdown:2026-11-20", "shutdown:2026-11-22", "shutdown:2026-11-24"]);
    expect(new Date(b[0].at).getHours()).toBe(19);
    expect(new Date(b[0].at).getMinutes()).toBe(0); // the week's 7:00, not Head's 7:30
    void sat;
  });
});
