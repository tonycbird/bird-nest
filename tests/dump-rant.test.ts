import { beforeAll, describe, expect, test } from "vitest";
import * as C from "../src/head/core/clearhead.js";
import { planDump, type DumpItem } from "../src/head/dump-sort";
import type { HeadData } from "../src/head/types";
import { taskIcon } from "../src/ui/colors";
import { iconName } from "../src/ui/glyphs";

/* Rants the way Anthony talks, against his real lists. Thu Oct 22, 2026, 9:00 AM. */
beforeAll(() => { C.setNow(new Date(2026, 9, 22, 9, 0)); });
const now = Date.now();
const AREAS: [string, string, string | null][] = [
  ["aPer", "Personal Projects", null], ["aHan", "Handyman Business", null], ["aThe", "Theology Degree", null],
  ["aChu", "Work @ Church", null], ["aFam", "Family & Home", null], ["aGro", "Errands & Groceries", "groceries"],
];
const areas = AREAS.map(([id, name, listMode], i) => ({ id, name, listMode, icon: null, order: i, archived: false, createdAt: now }));
const project = (id: string, name: string, areaId: string, client: string | null = null) =>
  ({ id, name, areaId, status: "active", sections: [], order: 1, createdAt: now, client: client ? { name: client } : null, notes: "", outcome: "", description: "" });
const projects = [project("pBack", "Backyard Remodel", "aFam"), project("pJon", "Jon Wolfe Project", "aHan", "Jon Wolfe")];
const task = (id: string, title: string, projectId: string | null, areaId: string) => ({ id, title, projectId, areaId, status: "open", notes: "", checklist: [], contexts: [], createdAt: now });
const tasks = [task("t1", "Buy materials", "pBack", "aFam"), task("t2", "Buy materials", "pJon", "aHan"), task("t3", "Pay Kootenai Electric bill", null, "aFam")];
const data = {
  areas: new Map(areas.map((a) => [a.id, a])),
  projects: new Map(projects.map((p) => [p.id, p])),
  tasks: new Map(tasks.map((t) => [t.id, t])),
} as unknown as HeadData;
const s = { ...C.DEFAULT_SETTINGS, weekStart: 1, contexts: ["@Phone", "@Errands"] };
const plan = (t: string) => planDump(t, data, s);
const find = (items: DumpItem[], start: string) => {
  const it = items.find((i) => i.title.toLowerCase().startsWith(start.toLowerCase()));
  if (!it) throw new Error(`no "${start}" in: ${items.map((i) => `${i.dest}:${i.title}`).join(" | ")}`);
  return it;
};

describe("rants → tasks in the right places", () => {
  test("a project header carries to everything said about it", () => {
    const { items } = plan("For the Jon Wolfe project, pick up the trim boards from Home Depot tomorrow morning, then cut and install them Thursday. Call Jon about the paint color because he wasn't sure about white or cream.");
    const pick = find(items, "Pick up the trim boards");
    expect(pick.title).toBe("Pick up the trim boards from Home Depot");
    expect(pick.projectId).toBe("pJon");
    expect(pick.when).toBe("2026-10-23");
    expect(pick.tod).toBe("morning");
    const cut = find(items, "Cut and install");
    expect(cut.title).toBe("Cut and install the trim boards");
    expect(cut.projectId).toBe("pJon");
    const call = find(items, "Call Jon");
    expect(call.title).toBe("Call Jon about the paint color");
    expect(call.projectId).toBe("pJon");
    expect(call.notes).toMatch(/wasn't sure about white or cream/);
    expect(items).toHaveLength(3);
  });

  test("'Backyard:' header, a comma list of steps, 'it' becomes the thing", () => {
    const { items, projects } = plan("Backyard: rent a rototiller Saturday, till the whole yard, rake and level it, order 3 yards of topsoil.");
    expect(projects).toHaveLength(0);
    expect(items.map((i) => i.projectId)).toEqual(["pBack", "pBack", "pBack", "pBack"]);
    expect(find(items, "Rent a rototiller").when).toBe("2026-10-24");
    expect(find(items, "Rake and level").title).toBe("Rake and level the whole yard");
    expect(find(items, "Order 3 yards of topsoil").dest).toBe("later");
  });

  test("a new job turns into a project with its steps in order", () => {
    const { items, projects } = plan("I want to build a deck for the Smiths. Need to measure the space, draw up a plan, get a quote together by Friday, and order the lumber once they approve.");
    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(p.name).toBe("Smith deck");
    expect(p.areaId).toBe("aHan");
    expect(p.on).toBe(true);
    const steps = items.filter((i) => i.newProject === p.key);
    expect(steps.map((i) => i.title)).toEqual(["Measure the space", "Draw up a plan", "Get a quote together", "Order the lumber"]);
    expect(find(items, "Get a quote together").due).toBe("2026-10-23");
    expect(find(items, "Order the lumber").notes).toMatch(/once they approve/);
  });

  test("an unknown header with steps is a new project too", () => {
    const { items, projects } = plan("Fence for the neighbors: tear out the old fence, set new posts, hang the panels, stain it.");
    expect(projects.map((p) => p.name)).toEqual(["Neighbor fence"]);
    expect(items.filter((i) => i.newProject === projects[0].key)).toHaveLength(4);
    expect(find(items, "Stain").title).toBe("Stain the panels");
  });

  test("a day said first covers the whole sentence; a time lands on that day", () => {
    const { items } = plan("Sunday I need to print the kids ministry lessons and set up the check-in table at 8:30.");
    const print = find(items, "Print the kids ministry lessons");
    expect(print.when).toBe("2026-10-25");
    expect(print.areaId).toBe("aChu");
    const table = find(items, "Set up the check-in table");
    expect(table.when).toBe("2026-10-25");
    expect(table.time).toBe("08:30");
    expect(table.areaId).toBe("aChu");
  });

  test("'Tomorrow:' header dates a list", () => {
    const { items } = plan("Tomorrow: call the county about the permit, text abby, pick up the drill from aaron.");
    expect(items.map((i) => i.title)).toEqual(["Call the county about the permit", "Text Abby", "Pick up the drill from Aaron"]);
    expect(items.every((i) => i.when === "2026-10-23")).toBe(true);
  });

  test("school stuff goes to Theology Degree with its deadlines", () => {
    const { items } = plan("Greek quiz Thursday. Read chapter 5 for hermeneutics by Monday. Discussion post due Sunday night.");
    expect(items.every((i) => i.areaId === "aThe")).toBe(true);
    expect(find(items, "Read chapter 5").due).toBe("2026-10-26");
    expect(find(items, "Discussion post").due).toBe("2026-10-25");
  });

  test("groceries go shopping, a return stays a task, bills go home", () => {
    const { items } = plan("we're out of diapers and coffee filters, and I need to return the drill to Home Depot. Pay the avista bill friday.");
    expect(items.filter((i) => i.dest === "shop").map((i) => i.title)).toEqual(["Diapers", "Coffee filters"]);
    expect(find(items, "Return the drill to Home Depot").dest).toBe("later");
    const bill = find(items, "Pay the Avista bill");
    expect(bill.areaId).toBe("aFam");
    expect(bill.when).toBe("2026-10-23");
  });

  test("reasons move to notes; names get capitals", () => {
    const [a] = plan("I really need to call dave about the tile because the grout color is wrong and he wants it fixed").items;
    expect(a.title).toBe("Call Dave about the tile");
    expect(a.notes).toMatch(/grout color is wrong/);
  });

  test("materials said about a project are project tasks, not groceries", () => {
    const { items } = plan("Jon Wolfe: finish the trim and caulk it.\n\nBackyard: buy edging and rent the sod cutter Saturday.");
    expect(find(items, "Finish the trim").projectId).toBe("pJon");
    expect(find(items, "Caulk the trim").projectId).toBe("pJon");
    const edging = find(items, "Buy edging");
    expect(edging.dest).not.toBe("shop");
    expect(edging.projectId).toBe("pBack");
    expect(find(items, "Rent the sod cutter").projectId).toBe("pBack");
  });

  test("long rambling titles get trimmed, the full words kept in notes", () => {
    const [a] = plan("figure out what to do about the leaking pipe under the kitchen sink at the rental because it keeps dripping into the cabinet").items;
    expect(a.title.split(" ").length).toBeLessThanOrEqual(9);
    expect(a.notes).toMatch(/keeps dripping/);
  });

  test("a project mentioned mid-sentence doesn't swallow the next sentence", () => {
    const { items } = plan("Call Jon about the trim. Pay the electric bill.");
    expect(find(items, "Call Jon").projectId).toBe("pJon");
    expect(find(items, "Pay the electric bill").projectId).toBeNull();
  });

});

describe("dictation: one long run-on, no commas", () => {
  test("a Home Depot run for a job", () => {
    const { items } = plan("ok so tomorrow I gotta get up early and go to home depot for the jon wolfe job I need 2x4s screws and a new blade for the saw then head over to jons and start framing the closet");
    const depot = find(items, "Go to Home Depot");
    expect(depot.projectId).toBe("pJon");
    expect(depot.when).toBe("2026-10-23");
    expect(find(items, "Get 2x4s, screws").projectId).toBe("pJon");
    const frame = find(items, "Start framing the closet");
    expect(frame.projectId).toBe("pJon");
    expect(frame.when).toBe("2026-10-23");
  });
  test("who asked and what's wrong go to the notes", () => {
    const { items } = plan("abby wants me to fix the dishwasher it's leaking again and we need to schedule the oil change for the truck sometime next week also the baby has a checkup thursday at 10");
    const dw = find(items, "Fix the dishwasher");
    expect(dw.areaId).toBe("aFam");
    expect(dw.notes).toMatch(/Abby wants me/);
    expect(dw.notes).toMatch(/leaking again/);
    expect(find(items, "Schedule the oil change for the truck").when).toBe("2026-10-26");
    const baby = find(items, "Baby checkup");
    expect(baby.when).toBe("2026-10-22");
    expect(baby.time).toBe("10:00");
  });
  test("'for church sunday' then three things", () => {
    const { items } = plan("for church sunday I need to set up the kids room print the coloring sheets and text the volunteers to remind them about the new check in system");
    expect(items.map((i) => i.title)).toEqual(["Set up the kids room", "Print the coloring sheets", "Text the volunteers about the new check-in system"]);
    expect(items.every((i) => i.when === "2026-10-25" && i.areaId === "aChu")).toBe(true);
  });
  test("a new job with a deadline", () => {
    const { items, projects } = plan("new job for the Hendersons replace the front door and the storm door they want it done before thanksgiving need to measure first and get them a quote");
    expect(projects.map((p) => [p.name, p.areaId, p.deadline])).toEqual([["Henderson job", "aHan", "2026-11-26"]]);
    expect(items.filter((i) => i.newProject === projects[0].key).map((i) => i.title)).toEqual(["Replace the front door and the storm door", "Measure", "Get the Hendersons a quote"]);
  });
  test("a day said for the job isn't when to text", () => {
    const { items } = plan("text aaron and see if he can help saturday. text jon that I'll be there at 8 tomorrow and ask him if he picked a paint color");
    const a = find(items, "Text Aaron");
    expect(a.title).toBe("Text Aaron: can he help Saturday?");
    expect(a.when).toBeNull();
    const j = find(items, "Text Jon");
    expect(j.title).toBe("Text Jon: I'll be there at 8 tomorrow");
    expect(j.time).toBeNull();
  });
  test("'stuff for today:' dates the list and isn't a project", () => {
    const { items, projects } = plan("stuff for today: pay the water bill, return library books, get gas, call grandma back");
    expect(projects).toHaveLength(0);
    expect(items.map((i) => i.title)).toEqual(["Pay the water bill", "Return library books", "Get gas", "Call Grandma back"]);
    expect(items.every((i) => i.dest === "today")).toBe(true);
  });
  test("what's going on becomes the note; 'it' is the thing", () => {
    const { items } = plan("the deck stain is peeling at the Millers I should go look at it this week and give them a price");
    const look = find(items, "Go look at the deck stain");
    expect(look.notes).toMatch(/peeling/);
    expect(look.due).toBe("2026-10-23");
    expect(find(items, "Give them a price").areaId).toBe("aHan");
  });
  test("groceries with no commas; a babysitter isn't baby food", () => {
    expect(plan("milk bread bananas peanut butter").items.map((i) => `${i.dest}:${i.title}`)).toEqual(["shop:Milk", "shop:Bread", "shop:Bananas", "shop:Peanut butter"]);
    expect(find(plan("date night with abby friday, need a babysitter").items, "Get a babysitter").dest).toBe("later");
    expect(find(plan("pick up abby's prescription").items, "Pick up Abby's prescription").dest).toBe("later");
  });
  test("repeats, and a week of days in order", () => {
    const r = plan("every monday take out the trash and every other week mow the lawn").items;
    expect(C.describeRule(find(r, "Take out the trash").repeat!)).toBe("Every Monday");
    expect(find(r, "Mow the lawn").repeat?.interval).toBe(2);
    const { items, projects } = plan("kitchen remodel for the Garcias: demo the old cabinets monday, haul it to the dump, install the new cabinets wednesday, and set the countertops friday");
    expect(projects[0].name).toBe("Garcia kitchen remodel");
    expect(find(items, "Haul the old cabinets to the dump").newProject).toBe(projects[0].key);
    expect(find(items, "Set the countertops").when).toBe("2026-10-30");
  });
  test("'needs to be done by' is a deadline, not a second task", () => {
    const { items } = plan("sermon notes for sunday need to be done by saturday night and I need to meet with pastor mike thursday at noon");
    expect(find(items, "Sermon notes").due).toBe("2026-10-24");
    expect(find(items, "Meet with Pastor Mike").time).toBe("12:00");
    expect(items).toHaveLength(2);
  });
});

describe("coffee meetings", () => {
  test("they get the coffee icon and keep short titles", () => {
    const a = find(plan("Coffee with Mark Tuesday at 9").items, "Coffee with Mark");
    expect(a.when).toBe("2026-10-27");
    expect(a.time).toBe("09:00");
    expect(taskIcon(a.title)).toBe("coffee");
    expect(taskIcon(find(plan("Meet Jon for coffee at 2 tomorrow").items, "Meet Jon for coffee").title)).toBe("coffee");
    expect(taskIcon("Starbucks with Aaron")).toBe("coffee");
    expect(taskIcon("Café with Dave")).toBe("coffee");
    expect(taskIcon("Dentist appointment")).toBe("calendar");
    expect(iconName("☕")).toBe("coffee");
  });
  test("what the meetup is for goes in the notes", () => {
    const it = find(plan("coffee meeting with the Hendersons next week to go over the deck").items, "Coffee meeting");
    expect(it.title).toBe("Coffee meeting with the Hendersons");
    expect(it.notes).toMatch(/go over the deck/);
  });
  test("out of coffee is still shopping", () => {
    expect(find(plan("We're out of coffee").items, "Coffee").dest).toBe("shop");
  });
});


describe("real dictation, Oct 28", () => {
  test("talking to the app becomes the task itself", () => {
    expect(find(plan("add a simple task for fixing the outlet").items, "Fix").title).toBe("Fix the outlet");
    expect(find(plan("make a task to call the plumber").items, "Call").title).toBe("Call the plumber");
    expect(find(plan("put down that I need to fix the gate").items, "Fix").title).toBe("Fix the gate");
    const p = find(plan("create a task for painting the fence friday").items, "Paint");
    expect(p.title).toBe("Paint the fence");
    expect(p.when).toBe("2026-10-23");
  });
  test("last names, 'as well as', and a day that's the topic", () => {
    expect(find(plan("I need to clear the debris for Gayle bent").items, "Clear").title).toBe("Clear the debris for Gayle Bent");
    expect(find(plan("drop off keys with Sarah jones").items, "Drop").title).toBe("Drop off keys with Sarah Jones");
    expect(find(plan("help Dave move on saturday").items, "Help").title).toBe("Help Dave move");
    expect(find(plan("get an empty truck as well as my tarp").items, "Get").title).toBe("Get an empty truck and my tarp");
    const t = find(plan("text Abby about friday").items, "Text");
    expect(t.title).toBe("Text Abby about Friday");
    expect(t.when ?? null).toBeNull();
  });
});

describe("already on the list", () => {
  test("a thing you already have is left unchecked, inside the same project only", () => {
    const pay = find(plan("pay the kootenai electric bill").items, "Pay");
    expect(pay.keep).toBe(false);
    expect(pay.dupOf).toBe("t3");
    const buy = find(plan("For the Jon Wolfe project, buy materials").items, "Buy materials");
    expect(buy.dupOf).toBe("t2");
    expect(buy.keep).toBe(false);
    const fresh = find(plan("buy materials for the shed").items, "Buy materials");
    expect(fresh.keep).toBe(true);
  });
  test("sameTask is loose about little words, strict about real ones", async () => {
    const { sameTask } = await import("../src/head/same");
    expect(sameTask("Rent the sod cutter", "rent sod cutter")).toBe(true);
    expect(sameTask("Call Dave", "Call Dave.")).toBe(true);
    expect(sameTask("Call Dave", "Call Mark")).toBe(false);
    expect(sameTask("Pick up the trim boards", "Pick up trim board")).toBe(true);
    expect(sameTask("Buy paint", "Buy paint brushes and tape")).toBe(false);
  });
});
