import * as C from "./core/clearhead.js";
import type { HeadData, HeadSettings } from "./types";

/* Brain dump sorter. One messy block of text in (typed or dictated, run-on is fine);
   separate things out, each with a place to go: today, a date, later, someday, shopping, or a thought.
   Runs on the phone, no network. Built on Clearhead's ramble pieces (leads, fillers, quick-add parser). */

export type DumpDest = "today" | "date" | "later" | "someday" | "shop" | "thought";
export interface DumpItem {
  id: string; title: string; dest: DumpDest; keep: boolean;
  when: string | null; due: string | null; time: string | null; tod: string | null; est: number | null; contexts: string[];
  areaId: string | null; projectId: string | null;
}

const ABBR = /\b(pp|p|ch|st|dr|mr|mrs|ms|vs|etc|no|approx|appt|ave|rd|jr|sr)\./gi;
const DOT = "․"; // one-dot leader stands in for an abbreviation's period while splitting
const VERB_LIST = "call|text|email|phone|pay|buy|get|grab|pick up|order|schedule|book|fix|finish|send|write|read|study|clean|mow|return|ask|tell|text|check|book|plan|start|make|take|drop off|bring|wash|file|sign|print|review|prep|cancel|renew|confirm|meet|visit";
const CONNECT = new RegExp(String.raw`\s+(?:and then|then i|and also|also|plus|after that|oh and|oh,? and|another thing is|another thing|and i (?=need|have|gotta|should|want|got)|and (?=(?:${VERB_LIST})\b))\s*`, "i");
const VERB_START = new RegExp(String.raw`^(?:${VERB_LIST})\b`, "i");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const NEUTRAL = new Set(["then", "also", "and", "so", "first", "second", "next", "after that", "finally", "plus", "probably", "maybe"]);
const IDEA = /^(?:maybe\s+(?:someday|one day|eventually)\s*|someday\s*|one day\s*|eventually\s*|idea[:,-]?\s*|what if\s*|it(?:'|’)?d be (?:nice|cool|fun) to\s*|would be (?:nice|cool|fun) to\s*|i(?:'|’)?d (?:like|love) to\s*|i wish i could\s*|i want to (?:try|learn)\s*|look into\s*)/i;
const THOUGHT = /^(?:i(?:'|’)?m (?:so |really |kind of |pretty )?(?:worried|stressed|tired|nervous|anxious|excited|grateful|thankful|thinking|not sure|overwhelmed|behind|scared|frustrated)|i feel|i felt|i think|i wonder|i keep thinking|feeling|it(?:'|’)?s been|today was|honestly|i love|i hate)\b/i;
const MUST = /\b(need to|have to|gotta|got to|should|must|don'?t forget|remember to)\b/i;
const SHOP_LEAD = /^(?:buy|get|grab|pick up|order|need|we need|i need|we(?:'|’)?re out of|out of|low on|running low on|restock|more)\s+(?!to\b)(?:some\s+|more\s+|a few\s+|a couple\s+|a\s+|an\s+|the\s+)?(.+)$/i;
/* Grocery words from Clearhead's aisles, minus the little words that hide inside phrases ("half and half"). */
const SHOP_SKIP = new Set(["and", "half", "can", "hot", "light", "ice", "english", "sour", "dish", "bag", "bar", "roll", "pad", "paper", "plastic", "wrap", "ground", "deck", "bit", "blade", "drill", "water", "dog", "pie", "sauce", "fruit", "baking", "oil", "salt"]);
const SHOP_WORDS = new RegExp("\\b(?:" + C.GROCERY_CATS.flatMap((c) => c.words.split(/\s+/).filter((w) => w && !SHOP_SKIP.has(w))).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "i");

/* A shopping item is a short noun phrase ("a price on lumber" is a task, not lumber). */
const isShop = (s: string) => s.split(/\s+/).length <= 5 && !/\b(?:on|for|from|about|with|to|at|in|back|of)\b/i.test(s.replace(/^(?:out of|low on|running low on)\s+/i, "")) && (SHOP_WORDS.test(s) || C.MATERIAL_WORDS.test(s) || new RegExp(PAIRS.source, "i").test(s));
/* Two-word groceries that must stay together when a list has no commas ("milk eggs bread"). */
const PAIRS = /\b(ground beef|ground turkey|peanut butter|paper towels?|toilet paper|ice cream|sour cream|cream cheese|hot dogs?|half and half|english muffins?|trash bags?|dish soap|light bulbs?|bell peppers?|green beans|chicken (?:thighs|breasts?|wings)|baby wipes|almond milk|orange juice|coffee filters?|furnace filters?|olive oil|brown sugar|baking soda|lunch meat|string cheese)\b/gi;
const SHOP_WORD = (w: string) => SHOP_WORDS.test(w) || C.MATERIAL_WORDS.test(w);
function splitItem(x: string): string[] {
  const kept: string[] = [];
  const marked = x.replace(PAIRS, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  const ws = marked.split(/\s+/).filter(Boolean);
  const back = (w: string) => w.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]);
  if (ws.length >= 2 && ws.length <= 5 && ws.every((w) => /\u0000/.test(w) || SHOP_WORD(w))) return ws.map(back);
  return [back(marked)];
}
const splitList = (s: string) => s.split(/\s*(?:,|\band\b|&|\+)\s*/i)
  .map((x) => x.replace(/^(?:some|more|a few|a couple|a|an|the)\s+/i, "").replace(/[.\s]+$/, "").trim())
  .filter((x) => x.length > 1).flatMap(splitItem);
const isShopList = (s: string) => SHOP_LEAD.test(s) || (words(s) <= 4 && !VERB_START.test(s) && isShop(s.replace(/^.*,\s*/, "")));

/** Break a dump into separate thoughts. */
export function pieces(text: string): string[] {
  return linkedPieces(text).map((x) => x.text);
}

/* iPhone typing and dictation use curly quotes (I’m, Gayle’s). Straighten them first so every rule sees the same text. */
const straight = (s: string) => s.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
const LINK = /^(?:and then|then i|then|after that)$/i;

/** pieces(), plus whether each one was joined to the one before by "and then" / "after that". */
function linkedPieces(text: string): { text: string; linked: boolean }[] {
  const t = straight(text || "").replace(/\r/g, "")
    .replace(/^[ \t]*(?:[-•*·]|\d+[.)])\s+/gm, "\n")
    .replace(ABBR, (_m, a: string) => a + DOT)
    .replace(C.FILLER, " ")
    .replace(/[ \t]+/g, " ");
  const out: { text: string; linked: boolean }[] = [];
  const CONNECT_KEEP = new RegExp("(" + CONNECT.source + ")", "i");
  for (const sentence of t.split(/[!?;\n]+\s*|\.(?=\s|$)\s*/)) {
    const bits = sentence.split(CONNECT_KEEP);
    for (let bi = 0; bi < bits.length; bi += 2) {
      const clause = bits[bi];
      const linked = bi > 0 && LINK.test((bits[bi - 1] || "").trim());
      let first = true;
      // Talking runs things together with commas: split on every comma, then glue list items back on
      // ("out of milk, eggs, and diapers" stays one shopping list; "call mom, dad and grandma" stays one call).
      let cur = "";
      for (const raw of clause.split(/\s*,\s*/)) {
        const part = raw.trim();
        if (!part) continue;
        const item = part.replace(/^(?:and|&)\s+/i, "");
        const plain = cur && !VERB_START.test(item) && !C.LEADS.some((l) => item.toLowerCase().startsWith(l + " "));
        const curCore = cur.replace(/^(?:and|so|also|then|plus)\s+/i, "");
        if (plain && words(item) <= 4 && isShopList(curCore) && isShop(item)) cur += ", " + item;
        else if (plain && words(item) <= 6 && VERB_START.test(curCore) && / and /i.test(" " + part + " ") && !SHOP_LEAD.test(item) && !SHOP_WORDS.test(item) && !C.MATERIAL_WORDS.test(item)) cur += ", " + part;
        else { if (cur) { out.push({ text: cur, linked: linked && first }); first = false; } cur = part; }
      }
      if (cur) out.push({ text: cur, linked: linked && first });
    }
  }
  return out.map((x) => ({ ...x, text: x.text.replace(new RegExp(DOT, "g"), ".").replace(/^[,\s]+|[,\s]+$/g, "").trim() })).filter((x) => x.text.length > 1);
}

/* How people actually talk: "I'm going to need to…", "I'm gonna have to…". */
const VERB_WORDS = [...C.VERBS].join("|");
const GOING = new RegExp(String.raw`^(?:i'?m|i am|we'?re|we are)\s+(?:going to|gonna)\s+(?=(?:need|have|${VERB_WORDS})\b)`, "i");
const GOING_PLACE = /^(?:i'?m|i am|we'?re|we are)\s+(?:going to|gonna)\s+(?:go\s+to\s+|go\s+)?/i;

function stripLeads(p: string): { text: string; action: boolean } {
  let action = false, changed = true;
  if (GOING.test(p)) { p = p.replace(GOING, ""); action = true; }
  else if (GOING_PLACE.test(p)) { p = p.replace(GOING_PLACE, "go to "); action = true; }
  while (changed) {
    changed = false;
    for (const l of C.LEADS) {
      const re = new RegExp("^" + l.replace(/'/g, "['’]?") + "\\b[,]?\\s*", "i");
      if (re.test(p)) { p = p.replace(re, ""); changed = true; if (!NEUTRAL.has(l)) action = true; }
    }
  }
  return { text: p.replace(/^(?:to|i)\s+/i, "").replace(/[,\s]+$/, "").trim(), action };
}

const STOP = new Set(["redo", "remodel", "project", "update", "plan", "home", "house", "with", "from", "the", "and", "for", "this", "that", "new", "job", "work", "list"]);
const AREA_HINTS: [RegExp, RegExp][] = [
  [/\b(quote|estimate|client|invoice|bid|install|repair|drywall|tile|grout|paint|deck|faucet|outlet|wiring|hvac|handyman)\b/i, /handyman|business/i],
  [/\b(study|greek|hebrew|theology|class|exam|midterm|paper|chapter|homework|lecture|quiz|essay)\b/i, /theolog|degree|school|study/i],
  [/\b(church|ministry|kids ministry|camp|sermon|pastor|bible study|youth)\b/i, /church|ministry|faith/i],
  [/\b(yard|garage|kitchen|laundry|dishes|dog|baby|abby|abigail|wife|date night|lawn|garden)\b/i, /family|home/i],
];

function guessHome(title: string, data: HeadData): { areaId: string | null; projectId: string | null } {
  const low = title.toLowerCase();
  for (const p of C.activeProjects(data)) {
    const keys = p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
    if (keys.some((k) => new RegExp("\\b" + k + "\\b").test(low))) return { projectId: p.id, areaId: p.areaId ?? null };
  }
  const areas = C.areaList(data).filter((a) => !a.listMode);
  for (const [words, name] of AREA_HINTS) {
    if (!words.test(low)) continue;
    const a = areas.find((x) => name.test(x.name));
    if (a) return { areaId: a.id, projectId: null };
  }
  return { areaId: null, projectId: null };
}

/* "give around one hour", "about 2 hours", "takes 30 minutes", "for an hour and a half" → an estimate, out of the title. */
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, ninety: 90 };
const EST = /\b(?:(?:give(?: it)?|allow|plan(?: on| for)?|budget|takes?|taking|it'?ll take|will take|should take|for)\s+)?(?:(?:around|about|roughly|maybe|like|probably|approximately)\s+)(half an?|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty(?:-five)?|ninety|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b(?:\s+and a half)?(?:\s+(?:of|for)\s+[^,.]*)?|\b(?:give(?: it)?|allow|plan(?: on| for)?|budget|takes?|it'?ll take|will take|should take)\s+(half an?|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty(?:-five)?|ninety|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b(?:\s+and a half)?(?:\s+(?:of|for)\s+[^,.]*)?/i;
function takeEstimate(p: string): { text: string; est: number | null } {
  const m = p.match(EST);
  if (!m) return { text: p, est: null };
  const nRaw = (m[1] ?? m[3] ?? "").toLowerCase(), unit = (m[2] ?? m[4] ?? "").toLowerCase();
  const half = /^half/.test(nRaw) ? 0.5 : 0;
  const n = half || (NUM[nRaw] ?? parseFloat(nRaw));
  if (!n || Number.isNaN(n)) return { text: p, est: null };
  const extra = /and a half/i.test(m[0]) ? 0.5 : 0;
  const mins = Math.round(unit.startsWith("h") ? (n + extra) * 60 : n);
  return { text: (p.slice(0, m.index) + " " + p.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, " ").trim(), est: mins > 0 && mins <= 12 * 60 ? mins : null };
}

let n = 0;
const nid = () => `d${Date.now().toString(36)}${(n++).toString(36)}`;

export function sortDump(text: string, data: HeadData, s: HeadSettings): DumpItem[] {
  const today = C.today();
  const ctx = {
    weekStart: s.weekStart ?? 1, contexts: s.contexts || [],
    projects: [...data.projects.values()].filter((p) => p.status !== "done" && p.status !== "archived").map((p) => ({ id: p.id, name: p.name })),
    areas: C.areaList(data).map((a) => ({ id: a.id, name: a.name })),
  };
  const out: DumpItem[] = [];
  const seen = new Set<string>();
  const base = (title: string, dest: DumpDest): DumpItem => ({ id: nid(), title, dest, keep: true, when: null, due: null, time: null, tod: null, est: null, contexts: [], areaId: null, projectId: null });
  const add = (it: DumpItem) => { const k = it.dest + "|" + it.title.toLowerCase(); if (!it.title || seen.has(k)) return; seen.add(k); out.push(it); };

  let lastWhen: string | null = null;
  for (const { text: raw, linked } of linkedPieces(text)) {
    // Feelings and observations stay together as thoughts, unless they carry a "need to".
    if (THOUGHT.test(raw) && !MUST.test(raw)) { add(base(C.cap4(raw.replace(/[.\s]+$/, "")), "thought")); continue; }
    let p = raw, idea = false;
    const im = p.match(IDEA);
    if (im) { idea = true; p = p.slice(im[0].length); }
    const lead = stripLeads(p);
    p = lead.text;
    if (!p) continue;

    // Shopping: "buy milk, eggs and diapers", "out of coffee", or a bare list of groceries.
    const sm = p.match(SHOP_LEAD);
    const list = sm ? splitList(sm[1]) : !lead.action && /,|\band\b/.test(p) ? splitList(p) : [];
    if (list.length && list.filter(isShop).length >= Math.ceil(list.length * 0.6)) {
      for (const item of list) add(base(C.cap4(item), "shop"));
      continue;
    }
    if (sm && list.length === 1 && isShop(list[0])) { add(base(C.cap4(list[0]), "shop")); continue; }
    // "need a tarp and ratchet straps" isn't groceries: it's a thing to get.
    if (sm && /^(?:need|we need|i need)\b/i.test(p)) p = "get " + sm[1];
    const est = takeEstimate(p);
    p = est.text;
    // "…, should take about 2 hours" on its own: that's how long the thing before it takes.
    if (est.est && !/[a-z]{3,}/i.test(p.replace(/\b(?:it|that|this|take|takes|should|will|probably|maybe|about|around|so)\b/gi, ""))) {
      const prev = out[out.length - 1];
      if (prev && prev.dest !== "shop" && prev.dest !== "thought" && prev.est == null) prev.est = est.est;
      continue;
    }

    p = p.replace(/\bby\s+(?=(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|tonight|next|this|the\s+\d|end of|\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i, "due ");
    const parsed = C.parseQuickAdd(p, ctx);
    const f = parsed.fields;
    const title = C.cap4((parsed.title || p).replace(/(?:\s+(?:by|on|before|due|at|for|this|next|in|upcoming|coming|after|then|and))+$/i, "").replace(/[.\s]+$/, "").slice(0, 120));
    if (title.length < 3) continue;
    const home = f.projectId || f.areaId ? { projectId: f.projectId ?? null, areaId: f.areaId ?? null } : guessHome(title, data);
    // "…on Tuesday, and then take it to the dump": a step joined by "then" happens the same day.
    let when = (f.when as string | undefined) ?? null;
    if (!when && !f.due && !idea && linked && lastWhen) when = lastWhen;
    const dest: DumpDest = idea ? "someday" : when && when <= today ? "today" : when || f.due ? "date" : "later";
    add({
      ...base(title, dest),
      when: dest === "today" ? today : when, due: (f.due as string | undefined) ?? null,
      time: (f.time as string | undefined) ?? null, tod: (f.tod as string | undefined) ?? null, est: (f.est as number | undefined) ?? est.est,
      contexts: (f.contexts as string[] | undefined) ?? [], ...home,
    });
    if (when) lastWhen = when;
  }
  return out;
}

/** Move an item somewhere else; dates follow the destination. */
export function moveItem(it: DumpItem, dest: DumpDest, date?: string | null): DumpItem {
  const today = C.today();
  if (dest === "today") return { ...it, dest, when: today };
  if (dest === "date") return { ...it, dest, when: date ?? C.addDays(today, 1) };
  return { ...it, dest, when: null, ...(dest === "someday" || dest === "shop" || dest === "thought" ? { due: null, time: null } : {}) };
}
