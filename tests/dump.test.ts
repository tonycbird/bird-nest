import { describe, expect, test, beforeAll } from "vitest";
import * as C from "../src/head/core/clearhead.js";
import { pieces, sortDump } from "../src/head/dump-sort";
import type { HeadData } from "../src/head/types";

beforeAll(() => { C.setNow(new Date(2026, 9, 21, 9, 0)); }); // Wed Oct 21, 2026
const now = Date.now();
const areas = C.SEED_AREAS.map((a: Record<string, unknown>, i: number) => ({ id: "a" + i, ...a, listMode: (a.listMode as string) ?? null, order: i, archived: false, createdAt: now }));
const data = {
  areas: new Map(areas.map((a) => [a.id, a])),
  projects: new Map([["p1", { id: "p1", name: "Smith bathroom remodel", areaId: "a0", status: "active", sections: [], order: 1, createdAt: now }]]),
  tasks: new Map(),
} as unknown as HeadData;
const s = { ...C.DEFAULT_SETTINGS, weekStart: 1, contexts: ["@Phone", "@Errands"] };
const sort = (t: string) => sortDump(t, data, s);
const titles = (t: string) => sort(t).map((x) => `${x.dest}:${x.title}`);

describe("brain dump", () => {
  test("splits a run-on dump into separate things", () => {
    expect(pieces("call dave about the quote and pay avista. need milk, eggs and diapers; maybe someday build a garden box")).toEqual([
      "call dave about the quote", "pay avista", "need milk, eggs and diapers", "maybe someday build a garden box",
    ]);
  });
  test("each thing lands in the right place", () => {
    const out = titles("call dave about the smith quote tomorrow, I need to pay avista today and also we're out of milk, eggs and diapers. Maybe someday build a garden box. Greek reading due friday. I'm kind of stressed about money");
    expect(out).toContain("date:Call dave about the smith quote");
    expect(out).toContain("today:Pay avista");
    expect(out).toEqual(expect.arrayContaining(["shop:Milk", "shop:Eggs", "shop:Diapers"]));
    expect(out).toContain("someday:Build a garden box");
    expect(out.some((x) => x.startsWith("date:Greek reading"))).toBe(true);
    expect(out).toContain("thought:I'm stressed about money");
  });
  test("finds the project or area", () => {
    const [q] = sort("call dave about the smith quote");
    expect(q.projectId).toBe("p1");
    const [g] = sort("study greek chapter 4");
    expect(g.areaId).toBe("a2");
  });
  test("abbreviations don't split, lists without groceries stay a task", () => {
    expect(titles("read pp. 61-78 for class")).toEqual(["later:Read pp. 61-78 for class"]);
    expect(titles("get a price on lumber")).toEqual(["later:Get a price on lumber"]);
    expect(titles("call mom and dad")).toEqual(["later:Call mom and dad"]);
  });
  test("talking with only commas still separates cleanly", () => {
    expect(titles("pay avista today, out of milk eggs and diapers, maybe someday build a garden box, fix the porch light")).toEqual([
      "today:Pay avista", "shop:Milk", "shop:Eggs", "shop:Diapers", "someday:Build a garden box", "later:Fix the porch light",
    ]);
    expect(titles("and we need bread, peanut butter, bananas, also schedule an oil change for saturday")).toEqual([
      "shop:Bread", "shop:Peanut butter", "shop:Bananas", "date:Schedule an oil change",
    ]);
    expect(titles("call mom, dad and grandma about thanksgiving")).toEqual(["later:Call mom, dad and grandma about thanksgiving"]);
    const [inv] = sort("finish the smith invoice by thursday");
    expect(inv.due).toBe("2026-10-22");
  });
  test("a 'need to' keeps a feeling actionable", () => {
    expect(titles("I'm worried I need to call the bank")[0]).not.toMatch(/^thought:/);
  });
});
describe("brain dump shopping words", () => {
  test("two-word groceries stay together and count as shopping", () => {
    expect(titles("need hot dogs and ice cream")).toEqual(["shop:Hot dogs", "shop:Ice cream"]);
    expect(titles("fix the porch light")).toEqual(["later:Fix the porch light"]);
  });
});
