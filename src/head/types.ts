/* Head data shapes. These are Clearhead's own shapes (field names kept), so a Clearhead backup imports
   as-is and the ported logic in core/clearhead.js runs unchanged. `_u` is Bird Nest's sync stamp (ms). */

export type Tod = "morning" | "afternoon" | "evening" | null;
export type Energy = "low" | "med" | "high" | null;

export interface RepeatRule {
  freq: "day" | "week" | "month" | "year" | "after";
  interval: number;
  anchor?: string;
  days?: number[] | null;
  monthMode?: "date" | "nth";
  monthDay?: number | null;
  nth?: number;
  wd?: number;
  unit?: "day" | "week" | "month";
}

export interface ChecklistItem { id: string; text: string; done: boolean; }
export interface Waiting { who: string; since?: string | null; followUp?: string | null; }
export interface Handy {
  client?: string; address?: string; phone?: string; price?: string;
  materials?: ChecklistItem[];
}
export interface Client { name?: string; address?: string; phone?: string; price?: string; }

export interface Task {
  id: string;
  title: string;
  notes: string;
  areaId: string | null;
  projectId: string | null;
  sectionId: string | null;
  when: string | null;
  tod: Tod;
  time: string | null;
  due: string | null;
  someday: boolean;
  contexts: string[];
  energy: Energy;
  est: number | null;
  important: boolean;
  priority: "high" | "normal" | "low";
  checklist: ChecklistItem[];
  repeat: RepeatRule | null;
  waiting: Waiting | null;
  photos: string[];
  handy: Handy | null;
  grocery: { cat: string; store: string | null } | null;
  list: string | null;
  status: "open" | "done";
  doneAt: number | null;
  repeatNextId?: string | null; // the copy a repeating task made when it was finished (so reopening can take it back)
  calId?: string | null; // the calendar event this task was accepted from (Today: hold an all-day item)
  doneBy?: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
  todayOrder: number | null;
  reschedules: number;
  focusMinutes: number;
  history: { at: number; what: string }[];
  first?: string | null;     // "start with" star for a day (DayPlanner)
  _u?: number;
}

export interface Section { id: string; name: string; }

export interface Project {
  id: string;
  name: string;
  areaId: string | null;
  color: string | null;
  description: string;
  outcome: string;
  start: string | null;
  deadline: string | null;
  status: "active" | "someday" | "hold" | "done" | "archived";
  sections: Section[];
  notes: string;
  client: Client | null;
  photos: string[];
  order: number;
  createdAt: number;
  completedAt: number | null;
  archivedDone?: number;
  _u?: number;
}

export interface Area {
  id: string;
  name: string;
  color: string;
  icon: string;
  listMode: "groceries" | null;
  order: number;
  archived: boolean;
  createdAt: number;
  _u?: number;
}

export interface TemplateTask {
  title: string; notes?: string; contexts?: string[]; est?: number | null; energy?: Energy;
  checklist?: string[]; waiting?: { who: string } | null; repeat?: RepeatRule | null; materials?: boolean;
}
export interface Template {
  id: string; name: string; icon?: string; description?: string; outcome?: string; areaHint?: string;
  builtin?: boolean; client?: boolean; createdAt?: number;
  sections: { name: string; tasks: TemplateTask[] }[];
  _u?: number;
}

export interface TrashEntry {
  id: string;
  kind: "areas" | "projects" | "tasks";
  item: Area | Project | Task;
  group: string;
  primary: boolean;
  deletedAt: number;
}

export interface Photo { id: string; data: string; thumb: string; w: number; h: number; owner: string; at: number; }

export interface HeadSettings {
  weekStart: number;
  reviewDay: number;
  reviewTime: string;
  planTime: string;
  features: { estimates: boolean; energy: boolean; handyman: boolean };
  contexts: string[];
  lastPlan: string | null;
  lastReview: string | null;
  lastShutdown: string | null;
  shutdownTime: string;
  dndReminder: boolean;
  quietMode: boolean;
  offDays: number[];
  seeded?: boolean;
}

export interface HeadData {
  areas: Map<string, Area>;
  projects: Map<string, Project>;
  tasks: Map<string, Task>;
}
