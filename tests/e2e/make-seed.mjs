import * as C from "../../src/head/core/clearhead.js";
import { writeFileSync } from "node:fs";
const now = Date.now();
const t = C.today();
const areas = C.SEED_AREAS.map((a, i) => ({ id: "a" + i, ...a, listMode: a.listMode ?? null, order: i, archived: false, createdAt: now - 1e9 + i }));
const A = Object.fromEntries(areas.map((a) => [a.name, a.id]));
const projects = [
  { id: "p1", name: "Smith bathroom remodel", areaId: A["Handyman Business"], status: "active", sections: [{ id: "s1", name: "Quote" }, { id: "s2", name: "Job" }], outcome: "Tile done, paid, 5-star review", description: "", notes: "- [ ] confirm grout color\n- [x] measure floor 8x10", client: { name: "Dave Smith", address: "123 Lakeview Dr, Coeur d'Alene", phone: "208-555-0142", price: "3200" }, photos: [], order: 1, createdAt: now - 9e8, deadline: C.addDays(t, 9), start: null, color: null, completedAt: null },
  { id: "p2", name: "Backyard redo", areaId: A["Family & Home"], status: "active", sections: [], outcome: "Bare dirt to a lawn the dog can run on", description: "", notes: "", client: null, photos: [], order: 2, createdAt: now - 8e8, deadline: null, start: null, color: null, completedAt: null },
  { id: "p3", name: "Greek midterm", areaId: A["Theology Degree"], status: "active", sections: [], outcome: "B+ or better", description: "", notes: "", client: null, photos: [], order: 3, createdAt: now - 7e8, deadline: C.addDays(t, 4), start: null, color: null, completedAt: null },
];
const T = (f) => ({ ...C.newTask(f), createdAt: now - Math.floor(Math.random() * 5e8) });
const tasks = [
  T({ title: "Call supplier about tile", projectId: "p1", areaId: A["Handyman Business"], sectionId: "s1", when: t, est: 15, contexts: ["@Phone"] }),
  T({ title: "Write quote", projectId: "p1", areaId: A["Handyman Business"], sectionId: "s1", est: 30, contexts: ["@Computer"], checklist: [{ id: "c1", text: "Materials list", done: true }, { id: "c2", text: "Labor hours", done: false }, { id: "c3", text: "Send PDF", done: false }] }),
  T({ title: "Order thinset + grout", projectId: "p1", areaId: A["Handyman Business"], sectionId: "s2", waiting: { who: "Supplier", since: C.addDays(t, -5), followUp: C.addDays(t, -1) } }),
  T({ title: "Rent sod cutter", projectId: "p2", areaId: A["Family & Home"], when: C.addDays(t, 2), est: 30 }),
  T({ title: "Rake and level", projectId: "p2", areaId: A["Family & Home"], est: 120 }),
  T({ title: "Flashcards ch. 4", projectId: "p3", areaId: A["Theology Degree"], when: t, tod: "evening", est: 30, repeat: { freq: "week", interval: 1, days: [1, 3, 5], anchor: t } }),
  T({ title: "Read pp. 61–78", projectId: "p3", areaId: A["Theology Degree"], due: C.addDays(t, 2), est: 45, important: true }),
  T({ title: "Pay Avista", areaId: A["Family & Home"], when: C.addDays(t, -2), due: C.addDays(t, 3), important: true }),
  T({ title: "Text Abby about Friday", when: t, time: "12:15" }),
  T({ title: "Ask pastor about camp dates" }),
  T({ title: "Replace porch light" }),
  T({ title: "Look into a new drill" , someday: true }),
  T({ title: "Bananas", areaId: A["Errands & Groceries"], grocery: { cat: "produce", store: "Winco" } }),
  T({ title: "Diapers", areaId: A["Errands & Groceries"], grocery: { cat: "baby", store: null } }),
  T({ title: "Ground beef", areaId: A["Errands & Groceries"], grocery: { cat: "meat", store: "Winco" } }),
  T({ title: "2x4 studs (6)", areaId: A["Errands & Groceries"], grocery: { cat: "hardware", store: "Home Depot" } }),
  { ...T({ title: "Measure bathroom", projectId: "p1", areaId: A["Handyman Business"] }), status: "done", doneAt: now - 864e5 },
];
const backup = { app: "Clearhead", version: 2, exportedAt: new Date().toISOString(), settings: { ...C.DEFAULT_SETTINGS, contexts: C.DEFAULT_CONTEXTS, lastPlan: null, quietMode: false }, areas, projects, tasks, templates: [] };
writeFileSync(process.argv[2] || "seed-clearhead-backup.json", JSON.stringify(backup, null, 1));
console.log(tasks.length, "tasks");
