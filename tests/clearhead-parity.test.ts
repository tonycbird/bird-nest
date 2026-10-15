import { describe, expect, it, beforeAll } from "vitest";
import fx from "./fixtures/clearhead-fixtures.json";
import * as C from "../src/head/core/clearhead.js";
import type { RepeatRule } from "../src/head/types";

/* Outputs captured from the old Clearhead code (tests/fixtures/clearhead-fixtures.json).
   If one of these fails, the port changed behavior. Fix the port, don't edit the fixture. */

const ctx = {
  today: "2026-10-14", weekStart: 1, contexts: C.DEFAULT_CONTEXTS,
  projects: [{ id: "p1", name: "Bathroom remodel" }, { id: "p2", name: "Backyard redo" }],
  areas: [{ id: "a1", name: "Handyman Business" }, { id: "a2", name: "Theology Degree" }, { id: "a3", name: "Family & Home" }],
};

beforeAll(() => C.setNow(new Date(2026, 9, 14, 10, 0, 0)));

describe("Quick Add matches Clearhead on every sample line", () => {
  for (const q of fx.quickAdd) {
    it(q.in, () => {
      const out = C.parseQuickAdd(q.in, ctx);
      expect(out.title).toBe(q.out.title);
      expect(out.fields).toEqual(q.out.fields);
      expect(out.tokens.map((t: { type: string; label: string }) => [t.type, t.label])).toEqual(q.out.tokens.map((t: { type: string; label: string }) => [t.type, t.label]));
    });
  }
});

describe("Repeat rules match Clearhead", () => {
  for (const r of fx.repeat) {
    it(r.describe, () => {
      const rule = r.rule as RepeatRule;
      expect(C.describeRule(rule)).toBe(r.describe);
      expect(C.nextAfter(rule, "2026-10-14")).toBe(r.next);
      expect(C.occurrencesBetween(rule, "2026-10-14", "2027-04-01", 6)).toEqual(r.between);
      expect(C.nextInstanceDates({ repeat: rule, when: "2026-10-14", due: null }, "2026-10-16")).toEqual(r.inst);
    });
  }
});

describe("Dates, ramble splitting and helpers match Clearhead", () => {
  it("typed dates", () => { for (const d of fx.dates) expect(C.matchDateAt(d.in, ctx)).toEqual(d.out); });
  it("ramble splitting", () => { for (const r of fx.ramble) expect(C.splitRamble(r.in, ctx)).toEqual(r.out); });
  it("estimates, durations, groceries, time formats, notes", () => {
    for (const [s, v] of fx.misc.est) expect(C.parseEstimate(s as string)).toBe(v);
    for (const [s, v] of fx.misc.dur) expect(C.parseDuration(s as string)).toBe(v);
    for (const [s, v] of fx.misc.grocery) expect(C.guessGroceryCat(s as string)).toBe(v);
    for (const [m, v] of fx.misc.fmt) expect(C.fmtMinutes(m as number)).toBe(v);
    expect(C.renderNotes("# Plan\n- [ ] buy tile\n- [x] measure\n- loose item\nSee **this** https://example.com")).toBe(fx.misc.notes);
  });
});
