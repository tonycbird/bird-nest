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
