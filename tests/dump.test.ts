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
    expect(out).toContain("date:Call Dave about the Smith quote");
    expect(out).toContain("today:Pay Avista");
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
    expect(titles("call mom and dad")).toEqual(["later:Call Mom and Dad"]);
  });
  test("talking with only commas still separates cleanly", () => {
    expect(titles("pay avista today, out of milk eggs and diapers, maybe someday build a garden box, fix the porch light")).toEqual([
      "today:Pay Avista", "shop:Milk", "shop:Eggs", "shop:Diapers", "someday:Build a garden box", "later:Fix the porch light",
    ]);
    expect(titles("and we need bread, peanut butter, bananas, also schedule an oil change for saturday")).toEqual([
      "shop:Bread", "shop:Peanut butter", "shop:Bananas", "date:Schedule an oil change",
    ]);
    expect(titles("call mom, dad and grandma about thanksgiving")).toEqual(["later:Call Mom, Dad and Grandma about Thanksgiving"]);
    const [inv] = sort("finish the smith invoice by thursday");
    expect(inv.due).toBe("2026-10-22");
  });
  test("a 'need to' keeps a feeling actionable", () => {
    expect(titles("I'm worried I need to call the bank")).toContain("later:Call the bank");
  });
});
describe("brain dump shopping words", () => {
  test("two-word groceries stay together and count as shopping", () => {
    expect(titles("need hot dogs and ice cream")).toEqual(["shop:Hot dogs", "shop:Ice cream"]);
    expect(titles("fix the porch light")).toEqual(["later:Fix the porch light"]);
  });

  test("talks like a phone: curly I’m, 'going to need to', 'this upcoming', an hour estimate, and 'then' keeps the day", () => {
    const out = sort("I’m going to need to pick up the leaves from Sam’s house this upcoming Tuesday. I’m going to need a tarp and ratchet straps and then take it to the dump after give around one hour of loading and dump trip.");
    const t = (x: string) => out.find((i) => i.title.startsWith(x))!;
    expect(t("Pick up the leaves from Sam's house").dest).toBe("date");
    expect(t("Pick up the leaves").when).toBe("2026-10-27");
    expect(t("Pick up the leaves").title).toBe("Pick up the leaves from Sam's house");
    expect(t("Get a tarp and ratchet straps").dest).toBe("later");
    expect(t("Take the leaves to the dump").when).toBe("2026-10-27");
    expect(t("Take the leaves to the dump").est).toBe(60);
    expect(out).toHaveLength(3);
  });
  test("estimates come out of the title", () => {
    const [a] = sort("clean the garage, should take about 2 hours");
    expect(a.title).toBe("Clean the garage");
    expect(a.est).toBe(120);
    const [b] = sort("call the bank in 2 hours");
    expect(b.est).toBeNull(); // "in 2 hours" is when, not how long
  });
  test("'I'm going to' a place becomes Go to", () => {
    expect(titles("I'm going to Costco tomorrow")).toEqual(["date:Go to Costco"]);
    expect(titles("I'm gonna call dave")).toEqual(["later:Call Dave"]);
  });
});

