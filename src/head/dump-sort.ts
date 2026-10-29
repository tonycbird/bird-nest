import { normTitle, sameTask } from "./same";
import * as C from "./core/clearhead.js";
import type { Area, HeadData, HeadSettings, Project, RepeatRule } from "./types";

/* Brain dump sorter. One messy block of text in (typed or dictated, run-on is fine). Out comes a plan:
   each thing as a short task title (the extra words kept in its notes), a day and time if one was said,
   the project or area it belongs to, and new projects when a rant is about a job that isn't on the list yet.
   Runs on the phone, offline, in a few milliseconds. Built on Clearhead's quick-add parser and word lists.

   How a rant is read:
   1. Split: paragraphs → sentences → clauses ("and then", "also", "and <verb>…") → comma lists (glued back
      together when they're one list: "milk, eggs and diapers").
   2. Topics: "Backyard: …", "For the Jon Wolfe project, …", "I want to build a deck for the Smiths." set what
      the next things are about. "Tomorrow: …" / "Sunday I need to …" set the day.
   3. Each clause: feelings → Thoughts; "maybe someday" → Someday; groceries → Shopping; the rest → a task.
   4. Titles: leads ("I'm going to need to") and fillers go; reasons ("because…") and conditions ("once…")
      move to notes; "it" becomes the thing named just before; long ones are cut at a natural break. */

export type DumpDest = "today" | "date" | "later" | "someday" | "shop" | "thought";
export interface DumpItem {
  id: string; title: string; dest: DumpDest; keep: boolean;
  when: string | null; due: string | null; time: string | null; tod: string | null; est: number | null; contexts: string[];
  areaId: string | null; projectId: string | null;
  /** The words that didn't fit in the title: why, on what condition, or the whole sentence when it was cut. */
  notes: string | null;
  /** A step of a project this dump is offering to make (DumpProject.key). */
  newProject: string | null;
  /** "every Monday" */
  repeat?: RepeatRule | null;
  /** Already on the list (that task's id): left unchecked so it isn't added twice. */
  dupOf?: string | null;
}
export interface DumpProject { key: string; name: string; areaId: string | null; outcome: string | null; deadline: string | null; on: boolean; client?: string | null; }
export interface DumpPlan { items: DumpItem[]; projects: DumpProject[]; }

/* ---------- words ---------- */

/* iPhone typing and dictation use curly quotes (I’m, Gayle’s). Straighten them first so every rule sees the same text. */
const straight = (s: string) => s.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
const ABBR = /\b(pp|p|ch|st|dr|mr|mrs|ms|vs|etc|no|approx|appt|ave|rd|jr|sr)\./gi;
const DOT = "․"; // one-dot leader stands in for an abbreviation's period while splitting
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EXTRA_VERBS = ["draw", "figure", "remind", "look", "go", "run", "put", "see", "help", "hire", "cook", "apply", "register", "practice",
  "memorize", "outline", "record", "upload", "download", "set", "finish", "print", "rent", "stain", "tear", "hang", "pick", "drop", "grab",
  "sort", "contact", "write", "pray", "practise", "message", "email", "text", "bake", "feed", "bathe", "watch", "grade", "turn", "change",
  "swap", "haul", "deal", "bring", "show", "start", "head", "give", "sweep", "tidy", "wipe", "fold", "iron", "vacuum", "unload", "load", "toss", "donate"];
const VERBS = new Set<string>([...C.VERBS, ...EXTRA_VERBS]);
const isVerb = (w: string | undefined) => !!w && VERBS.has(w.toLowerCase().replace(/[^a-z]/g, ""));
const VERB_RE = [...VERBS].sort((a, b) => b.length - a.length).map(esc).join("|");
const VERB_START = new RegExp(String.raw`^(?:${VERB_RE})\b`, "i");

/* Connectors that always start a new thing. "and <verb>" is decided case by case (see splitAndVerb). */
const CONNECT = /\s+(?:and then|then i|and also|also|plus|after that|oh and|oh,? and|another thing is|another thing|and (?=remember to|don't forget to)|and i (?=need|have|gotta|should|want|got|'ll|will)|and we (?=need|have|gotta|should))\s*/i;
const LINK_WORD = /^(?:and then|then i|then|after that|next|finally|once that's done)$/i;
const LINKED_START = /^(?:and\s+)?(?:then|after that|next|finally|once that's done)\b[,]?\s*/i;
const NEUTRAL = new Set(["then", "also", "and", "so", "first", "second", "next", "after that", "finally", "plus", "probably", "maybe"]);

const IDEA = /^(?:maybe\s+(?:someday|one day|eventually)\s*|someday\s*|one day\s*|eventually\s*|idea[:,-]?\s*|what if\s*|it'?d be (?:nice|cool|fun) to\s*|would be (?:nice|cool|fun) to\s*|i'?d (?:like|love) to\s*|i wish i could\s*|i want to (?:try|learn)\s*|look into\s*)/i;
const THOUGHT = /^(?:i'?m (?:so |really |kind of |pretty )?(?:worried|stressed|tired|nervous|anxious|excited|grateful|thankful|thinking|not sure|overwhelmed|behind|scared|frustrated|exhausted|burned out|sad|happy|angry|upset|lonely|discouraged|encouraged|proud|blessed|bummed|done with)|i feel|i don'?t know (?:where|how|what|if)|i felt|i think(?! (?:i|we) (?:need|have|should))|i wonder|i keep thinking|feeling|it'?s been|today was|honestly|i love|i hate)\b/i;
const MUST = /\b(need to|have to|gotta|got to|should|must|don'?t forget|remember to)\b/i;
const SHOP_LEAD = /^(?:buy|get|grab|pick up|order|need|we need|i need|we'?re out of|out of|low on|running low on|restock|more)\s+(?!to\b)(?:some\s+|more\s+|a few\s+|a couple\s+|a\s+|an\s+|the\s+)?(.+)$/i;
/* Grocery words from Clearhead's aisles, minus the little words that hide inside phrases ("half and half"). */
const SHOP_SKIP = new Set(["and", "half", "can", "hot", "light", "ice", "english", "sour", "dish", "bag", "bar", "roll", "pad", "paper", "plastic", "wrap", "ground", "deck", "bit", "blade", "drill", "water", "dog", "pie", "sauce", "fruit", "baking", "oil", "salt", "prescription", "medicine"]);
const END = "(?:s|es|ies|y)?\\b"; // whole words, plurals too ("strawberr" → strawberries; "baby" ≠ babysitter)
const SHOP_WORDS = new RegExp("\\b(?:" + C.GROCERY_CATS.flatMap((c) => c.words.split(/\s+/).filter((w) => w && !SHOP_SKIP.has(w))).map(esc).join("|") + ")" + END, "i");
/* Two-word groceries that must stay together when a list has no commas ("milk eggs bread"). */
const PAIRS = /\b(ground beef|ground turkey|peanut butter|paper towels?|toilet paper|ice cream|sour cream|cream cheese|hot dogs?|half and half|english muffins?|trash bags?|dish soap|light bulbs?|bell peppers?|green beans|chicken (?:thighs|breasts?|wings)|baby wipes|almond milk|orange juice|coffee filters?|furnace filters?|olive oil|brown sugar|baking soda|lunch meat|string cheese)\b/gi;
const PAIR1 = new RegExp(PAIRS.source, "i");
const SHOP_WORD = (w: string) => SHOP_WORDS.test(w) || C.MATERIAL_WORDS.test(w);
/* A shopping item is a short noun phrase ("a price on lumber" is a task, not lumber). */
const isShop = (s: string) => !/\b[a-z]+'s\b/i.test(s) && s.split(/\s+/).length <= 5 && !/\b(?:on|for|from|about|with|to|at|in|back|of)\b/i.test(s.replace(/^(?:out of|low on|running low on)\s+/i, "")) && (SHOP_WORDS.test(s) || C.MATERIAL_WORDS.test(s) || PAIR1.test(s));
/* Food and house things (not the Hardware aisle): these go on the grocery list even when a project is being talked about. */
const FOOD_WORDS = new RegExp("\\b(?:" + C.GROCERY_CATS.filter((c) => c.id !== "hardware").flatMap((c) => c.words.split(/\s+/).filter((w) => w && !SHOP_SKIP.has(w))).map(esc).join("|") + ")" + END, "i");
const isFood = (s: string) => FOOD_WORDS.test(s) || PAIR1.test(s);
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

/* ---------- 1. split ---------- */

interface Piece { text: string; linked: boolean; para: number; sent: number; first: boolean; header?: string; }

/** Break a dump into separate things. */
export function pieces(text: string): string[] {
  return split(text).filter((p) => !p.header).map((p) => p.text);
}

/** "print the lessons and set up the table" → two things; "rake and level it", "out of milk and water" stay one. */
function splitAndVerb(clause: string): string[] {
  const out: string[] = [];
  let rest = clause;
  for (;;) {
    const re = new RegExp(String.raw`\s+and\s+(?=(?:${VERB_RE})\b)`, "ig");
    let m: RegExpExecArray | null, cut = -1, len = 0;
    const em = rest.match(EST); // "…give around an hour of loading and dump trip" is one estimate, not two things
    while ((m = re.exec(rest))) {
      if (em && m.index >= em.index! && m.index < em.index! + em[0].length) continue;
      // "text Aaron and see if he can help" is one message, not two things.
      if (/^(?:see|ask|check|find out)\s+(?:if|whether|when|what|about)\b|^let (?:him|her|them) know\b/i.test(rest.slice(m.index + m[0].length))) continue;
      if (/^(?:ask|tell)\s+(?:him|her|them)\b/i.test(rest.slice(m.index + m[0].length)) && PEOPLE_VERB.test(rest)) continue;
      // Only the part after the last comma counts as the left side ("…morning, then cut and install them").
      const left = rest.slice(0, m.index).split(",").pop()!.trim().replace(LINKED_START, ""), right = rest.slice(m.index + m[0].length).trim();
      // The left side must already be a whole thing (a verb and what it acts on); the right side a verb and its thing.
      // Look past "Sunday I need to…" to find the verb.
      const lw = stripLeads(left.replace(LEAD_DAY, "")).text.split(/\s+/);
      if (lw.length >= 2 && isVerb(lw[0]) && words(right) >= 2) { cut = m.index; len = m[0].length; break; }
    }
    if (cut < 0) { out.push(rest); break; }
    out.push(rest.slice(0, cut)); rest = rest.slice(cut + len);
  }
  return out;
}

/* ---------- dictation: one long run-on with no commas ---------- */

const BR = "\u2029"; // where a new thing starts inside a run-on
/* Words that start a new thing when they follow a finished one: "…the kids room print the coloring sheets". */
const SPLIT_VERBS = new Set(("call text email phone pick drop buy pay schedule return send finish start clean fix install replace measure grab take bring " +
  "mow print grout seal stain caulk sand prime hang cut build tear haul rent renew cancel confirm sign submit read study review write wash load unload " +
  "rake dig plant mail ask tell remind meet visit drive go head get check look see order book paint set give pull put move empty fill test pick").split(" "));
/* …but not after these ("the paint color", "to check", "I need to call", "and order"). */
const NO_PREV = new Set(("the a an to and or i we you he she they it will can could should must need needs have has had gotta got please also then just " +
  "really still of for my our your his her their its this that these those would might may let's lets don't didn't doesn't won't can't not new old " +
  "first last next to-do work oil water front back fall spring summer winter kids kid's tile trim paint power test check work book set order " +
  "someday eventually maybe probably definitely ideally hopefully actually").split(" "));
/* The word after the verb has to look like the start of its object. */
const OBJ_START = new Set("the a an my our his her their it them him some all up out off back over everything this that those these".split(" "));
const DEPENDENT = new Set("if when that because so before after since until what where how which who think thought said says guess hope wish know whether".split(" "));

function breakRunOn(sentence: string): string {
  let t = " " + sentence + " ";
  const mark = (re: RegExp, ok: (before: string) => boolean = () => true) => {
    t = t.replace(re, (m: string, ...args: unknown[]) => {
      const at = args[args.length - 2] as number;
      const before = t.slice(0, at).trim();
      const prev = before.split(/\s+/).pop()?.toLowerCase() ?? "";
      if (!before || before.endsWith(BR) || DEPENDENT.has(prev) || !ok(before)) return m;
      return " " + BR + m.trimStart();
    });
  };
  // "…for the jon wolfe job I need 2x4s", "…along the fence we need…"
  mark(/\s(?=(?:i|we)\s+(?:also\s+|still\s+|really\s+|probably\s+)?(?:need|have to|gotta|got to|should|must|want to|wanna|will|'ll|can)\b)/gi,
    (b) => !/\b(?:i|we|you)$/i.test(b));
  mark(/\s(?=(?:i'?m|i am|we'?re|we are)\s+(?:going to|gonna)\b)/gi);
  mark(/\s(?=(?:and\s+)?(?:i'?m|i am|i feel|i'?ve been)\s+(?:so\s+|really\s+|kind of\s+|pretty\s+|a little\s+)?(?:stressed|worried|tired|nervous|anxious|excited|overwhelmed|behind|scared|frustrated|not sure|exhausted|burned out)\b)/gi);
  // "…before thanksgiving need to measure first"
  mark(/\s(?=(?:need to|have to|gotta|got to|remember to|don't forget to)\s(?!be\s+(?:done|finished|ready|complete|completed|submitted|turned in|in)\b))/gi,
    (b) => !/\b(?:i|we|you|he|she|they|will|really|still|also|just|probably|definitely|to|and|or|might|may|'ll|don't|didn't|doesn't|i'll|we'll|would|wants?|needs?)$/i.test(b));
  // "…the storm door they want it done…", "…it's leaking again"
  mark(/\s(?=(?:they|he|she)\s+(?:want|wants|need|needs|said|asked|told|would like)\b)/gi);
  mark(/\s(?=(?:it'?s|it is|that'?s)\s+(?:leaking|broken|peeling|cracked|loose|stuck|dripping|making|not|still|getting|been|due|about)\b)/gi);
  // "…take out the trash and every other week mow the lawn"
  mark(/\s(?=(?:and\s+)?every\s+(?:other\s+)?(?:day|week|month|year|mon|tue|wed|thu|fri|sat|sun|morning|night|evening|weekday|weekend)\w*\b)/gi,
    (b) => words(b.split(BR).pop()!) >= 2);
  // "…along the fence then rototill" (not "by then", "and then" — that one's already a connector)
  mark(/\s(?=then\s)/gi, (b) => !/\b(?:by|until|since|back|and|now|just|but)$/i.test(b));
  // Verb after a finished thing: "…set up the kids room print the coloring sheets…", "…backsplash grout it monday seal it…"
  const w = t.split(/(\s+)/);
  for (let i = 2; i < w.length - 2; i += 2) {
    const word = w[i].toLowerCase(), prev = (w[i - 2] ?? "").toLowerCase().replace(/[^a-z'-]/g, ""), next = (w[i + 2] ?? "").toLowerCase();
    const afterTime = /^\d{1,2}(?::\d\d)?(?:am|pm)?$/.test((w[i - 2] ?? "").toLowerCase()); // "…at 7 bring snacks"
    if (!SPLIT_VERBS.has(word) || NO_PREV.has(prev) || (!prev && !afterTime) || (w[i - 2] ?? "").includes(BR)) continue;
    if (!OBJ_START.has(next) && !/^\d/.test(next) && !afterTime) continue;
    const since = w.slice(0, i).join("").split(BR).pop()!.trim();
    if (words(since) < 2) continue;
    // "every monday take out the trash", "tomorrow morning call…": a when, not a finished thing.
    if (/^(?:and\s+)?(?:every\s+(?:other\s+)?\w+|(?:on|this|next)\s+\w+|tomorrow|today|tonight|(?:mon|tue|wed|thu|fri|sat|sun)\w*)(?:\s+(?:morning|afternoon|evening|night|at\s+\S+))?$/i.test(since)) continue;
    w[i] = BR + w[i];
  }
  return w.join("").trim();
}

const LEAD_DAY = /^(?:on\s+|this\s+|next\s+)?(?:mon|tues|tue|wednes|wed|thurs|thu|fri|satur|sat|sun)(?:day)?\b,?\s*|^(?:tomorrow|today|tonight|this (?:morning|afternoon|evening|weekend)|next week)\b,?\s*/i;
const HEADER_COLON = /^\s*([^:,.]{2,48}?)\s*(?::|\s[-–—]\s)\s*(.*)$/;
const HEADER_FOR = /^(?:as for|for|on|with|about|re|regarding|over at)\s+(?:the\s+)?([^,]{2,40}?)\s*,\s*(.+)$/i;

function split(text: string): Piece[] {
  let t0 = straight(text || "").replace(/\r/g, "");
  // "1. finish trim 2. paint 3. send invoice" — numbers only count as a list when they go 1, 2…
  if (/(?:^|\s)1[.)]\s/.test(t0) && /\s2[.)]\s/.test(t0)) t0 = t0.replace(/(^|\s)\d{1,2}[.)]\s+(?=[a-z])/gi, "\n");
  const t = t0
    .replace(/^[ \t]*(?:[-•*·]|\d+[.)])\s+/gm, "\n")
    .replace(ABBR, (_m, a: string) => a + DOT)
    .replace(C.FILLER, " ")
    .replace(/[ \t]+/g, " ");
  const out: Piece[] = [];
  let sent = 0;
  const paras = t.split(/\n[ \t]*\n/);
  paras.forEach((para, pi) => {
    for (let sentence of para.split(/[!?;\n]+\s*|\.(?=\s|$)\s*/)) {
      sentence = sentence.trim();
      if (!sentence) continue;
      sent++;
      // "Backyard: …", "Jon Wolfe - …", "Tomorrow: …"
      const hc = sentence.match(HEADER_COLON);
      if (hc && words(hc[1]) <= 6 && !isVerb(hc[1].split(/\s+/)[0])) { out.push({ text: "", header: hc[1].trim(), linked: false, para: pi, sent, first: true }); sentence = hc[2]; }
      // "For the Jon Wolfe project, …"
      const hf = sentence.match(HEADER_FOR);
      if (hf && words(hf[1]) <= 5 && !isVerb(hf[1].split(/\s+/)[0]) && !/^(?:me|you|him|her|us|them|it)$/i.test(hf[1])) { out.push({ text: "", header: hf[1].trim(), linked: false, para: pi, sent, first: true }); sentence = hf[2]; }
      if (!sentence.trim()) continue;
      let first = true;
      const CONNECT_KEEP = new RegExp("(" + CONNECT.source + ")", "i");
      const bits = breakRunOn(sentence).split(CONNECT_KEEP);
      for (let bi = 0; bi < bits.length; bi += 2) {
        const sepLinked = bi > 0 && LINK_WORD.test((bits[bi - 1] || "").trim());
        for (const clause of bits[bi].split(BR).flatMap((c, ci) => splitAndVerb(ci === 0 ? c : c.trim()))) {
          // Talking runs things together with commas: split on every comma, then glue list items back on
          // ("out of milk, eggs, and diapers" stays one shopping list; "call mom, dad and grandma" stays one call).
          let cur = "", curLinked = sepLinked;
          const push = () => { if (cur.trim()) { out.push({ text: cur, linked: curLinked || LINKED_START.test(cur.trim()), para: pi, sent, first }); first = false; } };
          for (const raw of clause.split(/\s*,\s*/)) {
            const part = raw.trim();
            if (!part) continue;
            const item = part.replace(/^(?:and|&)\s+/i, "");
            const plain = cur && !VERB_START.test(item) && !LINKED_START.test(item) && !C.LEADS.some((l) => item.toLowerCase().startsWith(l + " "));
            const curCore = cur.replace(/^(?:and|so|also|then|plus)\s+/i, "");
            if (plain && words(item) <= 4 && isShopList(curCore) && isShop(item)) cur += ", " + item;
            else if (plain && words(item) <= 6 && VERB_START.test(curCore) && / and /i.test(" " + part + " ") && !SHOP_LEAD.test(item) && !SHOP_WORDS.test(item) && !C.MATERIAL_WORDS.test(item)) cur += ", " + part;
            else if (plain && words(item) <= 6 && /^(?:pick up|get|grab|buy|order|bring|need)\b/i.test(curCore) && /^(?:a|an|some|the|\d+|more)\b/i.test(item)) cur += ", " + part;
            else { if (cur) { push(); curLinked = false; } cur = part; }
          }
          push();
        }
      }
    }
  });
  return out.map((x) => ({ ...x, text: x.text.replace(new RegExp(DOT, "g"), ".").replace(/^[,\s]+|[,\s]+$/g, "").replace(/\s+(?:and|so|then|also|but|or)$/i, "").trim() }))
    .filter((x) => x.header || x.text.length > 1);
}

/* ---------- 2. leads, fillers, reasons ---------- */

/* How people actually talk: "I'm going to need to…", "I'm gonna have to…", "remind me to…". */
const GOING = new RegExp(String.raw`^(?:i'?m|i am|we'?re|we are)\s+(?:going to|gonna)\s+(?=(?:need|have|${VERB_RE})\b)`, "i");
const GOING_PLACE = /^(?:i'?m|i am|we'?re|we are)\s+(?:going to|gonna)\s+(?:go\s+to\s+|go\s+)?/i;
const EXTRA_LEADS = ["remind me to", "don't let me forget to", "need to remember to", "i should probably", "i probably need to", "i probably should",
  "i think i need to", "i think we need to", "i guess i need to", "i still have to", "i also have to", "we also need to", "i've gotta", "we gotta",
  "i have got to", "i'll have to", "we'll have to", "i'll need to", "i need to go ahead and", "go ahead and", "try to", "i want to", "we want to",
  "i need", "we need to go", "first", "and"];
const LEAD_RES = [...EXTRA_LEADS, ...C.LEADS].sort((a, b) => b.length - a.length)
  .map((l) => ({ l, re: new RegExp("^" + l.replace(/'/g, "'?") + "\\b[,]?\\s*", "i") }));

function stripLeads(p: string): { text: string; action: boolean } {
  let action = false, changed = true;
  if (GOING.test(p)) { p = p.replace(GOING, ""); action = true; }
  else if (GOING_PLACE.test(p)) { p = p.replace(GOING_PLACE, "go to "); action = true; }
  while (changed) {
    changed = false;
    for (const { l, re } of LEAD_RES) {
      // "I need milk" keeps its "need" for the shopping check below.
      if (l === "i need" && !/^i need\s+(?:to|a|an|some|more|the)\b/i.test(p)) continue;
      if (re.test(p)) { p = p.replace(re, ""); changed = true; if (!NEUTRAL.has(l)) action = true; }
    }
  }
  return { text: p.replace(/^(?:to|i)\s+/i, "").replace(/[,\s]+$/, "").trim(), action };
}

const FILL_MID = /\b(?:just|really|actually|basically|definitely|literally|kind of|sort of|you know|i mean|honestly|somehow|real quick|quickly|asap|probably|sometime|at some point|ok so|okay so)\b\s*/gi;
const PHRASES: [RegExp, string][] = [
  [/\s+to remind (?:them|him|her|everyone|people)\s+(?=about|of)\b/i, " "],
  [/\bcheck in\b/gi, "check-in"],
  [/^figure out what to do (?:about|with)\s+/i, "sort out "],
  [/^(?:get in touch with|reach out to|touch base with)\s+/i, "contact "],
  [/^make (?:an|the) appointment (?:for|with)\s+/i, "book "],
  [/^take care of\s+/i, "handle "],
  [/^get (?:a|the) hold of\s+/i, "contact "],
  [/^get (?:the|a)\s+(.+?)\s+(?:fixed|done|finished|sorted)\b/i, "finish the $1"],
  [/\s+as well as\s+/gi, " and "],
];
/* Talking to the app instead of about the task: "add a simple task for fixing the outlet" → "Fix the outlet". */
const META_TASK = /^(?:please\s+)?(?:(?:add|make|create|set|put|write)(?:\s+(?:down|up|me))?\s+(?:a|an)?\s*(?:simple|quick|new|little|small)?\s*(?:task|to-?do|reminder|note)(?:\s+item)?\s+(?:for|to|that|about|on)\s+|(?:put|write)\s+down\s+(?:that\s+)?|note to self:?\s+|add to (?:my|the) (?:list|to-?do list)\s+(?:to\s+)?)(?:i\s+(?:need|have|gotta|got)\s+to\s+|we\s+(?:need|have)\s+to\s+)?/i;
function metaTask(t: string): string {
  if (!META_TASK.test(t)) return t;
  let rest = t.replace(META_TASK, "");
  // "fixing the outlet" → "fix the outlet"
  const m = rest.match(/^([a-z]+?)ing\b/i);
  if (m) {
    const stem = m[1].toLowerCase();
    const v = [stem, stem + "e", stem.replace(/(.)\1$/, "$1")].find((c) => VERBS.has(c));
    if (v) rest = v + rest.slice(m[0].length);
  }
  return rest.trim() ? rest : t;
}
/* Why and when-if words: they matter, but in the notes, not the title. */
const REASON = /\s+(?:because|cause|'cause|cuz|since|so that|so i can|so we can|so he can|so she can|so they can|so it can|in order to|that way|which|otherwise|just in case|in case)\b/i;
/* "Coffee with Mark to go over the deck": for a meetup, the purpose is notes. */
const MEETUP = /\b(?:coffee|lunch|breakfast|dinner|drinks|meet|meeting|starbucks|dutch bros)\b/i;
const PURPOSE = /\s+to\s+(?:go over|talk about|talk through|talk|discuss|catch up|plan|review|look at|figure out)\b/i;
const COND = /\s+(?:once|as soon as|whenever|if|unless|until|when)\s+(?!(?:mon|tue|wed|thu|fri|sat|sun)\w*\b|tomorrow\b|today\b|tonight\b|next\b|lunch\b|dinner\b|breakfast\b)/i;
const BREAKS = new Set(["at", "in", "on", "for", "with", "from", "to", "about", "under", "near", "by", "so", "and", "while", "during", "over", "into", "before", "after"]);
const PARTICLES = new Set(["up", "off", "out", "down", "back", "over", "in", "away", "together", "through"]);
const PREPS = new Set(["to", "from", "at", "on", "for", "with", "in", "by", "about", "into", "under", "near", "over", "before", "after", "of"]);

/** The thing a task acts on: "Pick up the trim boards from Home Depot" → "the trim boards". */
function objectOf(title: string): string | null {
  const w = title.split(/\s+/);
  if (!isVerb(w[0])) return null;
  let i = 1;
  while (w[i]?.toLowerCase() === "and" && isVerb(w[i + 1])) i += 2;
  if (PARTICLES.has(w[i]?.toLowerCase() ?? "")) i++;
  if (/^(?:go|come)$/i.test(w[0]) && isVerb(w[i])) return objectOf(w.slice(i).join(" ")); // "go look at it"
  const obj: string[] = [];
  for (; i < w.length && !PREPS.has(w[i].toLowerCase()); i++) obj.push(w[i]);
  const o = obj.join(" ").trim();
  if (!o || /^(?:it|them|that|this|those|these|him|her|me|us|everything|stuff|things|first|again|now|later|today|tomorrow|too|also|early|back)$/i.test(o) || words(o) > 5 || isVerb(o.split(" ")[0])) return null;
  return o;
}

/** "Cut and install them" → "Cut and install the trim boards"; "go look at it" → "go look at the deck stain". */
function resolveIt(title: string, last: string | null): string {
  if (!last) return title;
  const w = title.split(/\s+/);
  if (!isVerb(w[0])) return title;
  for (let i = 1; i < w.length; i++) {
    if (!/^(?:it|them)$/i.test(w[i])) continue;
    if (/^(?:a|an|the|some|my|our)$/i.test(w[i + 1] ?? "")) return title; // "give them a price": them = people
    if (/^(?:remind|tell|ask|call|text|email|give|send|show|pay|thank|help|let|meet|invite|pick|drop)$/i.test(w[i - 1])) return title; // "remind them", "call them"
    w[i] = last;
    return w.join(" ");
  }
  return title;
}

/** Long titles stop at a natural break; the whole thing stays in the notes. */
function shorten(title: string, max = 9): { title: string; cut: boolean } {
  const w = title.split(/\s+/);
  if (w.length <= max) return { title, cut: false };
  let at = -1;
  for (let i = 4; i <= max && i < w.length; i++) if (BREAKS.has(w[i].toLowerCase())) at = i;
  const keep = at > 0 ? w.slice(0, at) : w.slice(0, max);
  while (keep.length > 3 && /^(?:the|a|an|and|of|my|our|to)$/i.test(keep[keep.length - 1])) keep.pop();
  return { title: keep.join(" "), cut: true };
}

/* ---------- names ---------- */

const FIRST_NAMES = new Set(`aaron abby abigail adam alex alexis alicia allison amanda amber amy andrea andrew andy angela anna anne anthony ashley austin barb barbara ben
benjamin beth bethany billy bob bobby brad bradley brandon brenda brian brittany brooke bruce bryan caleb cameron carl carla carlos carol caroline
carrie casey cathy chad charles charlie chelsea cheryl chris christian christina christine christopher cindy claire clint cody colin connor courtney
craig crystal curtis cynthia dad dale dan dana daniel danielle danny darren dave david deb debbie deborah denise dennis derek diana diane dominic
donald donna doug douglas dustin dylan eddie edward elijah elizabeth ellie emily emma eric erica erin ethan eva evan frank gabe gabriel gail gary
gavin gayle george grandma grandpa greg gregory hailey haley hannah heather helen henry hunter ian isaac isabella jackie jacob jake james jamie jane
janet jared jason jay jeff jeffrey jen jenna jennifer jenny jeremy jerry jesse jessica jill jim jimmy joanna jodi joe joel john johnny jon jonathan
jordan jose joseph josh joshua judy julia julie justin karen kate katie kathy katherine kayla keith kelly ken kendra kenny kevin kimberly kirk
kristen kristin kyle larry laura lauren leah leo linda lisa liz logan lori lucas luke lynn madison mandy marc marcus maria martha martin mary matt
matthew megan melanie melissa michael michelle mike mitch molly mom monica morgan nancy natalie nate nathan nicholas nick nicole noah olivia owen pam
patrick paul peggy pete peter phil phillip rachel randy raydeane rebecca renee richard rick rischa robert roger ron ronald ross russ ruth ryan sam
samantha samuel sandra sara sarah scott sean seth shane shannon sharon shawn sheila shelby sherry sophia stacy stephanie stephen steve steven susan
tammy tanner tara taylor ted teresa terry tiffany tim timothy tina todd tom tommy tony tracy travis trevor tyler valerie vanessa victoria vince wayne
wendy wesley william zach zachary`.split(/\s+/));
const NOT_NAMES = new Set(["the", "a", "an", "my", "our", "his", "her", "their", "him", "them", "back", "about", "up", "in", "out", "someone", "everyone",
  "people", "client", "county", "city", "bank", "office", "shop", "store", "doctor", "dentist", "plumber", "electrician", "supplier", "landlord", "boss",
  "team", "church", "school", "insurance", "company", "guy", "lady", "contractor", "inspector", "it", "that", "this", "on", "for", "to", "with", "and"]);
/* Everyday words that never start a last name. */
const COMMON = new Set(`about above after again against all also and any are around ask back because been before being below between both but can come
could day did does doing done down during each early else ever every few first for from get gets got had has have her here hers him his home house how
into its just know last late later let like made make many may maybe might more morning afternoon evening night most much must need needs next not now
off once one only onto other our out over own please put said same say says see she should since some soon still such sure take than thank thanks that
the their them then there these they thing things this those though through today together tomorrow tonight too two under until upon very want wants was
way week weekend well went were what when where which while who why will with would yet you your yours again stuff too also maybe really`.split(/\s+/));
const PLACES: [RegExp, string][] = [
  [/\bhome depot\b/gi, "Home Depot"], [/\blowe'?s\b/gi, "Lowe's"], [/\bcostco\b/gi, "Costco"], [/\bwinco\b/gi, "WinCo"], [/\bwalmart\b/gi, "Walmart"],
  [/\bamazon\b/gi, "Amazon"], [/\bavista\b/gi, "Avista"], [/\bkootenai electric\b/gi, "Kootenai Electric"], [/\bmenards\b/gi, "Menards"],
  [/\bace hardware\b/gi, "Ace Hardware"], [/\bsherwin[- ]williams\b/gi, "Sherwin-Williams"], [/\bfred meyer\b/gi, "Fred Meyer"], [/\bnorth 40\b/gi, "North 40"],
  [/\bharbor freight\b/gi, "Harbor Freight"], [/\bles schwab\b/gi, "Les Schwab"], [/\bcoeur d'?alene\b/gi, "Coeur d'Alene"], [/\bpost falls\b/gi, "Post Falls"],
  [/\bspokane\b/gi, "Spokane"], [/\bthe heart\b/g, "The Heart"], [/\bnetflix\b/gi, "Netflix"], [/\bgoogle\b/gi, "Google"],
  [/\bspotify\b/gi, "Spotify"], [/\byoutube\b/gi, "YouTube"], [/\bvenmo\b/gi, "Venmo"], [/\bpaypal\b/gi, "PayPal"], [/\bverizon\b/gi, "Verizon"],
  [/\bfacebook\b/gi, "Facebook"], [/\bmarketplace\b/gi, "Marketplace"], [/\bdmv\b/gi, "DMV"], [/\bups\b/g, "UPS"], [/\busps\b/gi, "USPS"],
  [/\bfedex\b/gi, "FedEx"], [/\bcanvas\b/gi, "Canvas"], [/\bnest\b/g, "Nest"],
  // Books of the Bible that can't be anything else; the rest only after "book of".
  [/\b(genesis|exodus|leviticus|deuteronomy|isaiah|jeremiah|ezekiel|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|hebrews|revelation|psalms|proverbs|ecclesiastes)\b/gi, "$BOOK"],
];
const PEOPLE_VERB = /^(?:call|text|email|message|ask|tell|remind|thank|invite|pay|meet|visit|see|contact|ping|follow up with)\s+/i;
const WEEKDAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|thanksgiving|christmas|easter|halloween)\b/gi;

/** Capitals where they belong: names, places, days, "I". */
function caps(title: string, known: Map<string, string>): string {
  let t = title.replace(/\bi\b/g, "I").replace(/\bi'(m|ll|ve|d)\b/gi, (_m, x: string) => "I'" + x.toLowerCase());
  for (const [re, name] of PLACES) t = t.replace(re, (w) => (name === "$BOOK" ? w[0].toUpperCase() + w.slice(1).toLowerCase() : name));
  t = t.replace(/\bbook of ([a-z]+)/gi, (_m, b: string) => "book of " + b[0].toUpperCase() + b.slice(1));
  // "professor davis", "pastor mike" → both capitalized.
  t = t.replace(/\b(professor|pastor|dr|mr|mrs|ms|coach|uncle|aunt|grandma|grandpa)\.?\s+([a-z][a-z']+)/gi, (m, ti: string, nm: string) =>
    NOT_NAMES.has(nm.toLowerCase()) ? m : ti[0].toUpperCase() + ti.slice(1).toLowerCase() + " " + nm[0].toUpperCase() + nm.slice(1));
  t = t.replace(WEEKDAY_WORDS, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  t = t.replace(/\b([a-z][a-z']*)\b/g, (w) => {
    const base = w.replace(/'s$/, "");
    const k = known.get(base);
    if (k) return k + w.slice(base.length);
    if (FIRST_NAMES.has(base) && !NOT_NAMES.has(base)) return base[0].toUpperCase() + base.slice(1) + w.slice(base.length);
    // "over to jons" → "Jon's"
    if (/s$/.test(w) && (known.has(w.slice(0, -1)) || FIRST_NAMES.has(w.slice(0, -1)))) { const b = known.get(w.slice(0, -1)) ?? w[0].toUpperCase() + w.slice(1, -1); return b + "'s"; }
    if (/^(?:greek|hebrew|latin|english|spanish)$/.test(w)) return w[0].toUpperCase() + w.slice(1);
    return w;
  });
  // A last name after a first name: "Gayle bent" → "Gayle Bent", "Sarah jones" → "Sarah Jones". Not "Dave move", "Abby about".
  t = t.replace(/(?<=\S\s)([A-Z][a-z]+) ([a-z]{3,})\b/g, (m, first: string, w: string) => {
    if (!FIRST_NAMES.has(first.toLowerCase()) || NOT_NAMES.has(w) || COMMON.has(w) || WEEKDAY_WORDS.test(w)) { WEEKDAY_WORDS.lastIndex = 0; return m; }
    WEEKDAY_WORDS.lastIndex = 0;
    const bases = [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ed$/, ""), w.replace(/ed$/, "e"), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/ied$/, "y")];
    return bases.some((b) => VERBS.has(b)) ? m : first + " " + w[0].toUpperCase() + w.slice(1);
  });
  // The word after call/text/… is a person ("Call Smith"), unless it's a common word.
  t = t.replace(/^(\S+\s+)([a-z][a-z']+)\b/, (m, v: string, w: string) => (PEOPLE_VERB.test(v) && !NOT_NAMES.has(w) && w.length > 2 ? v + w[0].toUpperCase() + w.slice(1) : m));
  return t;
}

/* ---------- 3. projects and areas ---------- */

const STOP = new Set(["redo", "remodel", "project", "projects", "update", "plan", "home", "house", "with", "from", "the", "and", "for", "this", "that", "new",
  "job", "jobs", "work", "list", "buy", "materials", "stuff", "things", "misc", "task", "tasks", "get", "call", "make", "fix", "finish", "start", "order", "pick",
  "set", "put", "take", "one", "two", "all", "out", "about", "our", "your", "their", "his", "her", "its", "into", "some", "more"]);
const norm = (s: string) => s.toLowerCase().replace(/\bback\s+yard\b/g, "backyard").replace(/\bfront\s+yard\b/g, "frontyard").replace(/'s\b/g, "");
const stem = (w: string) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -1) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);

/* Words that point to one of Anthony's areas (matched by the area's name, so renamed areas still work). */
const AREA_HINTS: [RegExp, RegExp][] = [
  [/\b(quote|estimate|client|customer|invoice|bid|install|repair|drywall|tile|grout|paint|deck|faucet|outlet|wiring|hvac|handyman|trim|baseboard|cabinet|door|window|fence|roof|gutter|siding|flooring|caulk|job ?site|permit|walkthrough|walk-through|contractor|subfloor|sheetrock|plumbing|leak)\b/i, /handyman|business/i],
  [/\b(church|ministry|kids ministry|camp|sermon|pastor|bible study|youth|worship|service|staff meeting|volunteers?|check-?in|lessons?|nursery|small group|elders?|the heart|sunday school)\b/i, /church|ministry|faith/i],
  [/\b(study|studies|greek|hebrew|theology|class|exam|midterm|final|paper|chapter|homework|lecture|quiz|essay|reading|hermeneutics|exegesis|syllabus|professor|assignment|discussion post|canvas|textbook|semester|seminary|bible college)\b/i, /theolog|degree|school|study|college/i],
  [/\b(yard|backyard|garage|kitchen|laundry|dishes|dog|baby|abby|abigail|wife|date night|lawn|garden|bill|bills|rent|mortgage|insurance|utilities|electric|power bill|oil change|tires?|car|truck|bouncer|crib|daycare|pediatrician|family)\b/i, /family|home/i],
  [/\b(app|nest|code|computer|website|budget app|hunting|rifle|shed|hobby)\b/i, /personal/i],
];

interface Home { projectId: string | null; areaId: string | null; score: number; }
interface Index {
  projects: { p: Project; keys: Map<string, number>; phrase: string; people: Set<string> }[];
  areas: Area[];
  known: Map<string, string>;
}

function buildIndex(data: HeadData): Index {
  const active = C.activeProjects(data) as Project[];
  const known = new Map<string, string>();
  const df = new Map<string, number>(); // how many projects use each word in their tasks
  const taskWords = new Map<string, Set<string>>();
  for (const p of active) taskWords.set(p.id, new Set());
  for (const t of data.tasks.values()) {
    if (!t.projectId || !taskWords.has(t.projectId) || !C.isOpen(t)) continue;
    for (const w of tokens(t.title)) taskWords.get(t.projectId)!.add(w);
  }
  for (const set of taskWords.values()) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const projects = active.map((p) => {
    const keys = new Map<string, number>();
    const add = (w: string, n: number) => keys.set(w, Math.max(keys.get(w) ?? 0, n));
    for (const w of tokens(p.name)) add(w, 3);
    const people = new Set<string>();
    if (p.client?.name) for (const w of tokens(p.client.name)) { add(w, 3); people.add(w); }
    for (const s of p.sections || []) for (const w of tokens(s.name)) add(w, 1);
    for (const w of taskWords.get(p.id) ?? []) if ((df.get(w) ?? 0) === 1) add(w, 1);
    // Names in the project name or client ("Jon Wolfe", "Smith bathroom remodel") get their capitals back in titles.
    const nameWords = p.name.split(/[^A-Za-z']+/).filter(Boolean);
    const mixedCase = nameWords.some((w) => /^[a-z]/.test(w)); // "Smith bathroom remodel": the capital word is a name
    for (const raw of [...nameWords, ...(p.client?.name ?? "").split(/[^A-Za-z']+/)]) {
      if (/^[A-Z][a-z]+$/.test(raw) && (FIRST_NAMES.has(raw.toLowerCase()) || p.client?.name?.includes(raw) || mixedCase)) {
        known.set(raw.toLowerCase(), raw);
        if (FIRST_NAMES.has(raw.toLowerCase()) || p.client?.name?.includes(raw)) people.add(stem(raw.toLowerCase()));
      }
    }
    return { p, keys, phrase: norm(p.name).replace(/\b(?:project|job)\b/g, "").replace(/\s+/g, " ").trim(), people };
  });
  for (const t of data.tasks.values()) {
    const who = (t as { waiting?: { who?: string } | null }).waiting?.who;
    if (who && /^[A-Z][a-z]+/.test(who)) for (const raw of who.split(/\s+/)) if (/^[A-Z][a-z]+$/.test(raw)) known.set(raw.toLowerCase(), raw);
  }
  return { projects, areas: (C.areaList(data) as Area[]).filter((a) => !a.listMode && !a.archived), known };
}

function areaFor(text: string, ix: Index): string | null {
  const low = norm(text);
  for (const a of ix.areas) {
    const name = norm(a.name).replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^(?:business|degree|personal|projects?)$/.test(w));
    if (name.some((w) => new RegExp("\\b" + w + "\\b").test(low))) return a.id;
  }
  for (const [words_, name] of AREA_HINTS) {
    if (!words_.test(low)) continue;
    const a = ix.areas.find((x) => name.test(x.name));
    if (a) return a.id;
  }
  return null;
}

function matchHome(text: string, ix: Index): Home {
  const low = norm(text);
  const have = new Set(tokens(text));
  // "back yard" / "jon wolfe" said as one phrase count extra.
  let best: { p: Project; score: number } | null = null;
  for (const { p, keys, phrase } of ix.projects) {
    let score = 0;
    for (const [w, n] of keys) if (have.has(w)) score += n;
    if (phrase && phrase.length > 3 && low.includes(phrase)) score += 3;
    if (score > (best?.score ?? 0)) best = { p, score };
  }
  if (best && best.score >= 3) return { projectId: best.p.id, areaId: best.p.areaId ?? null, score: best.score };
  return { projectId: null, areaId: areaFor(text, ix), score: 0 };
}

/* ---------- 4. new projects ---------- */

const PROJECT_VERB = "build|redo|remodel|renovate|fix up|replace|install|refinish|landscape|put in|tear out|rebuild|re-?roof|reroof|resurface|convert|add on|finish off";
const INTENT = new RegExp(String.raw`^(?:(?:i|we)(?:'d| would)? (?:want|wanna|like|plan|'ve decided|have decided)|(?:i'?m|i am|we'?re|we are) (?:going|gonna|planning|thinking about|thinking of)|thinking about|planning to|plan to|time to|let's)\s*(?:to\s+)?(?:go\s+)?(${PROJECT_VERB})\s+(.+)$`, "i");
const NEW_JOB = /^(?:new (?:project|job)|got a (?:new )?job|landed a (?:new )?job|starting a (?:new )?project|new client)\s*(?::|-|to|for|with)?\s*(.+)$/i;
const NOT_PROJECT = /^(?:stuff|things|misc|random|other|other stuff|also|okay|ok|so|today|errands?|groceries|shopping|home|work|church|school|personal|dinner|lunch|breakfast|notes?|ideas?|reminders?|to ?dos?|tasks?)$/i;

const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* A short piece with no action that names what's coming: "backyard update", "jon wolfe kitchen backsplash", "for church sunday". */
const HEAD_LEAD = /^(?:ok(?:ay)?\s+so\s+|so\s+|alright\s+|and\s+|oh\s+)*(?:(?:as for|for|on|about|regarding|re|over at)\s+)?(?:the\s+)?/i;
const HEAD_TAIL = /\s+(?:update|updates|stuff|things|wise|list|tasks|to ?dos?|items|side)$/i;
/* "The deck stain is peeling at the Millers", "it's leaking again": what's going on, not a thing to do. Goes in the notes. */
const OBS = /^(?:(?:the|my|our|their|his|her|a|an)\s+[^,]{1,40}?\s+(?:is|are|was|were|has been|have been|keeps|kept|won't|isn't|aren't|doesn't|don't|started|stopped|broke)\b|(?:it|this|that|there)(?:'s| is| was)\b)/i;
/* "They want it done before Thanksgiving." */
const DEADLINE = /^(?:they|he|she|[a-z]+)\s+(?:want|wants|need|needs|would like)\s+(?:it|this|that|everything|them|the \w+)?\s*(?:done|finished|ready|complete|completed|installed|in)\s+(?:by|before)\s+(.+)$/i;
/* "Abby wants me to…", "Jon asked me to…": who asked goes in the notes; the task is the rest. */
const ASKED = /^(?:[a-z]+|my \w+|the \w+)\s+(?:wants|asked|needs|told|reminded|would like)\s+(?:me|us)\s+to\s+/i;
const IDEA_END = /\s+(?:eventually|someday|some day|one day|at some point|down the road|in the future)$/i;
/* Holidays as dates the parser can read. */
function holidays(p: string): string {
  const y = Number(C.today().slice(0, 4));
  const thanks = (yr: number) => C.nthWeekdayOfMonth(yr, 10, 4, 4) ?? `${yr}-11-26`;
  const pick = (d: (yr: number) => string) => { const t = d(y); return t >= C.today() ? t : d(y + 1); };
  const fmt = (d: string) => `${C.MON_SHORT[Number(d.slice(5, 7)) - 1].toLowerCase()} ${Number(d.slice(8))}`;
  // Only when it's a when: "before Thanksgiving", not "call mom about Thanksgiving".
  const W = String.raw`\b((?:by|before|on|until|till|due|for|after|over|at)\s+)`;
  return p
    .replace(new RegExp(W + "thanksgiving\\b", "gi"), (_m, w: string) => w + fmt(pick(thanks)))
    .replace(new RegExp(W + "christmas( eve)?\\b", "gi"), (_m, w: string, eve: string) => w + fmt(pick((yr) => `${yr}-12-${eve ? 24 : 25}`)))
    .replace(new RegExp(W + "new year'?s(?: day)?\\b", "gi"), (_m, w: string) => w + fmt(pick((yr) => `${yr + 1}-01-01`)))
    .replace(new RegExp(W + "halloween\\b", "gi"), (_m, w: string) => w + fmt(pick((yr) => `${yr}-10-31`)));
}
/** "a deck for the Smiths" → "Smith deck"; "the garage floor" → "Garage floor". */
function projectName(obj: string): string {
  let o = obj.replace(/[.\s]+$/, "").replace(/^(?:a|an|the|our|my|their|his|her|some)\s+/i, "");
  let who = "";
  const m = o.match(/^(.*?)\s+(?:for|at|with)\s+(?:the\s+)?([a-z][\w']*(?:\s+[a-z][\w']*)?)$/i);
  if (m) {
    o = m[1].replace(/^(?:a|an|the|new)\s+/i, "");
    who = m[2].replace(/'s$/i, "");
    if (/s$/i.test(who) && !/ss$/i.test(who)) who = who.slice(0, -1); // the Smiths → Smith, the neighbors → neighbor
    who = who.split(/\s+/).map(cap1).join(" ");
  }
  const thing = o.split(/\s+/).slice(0, 3).join(" ");
  const name = who ? `${who} ${thing.toLowerCase()}` : cap1(thing);
  return name.split(/\s+/).slice(0, 4).join(" ");
}

/* ---------- 5. the sort ---------- */

/* "Old" ways of saying a date that the parser doesn't read. */
function dateWords(p: string): string {
  return holidays(p)
    .replace(/\b(?:by|before)\s+(?=(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|tonight|next|this|the\s+\d|(?:the\s+)?end of|\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i, "due ")
    .replace(/\bdue\s+the\s+end of\b/i, "due end of")
    .replace(/\bfirst thing(?:\s+in the morning)?\b/i, "morning")
    .replace(/\bthis (?:upcoming|coming)\b|\b(?:upcoming|coming)\b(?=\s+(?:mon|tue|wed|thu|fri|sat|sun))/gi, "this")
    .replace(/\b(?:sometime\s+)?(?:this|by the end of the|before the end of the)\s+month\b/i, "due end of month")
    .replace(/\b(?:sometime\s+)?this week\b/i, "due end of week")
    .replace(/\bsometime\s+(?=next|this|tomorrow)/i, "");
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

type Topic = { projectId: string | null; areaId: string | null; newKey: string | null } | null;

let n = 0;
const nid = () => `d${Date.now().toString(36)}${(n++).toString(36)}`;

/** The plan for a dump: things to put away, and any new projects to make. */
export function planDump(text: string, data: HeadData, s: HeadSettings): DumpPlan {
  const today = C.today();
  const ctx = {
    weekStart: s.weekStart ?? 1, contexts: s.contexts || [],
    projects: [...data.projects.values()].filter((p) => p.status !== "done" && p.status !== "archived").map((p) => ({ id: p.id, name: p.name })),
    areas: C.areaList(data).map((a) => ({ id: a.id, name: a.name })),
  };
  const ix = buildIndex(data);
  const items: DumpItem[] = [];
  const projects: DumpProject[] = [];
  const seen = new Set<string>();
  const base = (title: string, dest: DumpDest): DumpItem => ({ id: nid(), title, dest, keep: true, when: null, due: null, time: null, tod: null, est: null, contexts: [], areaId: null, projectId: null, notes: null, newProject: null });
  const add = (it: DumpItem) => { const k = it.dest + "|" + it.title.toLowerCase(); if (!it.title || seen.has(k)) return false; seen.add(k); items.push(it); return true; };

  const ps = split(text);
  // How many things follow each piece in its paragraph (a new project needs a couple of steps).
  const stepsAfter = (i: number) => ps.slice(i + 1).filter((p) => !p.header && p.para === ps[i].para && !THOUGHT.test(p.text)).length;

  let para = -1, sent = -1;
  let paraTopic: Topic = null, sentTopic: Topic = null;
  let paraDate: { when: string | null; due: string | null; tod: string | null } | null = null;
  let sentDate: { when: string | null; due: string | null; tod: string | null } | null = null;
  let lastWhen: string | null = null, lastObject: string | null = null;
  let lastSent = -1, lastWd = false;
  let pendingNote: string | null = null; // "the deck stain is peeling…" waits for the next thing
  let paraShop = false; // under a "Groceries:" header, bare things are shopping
  const newProject = (name: string, outcome: string | null, hint: string): DumpProject => {
    const key = "new" + projects.length;
    const pr: DumpProject = { key, name, areaId: areaFor(name + " " + hint, ix), outcome, deadline: null, on: true };
    projects.push(pr);
    return pr;
  };
  const noteOn = (it: DumpItem | undefined, line: string) => { if (it) it.notes = it.notes ? `${it.notes}\n${line}` : line; };
  const prevItem = () => [...items].reverse().find((x) => x.dest !== "thought" && x.dest !== "shop");
  const paraText = (pi: number) => ps.filter((x) => x.para === pi).map((x) => x.text).join(" ");

  /** A header (said with ":" or as a short lead-in) sets the topic or the day. Returns true when it was one. */
  const takeHeader = (rawHeader: string, i: number, scope: "para" | "sent", lead: boolean): boolean => {
    const h = rawHeader.replace(HEAD_LEAD, "").replace(HEAD_TAIL, "").replace(/\b(?:the|stuff|things|to ?dos?|list)\b/gi, " ").replace(/\s+/g, " ").trim().replace(HEAD_LEAD, "").trim();
    if (!h) return lead ? false : true;
    const parsed = C.parseQuickAdd(dateWords(h), ctx);
    const date = { when: (parsed.fields.when as string) ?? null, due: (parsed.fields.due as string) ?? null, tod: (parsed.fields.tod as string) ?? null };
    const rest = parsed.title.trim();
    if (!rest && (date.when || date.due)) { if (scope === "para") paraDate = date; else sentDate = date; return true; }
    const home = matchHome(rest || h, ix);
    const setTopic = (t: Topic) => { if (scope === "para") paraTopic = t; else { sentTopic = t; paraTopic = t; } };
    if (date.when || date.due) { if (scope === "para") paraDate = date; else sentDate = date; }
    if (home.projectId) {
      setTopic({ projectId: home.projectId, areaId: home.areaId, newKey: null });
      // What's left after the project's own words is the thing being talked about: "kitchen backsplash".
      const pInfo = ix.projects.find((x) => x.p.id === home.projectId)!;
      const left = (rest || h).split(/\s+/).filter((w) => !pInfo.keys.has(stem(norm(w))) && !STOP.has(w.toLowerCase()) && !/^(?:project|job)$/i.test(w));
      if (left.length && left.length <= 4) lastObject = "the " + left.join(" ").toLowerCase();
      return true;
    }
    // "Work:", "Home stuff:", "Church:" — an area by a word of its name.
    const word = norm(rest || h);
    const byName = ix.areas.find((a) => norm(a.name).split(/[^a-z]+/).filter((w) => w.length >= 4).includes(word));
    // A job for someone ("Fence for the neighbors") or a job word ("Kitchen remodel") is a new project, not just its area.
    const jobby = /\s(?:for|at)\s|\b(?:job|project|remodel|reno|renovation|build|install|repair|deck|fence|bathroom|kitchen|basement|shed|roof|addition|patio|landscaping|flooring|siding|garage)\b/i.test(rawHeader);
    const areaId = byName?.id ?? (jobby && !lead ? null : lead && !/^(?:for|on|about|as for|regarding|re)\b/i.test(rawHeader.replace(/^(?:ok(?:ay)? so|so|and)\s+/i, "")) ? null : home.areaId);
    if (areaId) { setTopic({ projectId: null, areaId, newKey: null }); return true; }
    if (/^(?:groceries|grocery list|shopping|shopping list|store|grocery store|costco|winco|walmart)$/i.test(word)) { paraShop = true; return true; }
    if (lead) return !!(date.when || date.due) && !rest;
    if (!NOT_PROJECT.test(word) && stepsAfter(i) >= 2) {
      const pr = newProject(projectName(rawHeader.replace(HEAD_TAIL, "").replace(/\s+(?:project|job)$/i, "")), null, paraText(ps[i].para));
      setTopic({ projectId: null, areaId: pr.areaId, newKey: pr.key });
    }
    return true;
  };

  for (let i = 0; i < ps.length; i++) {
    const pc = ps[i];
    if (pc.para !== para) { para = pc.para; paraTopic = null; paraDate = null; lastObject = null; lastWhen = null; paraShop = false; pendingNote = null; }
    if (pc.sent !== sent) {
      sent = pc.sent; sentTopic = null; sentDate = null;
      // A new sentence about something else ends a header's topic.
      if (paraTopic && !pc.header) {
        const whole = ps.filter((x) => x.sent === sent && !x.header).map((x) => x.text).join(" ");
        const own = matchHome(whole, ix);
        if (/^(?:also|oh and|another thing|separately|unrelated|on another note|other stuff|random)\b/i.test(whole)
          || (own.projectId && own.projectId !== paraTopic.projectId)
          || (!paraTopic.projectId && own.areaId && own.areaId !== paraTopic.areaId)) paraTopic = null;
      }
    }

    /* --- headers: "Backyard:", "For the Jon Wolfe project,", "Tomorrow:" --- */
    if (pc.header) { takeHeader(pc.header, i, "para", false); continue; }

    let raw = pc.text;
    // "grocery list eggs, coffee…", "from costco: …"
    const gl = raw.match(/^(?:(?:my |the |a )?(?:grocery|shopping) list|groceries|from the store|at the store|(?:from|at) (?:costco|winco|walmart|fred meyer))\s*:?\s+(.+)$/i);
    if (gl) { paraShop = true; raw = gl[1]; }
    // A short lead-in with no action: "backyard update", "for church sunday", "jon wolfe kitchen backsplash", "ok so tomorrow".
    const bare = raw.replace(LINKED_START, "").replace(HEAD_LEAD, "").replace(HEAD_TAIL, "");
    if (words(raw) <= 7 && !LINKED_START.test(raw) && !isVerb(bare.split(/\s+/)[0]) && !/\b(?:i|we|need|have|gotta|should|must|want|is|are|has|was)\b/i.test(bare) && !SHOP_LEAD.test(bare)) {
      const proj = matchHome(bare, ix).projectId;
      const leadDate = C.parseQuickAdd(dateWords(bare), ctx);
      const onlyDate = !leadDate.title.trim() && !!(leadDate.fields.when || leadDate.fields.due);
      const forLead = /^(?:ok(?:ay)?\s+so\s+|so\s+)?(?:as for|for|on|about|regarding|re)\s/i.test(raw);
      if ((proj || onlyDate || forLead || HEAD_TAIL.test(raw)) && takeHeader(raw, i, pc.first ? "sent" : "para", true)) continue;
    }

    // A day said first covers the sentence: "Sunday I need to print… and set up…".
    if (pc.first) {
      const lead = C.parseQuickAdd(dateWords(raw), ctx);
      const tk = lead.tokens.find((t) => t.type === "when" || t.type === "due");
      const rp = lead.tokens.find((t) => t.type === "repeat" && t.start <= 3);
      // Only a said part of day carries over ("wednesday night"), not one guessed from a time ("at 7").
      const todWord = /\b(?:evening|night|tonight)\b/i.test(raw) ? "evening" : /\bafternoon\b/i.test(raw) ? "afternoon" : /\bmorning\b/i.test(raw) ? "morning" : null;
      if (tk && tk.start <= 3 && !rp) sentDate = { when: (lead.fields.when as string) ?? null, due: (lead.fields.due as string) ?? null, tod: todWord };
    }

    // "They want it done before Thanksgiving": a deadline for the job, not a task.
    const dl = raw.match(DEADLINE);
    if (dl) {
      const d = C.parseQuickAdd(dateWords("due " + dl[1]), ctx).fields.due as string | undefined;
      const topic = sentTopic ?? paraTopic;
      const pr = topic?.newKey ? projects.find((x) => x.key === topic.newKey) : null;
      if (pr && d) pr.deadline = d;
      else { const pv = prevItem(); if (pv && d && !pv.due) pv.due = d; noteOn(pv, cap1(raw) + "."); }
      continue;
    }
    // "The deck stain is peeling…" / "it's leaking again": goes in the notes of the thing it's about.
    if (OBS.test(raw) && !MUST.test(raw) && !THOUGHT.test(raw)) {
      const pv = prevItem();
      const subj = raw.match(/^((?:the|my|our|their|his|her)\s+[^,]{1,30}?)\s+(?:is|are|was|were|has|have|keeps|kept|won't|isn't|aren't|doesn't|don't|started|stopped|broke)\b/i);
      if (subj) lastObject = subj[1].toLowerCase().replace(/^(?:my|our)\s/, "the ");
      if (pv && pv.title && /^(?:it|this|that|there)\b/i.test(raw) && pv.id === items[items.length - 1]?.id) noteOn(pv, cap1(raw) + ".");
      else pendingNote = (pendingNote ? pendingNote + " " : "") + cap1(raw) + ".";
      const home = matchHome(raw, ix);
      if (!sentTopic && (home.projectId || home.areaId)) sentTopic = { projectId: home.projectId, areaId: home.areaId, newKey: null };
      continue;
    }

    // Feelings and observations stay together as thoughts, unless they carry a "need to".
    if (THOUGHT.test(raw) && !MUST.test(raw)) {
      add(base(C.cap4(raw.replace(/[.\s]+$/, "")), "thought"));
      const about = matchHome(raw, ix); // "I don't know where to start with the backyard." → what follows is about the backyard
      if (about.projectId) paraTopic = { projectId: about.projectId, areaId: about.areaId, newKey: null };
      continue;
    }

    /* --- "I want to build a deck for the Smiths." / "New job for the Hendersons" followed by its steps → a new project --- */
    const im = raw.match(INTENT);
    const nj = im ? null : raw.match(NEW_JOB);
    if ((im || nj) && stepsAfter(i) >= 2) {
      const obj = im ? im[2] : nj![1];
      const own = matchHome(obj, ix);
      if (own.projectId) { paraTopic = { projectId: own.projectId, areaId: own.areaId, newKey: null }; continue; }
      // "New job for the Hendersons" names only who it's for: "Henderson job".
      let name = projectName(obj);
      if (nj && !/\s(?:for|at|with)\s/i.test(obj) && words(obj.replace(/^the\s+/i, "")) <= 2) {
        const who = obj.replace(/^(?:for\s+)?the\s+/i, "").replace(/'s$/i, "").replace(/([^s])s$/i, "$1");
        name = who.split(/\s+/).map(cap1).join(" ") + " job";
      }
      const pr = newProject(name, im ? cap1(`${im[1]} ${im[2]}`.replace(/[.\s]+$/, "")) : null, paraText(pc.para));
      const cl = obj.match(/(?:^|\s)(?:for|at)?\s*(the\s+[a-z]+s)\b/i) ?? obj.match(/\bfor\s+(the\s+[a-z]+s)\b/i);
      if (cl) pr.client = cl[1].replace(/^the\s+/i, "the ").replace(/\b([a-z])/g, (c, _x, at: number) => (at === 0 ? c : c.toUpperCase()));
      paraTopic = { projectId: null, areaId: pr.areaId, newKey: pr.key };
      continue;
    }

    let p = raw, idea = false;
    const ideaM = p.match(IDEA);
    if (ideaM) { idea = true; p = p.slice(ideaM[0].length); }
    p = p.replace(LINKED_START, "").replace(FILL_MID, "").replace(/\s+/g, " ").trim();
    if (IDEA_END.test(p)) { idea = true; p = p.replace(IDEA_END, ""); }
    const asked = p.match(ASKED);
    if (asked) p = p.slice(asked[0].length);
    const lead = stripLeads(p);
    p = lead.text;
    p = p.replace(/^(.+?)\s+(?:needs?|has|have)\s+to\s+be\s+(?:done|finished|ready|complete|completed|submitted|turned in|in)\s+(?:by\s+|before\s+)?/i, "$1 due ");
    // "I have a paper due Friday", "the baby has a checkup Thursday at 10": the thing itself.
    p = p.replace(/^(?:have|has)\s+(?:a|an|my|our|the|his|her|their)\s+(?=\S+(?:\s+\S+){0,3}\s+(?:due|at|on|this|next|tomorrow|today|tonight|mon|tue|wed|thu|fri|sat|sun)\w*\b)/i, "")
      .replace(/^((?:the|my|our)\s+)?(\w+)\s+has\s+(?:a|an|her|his|their)\s+/i, (_m, _d: string, who: string) => who + " ");
    if (!p) continue;

    // Where this belongs: its own words first, then what the sentence or header is about.
    const own = matchHome(raw, ix);
    const topic: Topic = sentTopic ?? paraTopic;
    let home: Topic = null;
    if (own.projectId) home = { projectId: own.projectId, areaId: own.areaId, newKey: null };
    else if (topic) {
      const pm = p.match(PEOPLE_VERB);
      const person = pm ? stem(norm(p.slice(pm[0].length).split(/\s+/)[0] ?? "")) : null;
      const pInfo: Index["projects"][number] | null | undefined = topic.projectId ? ix.projects.find((x) => x.p.id === topic.projectId) : null;
      const stranger: boolean = !!person && FIRST_NAMES.has(person) && !(pInfo?.people.has(person));
      // Inside a project, only a message to someone else leaves it. Inside an area, another area's words win.
      const leave: boolean = stranger || (!topic.projectId && !topic.newKey && !!own.areaId && own.areaId !== topic.areaId);
      home = leave ? { projectId: null, areaId: own.areaId, newKey: null } : topic;
    } else if (own.areaId) home = { projectId: null, areaId: own.areaId, newKey: null };
    if (own.projectId && !sentTopic) sentTopic = home;
    const inProject = !!(home?.projectId || home?.newKey);

    /* --- shopping: "buy milk, eggs and diapers", "out of coffee", "milk bread bananas", or anything under "Groceries:" --- */
    const sm = p.match(SHOP_LEAD);
    let list = sm ? splitList(sm[1]) : !lead.action && /,|\band\b/.test(p) ? splitList(p) : [];
    if (!list.length && !lead.action && !VERB_START.test(p)) { const bareList = splitItem(p.replace(/,/g, " ")); if ((bareList.length >= 2 && bareList.every(isShop)) || (bareList.length === 1 && words(p) <= 3 && isFood(p))) list = bareList; }
    const groceries = list.length > 0 && list.filter(isShop).length >= Math.ceil(list.length * 0.6);
    if ((groceries && !(inProject && !list.some(isFood))) || (paraShop && !VERB_START.test(p) && words(p) <= 4)) {
      for (const it of list.length ? list : [p]) add(base(C.cap4(it), "shop"));
      continue;
    }
    if (sm && list.length === 1 && isShop(list[0]) && !(inProject && !isFood(list[0]))) { add(base(C.cap4(list[0]), "shop")); continue; }
    // "need a tarp and ratchet straps" isn't groceries: it's a thing to get. A list reads as one: "Get 2x4s, screws and a saw blade".
    if (sm && /^(?:need|we need|i need)\b/i.test(p)) p = p.replace(/^(?:we |i )?need\s+/i, "get ");
    // A list said without commas reads better with them: "get 2x4s screws and a new blade" → "Get 2x4s, screws and new blade".
    const verb = p.match(/^(pick up|get|buy|grab|order|bring)\s+/i);
    if (verb && list.length >= 3 && !p.includes(",")) p = verb[1] + " " + list.slice(0, -1).join(", ") + " and " + list[list.length - 1];

    /* --- a task --- */
    const est = takeEstimate(p);
    p = est.text;
    // "…, should take about 2 hours" on its own: that's how long the thing before it takes.
    if (est.est && !/[a-z]{3,}/i.test(p.replace(/\b(?:it|that|this|take|takes|should|will|probably|maybe|about|around|so)\b/gi, ""))) {
      const prev = items[items.length - 1];
      if (prev && prev.dest !== "shop" && prev.dest !== "thought" && prev.est == null) prev.est = est.est;
      continue;
    }
    // "plan out next week": the week is what gets planned, not when.
    const keep: string[] = [];
    let pp = dateWords(p).replace(/^((?:plan|plan out|map out|organize|prep for|prepare for|schedule out|think through)\s+)((?:next|this|the)\s+(?:week|month|weekend)|tomorrow)\b/i,
      (_m, v: string, what: string) => { keep.push(what); return v + "\u0001" + (keep.length - 1); })
      // "text Abby about Friday": Friday is what it's about, not when.
      .replace(/\b(about|regarding)\s+((?:this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|the weekend|this weekend)\b/gi,
        (_m, a: string, pre: string | undefined, d: string) => { keep.push((pre ?? "") + d); return a + " \u0001" + (keep.length - 1); });
    // "text Aaron and see if he can help Saturday": Saturday is about the help, not when to text.
    const msg = PEOPLE_VERB.test(pp) ? pp.search(/\s(?:and )?(?:see|ask|check)\s+(?:if|whether)\b|\sif\s|\swhether\s|\s(?:that|saying|to say)\s|\sand (?:ask|tell) (?:him|her|them)\b/i) : -1;
    let tail = "";
    if (msg > 0) { tail = pp.slice(msg); pp = pp.slice(0, msg); }
    const parsed = C.parseQuickAdd(pp, ctx);
    const f = parsed.fields;
    const saidDay = parsed.tokens.some((t) => t.type === "when" || t.type === "due");
    // "and see if he can help Saturday" → ": can he help Saturday?"
    tail = tail.replace(/^\s*(?:and\s+)?(?:see|ask|check)\s+(?:if|whether)\s+(he|she|they|you|we)\s+(can|could|will|would|is|are|wants? to)\s+(.+)$/i,
      (_m, who: string, v: string, rest: string) => `: ${v.replace(/s to$/, " to")} ${who} ${rest.replace(/[.?\s]+$/, "")}?`)
      .replace(/^\s*(?:that|saying|to say)\s+/i, ": ");
    const isMsg = !!tail;
    let title = stripLeads(((parsed.title || pp) + tail).trim()).text.replace(/\u0001(\d+)/g, (_m, k: string) => keep[Number(k)])
      // "put a fire pit in" → "put in a fire pit"
      .replace(/^(put|tear|take|pick|drop|clean|clear)\s+(.{3,30}?)\s+(in|out|up|off|down|back)$/i, "$1 $3 $2")
      .replace(/(?:\s+(?:by|on|before|due|at|for|this|next|in|upcoming|coming|after|then|and|first thing|first|better))+$/i, "").replace(/[.\s]+$/, "");

    // Summarize: reasons and conditions to the notes, fillers out, "it" → the thing, long ones cut.
    let moved = false;
    const r = isMsg ? null : title.match(REASON) ?? (/\?$/.test(title) ? null : title.match(COND));
    if (r && r.index! >= 6) { title = title.slice(0, r.index).trim(); moved = true; }
    const pur = !isMsg && MEETUP.test(title) ? title.match(PURPOSE) : null;
    if (pur && pur.index! >= 6) { title = title.slice(0, pur.index).trim(); moved = true; }
    title = title.replace(FILL_MID, "").replace(/\s+/g, " ").trim();
    title = metaTask(title);
    for (const [re, to] of PHRASES) title = title.replace(re, to);
    // "for the Jon Wolfe project" in the title is said by the project chip already.
    if (home?.projectId) {
      const pInfo = ix.projects.find((x) => x.p.id === home!.projectId);
      if (pInfo?.phrase) title = title.replace(new RegExp(String.raw`\s+(?:for|on|at|over at)\s+(?:the\s+)?${esc(pInfo.phrase).replace(/\\? /g, "\\s+")}(?:\s+(?:project|job|place|house))?\b`, "i"), "");
    }
    title = resolveIt(title, lastObject);
    // "get them a quote" in the Henderson job → "get the Hendersons a quote"
    const client = home?.newKey ? projects.find((x) => x.key === home!.newKey)?.client : null;
    if (client) title = title.replace(/^((?:get|give|send|email|call|text|tell|ask|show|pay|invoice|quote|bill|update|meet)\s+)(them)\b/i, `$1${client}`);
    const sh = shorten(title, /, /.test(title) ? 12 : 9);
    title = caps(C.cap4(sh.title), ix.known);
    if (title.replace(/[^a-z]/gi, "").length < 3) continue;

    // When: said here, else the day said first in the sentence or in a "Tomorrow:" header, else the step before ("…and then").
    const timeOnly = !saidDay && !!f.time;
    let when = saidDay ? (f.when as string | undefined) ?? null : null;
    let due = (f.due as string | undefined) ?? null;
    let tod = (f.tod as string | undefined) ?? null;
    // "wednesday night … at 7" is 7 PM.
    let time = (f.time as string | undefined) ?? null;
    if (time && Number(time.slice(0, 2)) < 12 && Number(time.slice(0, 2)) >= 5 && /\b(?:night|tonight|evening|pm|p\.m\.)\b/i.test(raw)) { time = `${Number(time.slice(0, 2)) + 12}${time.slice(2)}`; tod = "evening"; }
    const dayCtx = sentDate ?? paraDate;
    if (!when && !due && dayCtx) { when = dayCtx.when; due = dayCtx.due; tod = tod ?? dayCtx.tod; }
    if (!when && !due && !idea && pc.linked && lastWhen) when = lastWhen;
    if (!when && timeOnly) when = today;
    if (f.repeat && !when) when = (f.when as string | undefined) ?? null;
    // "demo monday, install wednesday, set the countertops friday": that's the Friday after Wednesday.
    const wdTok = parsed.tokens.find((t) => t.type === "when" && /^(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i.test(t.raw.trim()));
    if (when && wdTok && lastWd && lastWhen && when < lastWhen && pc.sent === lastSent) when = C.addDays(when, 7);
    if (when && due && when > due) when = null;
    const dest: DumpDest = idea ? "someday" : when && when <= today ? "today" : when || due ? "date" : "later";

    const why = [asked ? cap1(raw.replace(/[.\s]+$/, "")) + "." : null, moved || (sh.cut && !asked) ? cap1(raw.replace(/[.\s]+$/, "")) + "." : null, pendingNote]
      .filter((x, k, a): x is string => !!x && a.indexOf(x) === k);
    pendingNote = null;
    const it: DumpItem = {
      ...base(title, dest),
      when: dest === "today" ? today : dest === "someday" ? null : when, due: dest === "someday" ? null : due,
      time, tod, est: (f.est as number | undefined) ?? est.est,
      contexts: (f.contexts as string[] | undefined) ?? [],
      projectId: (f.projectId as string | undefined) ?? home?.projectId ?? null,
      areaId: (f.areaId as string | undefined) ?? home?.areaId ?? null,
      newProject: f.projectId || f.areaId ? null : home?.newKey ?? null,
      notes: why.length ? why.join("\n") : null,
    };
    if (f.repeat) it.repeat = f.repeat as RepeatRule;
    if (add(it)) {
      if (when) { lastWhen = when; lastSent = pc.sent; lastWd = !!wdTok; }
      // What "it" will mean next. Things you go get (a tarp, straps) aren't what you then haul or install.
      const o = /^(?:get|buy|grab|order|bring|borrow|rent)\b/i.test(title) ? null : objectOf(title);
      if (o) { const ob = o.replace(/^(?:a|an)\s+/i, "the "); lastObject = ob[0].toLowerCase() + ob.slice(1); }
    }
  }
  if (pendingNote) noteOn(prevItem(), pendingNote);

  // A project offer needs at least two steps; otherwise its one step is just a task.
  for (const pr of [...projects]) {
    const steps = items.filter((it) => it.newProject === pr.key);
    if (steps.length < 2) { steps.forEach((it) => { it.newProject = null; }); projects.splice(projects.indexOf(pr), 1); }
  }
  // Already on the list? Leave it unchecked (one tap keeps it anyway).
  const open = [...data.tasks.values()].filter((t) => t.status === "open");
  for (const it of items) {
    if (it.newProject || it.dest === "thought") continue;
    const twin = it.dest === "shop"
      ? open.find((t) => !!t.grocery && normTitle(t.title) === normTitle(it.title))
      : open.find((t) => !t.grocery && (t.projectId ?? null) === (it.projectId ?? null) && sameTask(t.title, it.title));
    if (twin) { it.keep = false; it.dupOf = twin.id; }
  }
  return { items, projects };
}

/** Just the things (the old shape). */
export function sortDump(text: string, data: HeadData, s: HeadSettings): DumpItem[] {
  return planDump(text, data, s).items;
}

/** Move an item somewhere else; dates follow the destination. */
export function moveItem(it: DumpItem, dest: DumpDest, date?: string | null): DumpItem {
  const today = C.today();
  if (dest === "today") return { ...it, dest, when: today };
  if (dest === "date") return { ...it, dest, when: date ?? C.addDays(today, 1) };
  return { ...it, dest, when: null, ...(dest === "someday" || dest === "shop" || dest === "thought" ? { due: null, time: null } : {}) };
}
