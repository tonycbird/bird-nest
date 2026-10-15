import { describe, expect, it } from "vitest";
import { dayKey } from "../src/lib/dayKey";

const LA = "America/Los_Angeles";

describe("dayKey", () => {
  it("keeps 11:30 PM on the same day (UTC would say tomorrow)", () => {
    // 2026-10-14 23:30 PDT = 2026-10-15 06:30 UTC
    expect(dayKey(new Date("2026-10-15T06:30:00Z"), LA)).toBe("2026-10-14");
  });
  it("rolls over at local midnight", () => {
    expect(dayKey(new Date("2026-10-15T07:00:00Z"), LA)).toBe("2026-10-15");
  });
  it("handles the fall-back DST night", () => {
    // 2026-11-01 01:30 PST (second 1:30) = 09:30 UTC
    expect(dayKey(new Date("2026-11-01T09:30:00Z"), LA)).toBe("2026-11-01");
    // 2026-10-31 23:59 PDT = 2026-11-01 06:59 UTC
    expect(dayKey(new Date("2026-11-01T06:59:00Z"), LA)).toBe("2026-10-31");
  });
  it("handles the spring-forward night", () => {
    // 2027-03-14 03:30 PDT = 10:30 UTC
    expect(dayKey(new Date("2027-03-14T10:30:00Z"), LA)).toBe("2027-03-14");
  });
});
