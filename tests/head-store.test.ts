import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import * as C from "../src/head/core/clearhead.js";
import * as H from "../src/head/store";

beforeEach(async () => {
  C.setNow(new Date(2026, 9, 14, 10, 0, 0));
  await db.delete(); await db.open();
});

describe("Head store (Clearhead rules on Dexie)", () => {
  it("creates a task in a project and inherits the project's area", async () => {
    const aid = await H.createArea({ name: "Handyman Business" });
    const pid = await H.createProject({ name: "Bathroom", areaId: aid });
    const t = await H.createTask({ title: "Order tile", projectId: pid });
    expect(t.areaId).toBe(aid);
    const data = await H.loadData();
    expect(C.selectInbox(data).length).toBe(0);
    expect(C.nextAction(data, data.projects.get(pid)!)?.title).toBe("Order tile");
  });

  it("an inbox task lands in Inbox, Today when scheduled, with history", async () => {
    const t = await H.createTask({ title: "Call Smith" });
    let data = await H.loadData();
    expect(C.selectInbox(data).map((x) => x.id)).toEqual([t.id]);
    await H.updateTask(t.id, { when: "2026-10-14" });
    data = await H.loadData();
    expect(C.selectToday(data).main.map((x) => x.title)).toEqual(["Call Smith"]);
    expect(data.tasks.get(t.id)!.history.at(-1)!.what).toBe("scheduled 2026-10-14");
  });

  it("counts reschedules when today's task is pushed later", async () => {
    const t = await H.createTask({ title: "Fix gutter", when: "2026-10-14" });
    await H.updateTask(t.id, { when: "2026-10-15" });
    expect((await db.tasks.get(t.id))!.reschedules).toBe(1);
  });

  it("reopening a finished repeating task takes back its next copy (no doubles)", async () => {
    const t = await H.createTask({ title: "Trash out", when: "2026-10-14", repeat: { freq: "week", interval: 1, days: [3], anchor: "2026-10-14" } });
    await H.completeTask(t.id);
    await H.uncompleteTask(t.id);
    await H.completeTask(t.id);
    const open = (await db.tasks.toArray()).filter((x) => x.title === "Trash out" && x.status === "open");
    expect(open).toHaveLength(1);
  });

  it("completing a repeating task makes the next one, and undo removes it", async () => {
    const t = await H.createTask({ title: "Trash out", when: "2026-10-14", repeat: { freq: "week", interval: 1, days: [3], anchor: "2026-10-14" } });
    const undo = await H.completeTask(t.id);
    let tasks = await db.tasks.toArray();
    const next = tasks.find((x) => x.id !== t.id)!;
    expect(next.when).toBe("2026-10-21");
    expect(next.status).toBe("open");
    await undo();
    tasks = await db.tasks.toArray();
    expect(tasks.length).toBe(1);
    expect(tasks[0].status).toBe("open");
  });

  it("delete goes to Recently Deleted as a group and restores together", async () => {
    const aid = await H.createArea({ name: "Projects" });
    const pid = await H.createProject({ name: "Shed", areaId: aid });
    await H.createTask({ title: "Pour pad", projectId: pid });
    const undo = await H.deleteProject(pid);
    expect(await db.projects.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    expect((await H.loadTrash()).length).toBe(2);
    await undo();
    expect(await db.projects.count()).toBe(1);
    expect(await db.tasks.count()).toBe(1);
    expect(await db.trash.count()).toBe(0);
  });

  it("templates: Handyman Job builds sections and steps", async () => {
    const aid = await H.createArea({ name: "Handyman Business" });
    const tpl = (await H.allTemplates()).find((x) => x.id === "tpl-handyman")!;
    const pid = await H.createFromTemplate(tpl, { name: "Smith bath", areaId: aid, client: { name: "Smith" } });
    const p = (await db.projects.get(pid))!;
    expect(p.sections.map((s) => s.name)).toEqual(["Quote", "Job", "Close out"]);
    expect((await db.tasks.toArray()).length).toBe(12);
    const back = await H.saveProjectAsTemplate(pid, "My job");
    const mine = (await db.templates.get(back!))!;
    expect(mine.sections.reduce((n, s) => n + s.tasks.length, 0)).toBe(12);
  });

  it("groceries go to the groceries area with a guessed aisle", async () => {
    await H.seedAreas();
    const g = await H.addGrocery("Bananas");
    expect(g?.grocery?.cat).toBe("produce");
  });

  it("imports a Clearhead backup, twice, without doubling anything", async () => {
    const backup = {
      app: "Clearhead" as const, version: 2,
      settings: { contexts: ["@Home", "@Phone"], offDays: [1], planTime: "06:30" },
      areas: [{ id: "a1", name: "Day Job", color: "blue", icon: "briefcase", listMode: null, order: 0, archived: false, createdAt: 1 }],
      projects: [{ id: "p1", name: "Q4", areaId: "a1", status: "active", sections: [], order: 1, createdAt: 1 }],
      tasks: [
        { ...C.newTask({ title: "Report", projectId: "p1", areaId: "a1" }), id: "t1" },
        { ...C.newTask({ title: "Old thing" }), id: "t2", status: "done", doneAt: 5 },
      ],
      templates: [],
    };
    const r1 = await H.importClearhead(H.readClearhead(JSON.parse(JSON.stringify(backup))));
    await H.importClearhead(H.readClearhead(JSON.parse(JSON.stringify(backup))));
    expect(r1).toEqual({ areas: 1, projects: 1, tasks: 2, templates: 0 });
    expect(await H.headCounts()).toEqual({ areas: 1, projects: 1, tasks: 2, open: 1, done: 1, templates: 0 });
    expect((await H.loadSettings()).planTime).toBe("06:30");
  });

  it("refuses a file that isn't a Clearhead backup", () => {
    expect(() => H.readClearhead({ app: "bird-nest" })).toThrow();
  });
});
