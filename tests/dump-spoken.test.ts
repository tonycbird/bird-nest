import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import * as C from "../src/head/core/clearhead.js";
import * as H from "../src/head/store";
import { planDump, spokenList } from "../src/head/dump-sort";

/* Nov 22: his real morning dump, dictated on the iPhone, came out as "Hello", "These are gonna be the tas…",
   "Number two is going to be…". A spoken list is now read the way he said it. */
const REAL = "Hello, these are gonna be the tasks that are needed to be done on Tuesday number one is going to be calling Chris Trongale about the leak. Number two is going to be emptying. The baptismal number three is going to be cleaning the cafeteria upstairs number four is going to be cleaning. All of River Tech number five is going to be cleaning the bathrooms and number six is going to be ensuring that the building is good to go until Saturday. But outside number six to be the coffee bar cleaned and stocked.";
const TUE = "2026-11-24";
let data: Awaited<ReturnType<typeof H.loadData>>, s: Awaited<ReturnType<typeof H.loadSettings>>;
const plan = (t: string) => planDump(t, data, s).items.map((i) => [i.title, i.dest, i.when]);
beforeAll(async () => { C.setNow(new Date(2026, 10, 22, 14, 0)); data = await H.loadData(); s = await H.loadSettings(); });

describe("a spoken numbered list", () => {
  it("his real dump: one thing per number, all on Tuesday, said as things to do", () => {
    expect(plan(REAL)).toEqual([
      ["Call Chris Trongale about the leak", "date", TUE],
      ["Empty the baptismal", "date", TUE],
      ["Clean the cafeteria upstairs", "date", TUE],
      ["Clean all of River Tech", "date", TUE],
      ["Clean the bathrooms", "date", TUE],
      ["Make sure the building is good to go until Saturday", "date", TUE],
      ["The coffee bar cleaned and stocked", "date", TUE],
    ]);
  });
  it("the greeting and the opening become a header, not things", () => {
    expect(spokenList(REAL).split("\n")[0]).toBe("tuesday:");
    expect(plan(REAL).some(([t]) => /^(hello|these are)/i.test(t as string))).toBe(false);
  });
  it("two lists in one dump, each with its own day", () => {
    expect(plan("These are the tasks for Tuesday number one is calling Chris about the leak number two emptying the baptismal. These are gonna be my work tasks for Wednesday number one is ordering furnace filters number two is fixing the sanctuary door")).toEqual([
      ["Call Chris about the leak", "date", TUE], ["Empty the baptismal", "date", TUE],
      ["Order furnace filters", "date", "2026-11-25"], ["Fix the sanctuary door", "date", "2026-11-25"],
    ]);
  });
  it("first / second / third, and digits", () => {
    expect(plan("Okay so tomorrow first I need to call the alarm company second order filters third clean the sanctuary")).toEqual([
      ["Call the alarm company", "date", "2026-11-23"], ["Order filters", "date", "2026-11-23"], ["Clean the sanctuary", "date", "2026-11-23"],
    ]);
    expect(plan("Tasks for Wednesday. Number 1 call Bob. Number 2 fix the door. Also I need to buy milk.")).toEqual([
      ["Call Bob", "date", "2026-11-25"], ["Fix the door", "date", "2026-11-25"], ["Milk", "shop", null],
    ]);
  });
  it("a number said in passing isn't a list", () => {
    expect(spokenList("call Bob about unit number 4 and fix the door")).toBe("call Bob about unit number 4 and fix the door");
  });
});

describe("dictation's pauses", () => {
  it("a period after a verb doesn't cut the thing in two", () => {
    expect(plan("On Tuesday I need to call Chris about the leak. Then empty. The baptismal. Then clean the cafeteria upstairs").map((x) => x[0]))
      .toEqual(["Call Chris about the leak", "Empty the baptismal", "Clean the cafeteria upstairs"]);
  });
  it("'Hello' alone is not a thing", () => {
    expect(plan("Hello. Call Bob tomorrow").map((x) => x[0])).toEqual(["Call Bob"]);
  });
});
