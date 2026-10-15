/* Clearhead core — ported verbatim from legacy/clearhead.html (dates, repeat rules, the task model and
   its selectors, notes rendering, the Quick Add parser and the on-device ramble splitter).
   Ported, not rewritten: tests/clearhead-parity.test.ts checks these against outputs captured from the old app.
   Only change: sortRamble() was dropped (it called the artifact runtime). Claude sorting comes back in Phase 4
   through the scheduled tasks. Keep edits here minimal and add a parity test for any change. */
/* eslint-disable */
// src/lib/dates.js
var DAY_MS = 864e5;
var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
var MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var pad = (n3) => String(n3).padStart(2, "0");
function ymd(d3) {
  return `${d3.getFullYear()}-${pad(d3.getMonth() + 1)}-${pad(d3.getDate())}`;
}
function parseYmd(s3) {
  if (!s3) return null;
  const [y3, m2, d3] = s3.split("-").map(Number);
  return new Date(y3, m2 - 1, d3, 12, 0, 0, 0);
}
var _now = null;
function setNow(d3) {
  _now = d3;
}
function now() {
  return _now ? new Date(_now.getTime()) : /* @__PURE__ */ new Date();
}
function today() {
  return ymd(now());
}
function addDays(s3, n3) {
  const d3 = parseYmd(s3);
  d3.setDate(d3.getDate() + n3);
  return ymd(d3);
}
function addMonths(s3, n3, clampDay) {
  const d3 = parseYmd(s3);
  const day = clampDay || d3.getDate();
  const t4 = new Date(d3.getFullYear(), d3.getMonth() + n3, 1, 12);
  const last = daysInMonth(t4.getFullYear(), t4.getMonth());
  t4.setDate(Math.min(day, last));
  return ymd(t4);
}
function addYears(s3, n3) {
  const d3 = parseYmd(s3);
  const t4 = new Date(d3.getFullYear() + n3, d3.getMonth(), 1, 12);
  t4.setDate(Math.min(d3.getDate(), daysInMonth(t4.getFullYear(), t4.getMonth())));
  return ymd(t4);
}
function daysInMonth(y3, m2) {
  return new Date(y3, m2 + 1, 0).getDate();
}
function weekday(s3) {
  return parseYmd(s3).getDay();
}
function diffDays(a3, b2) {
  return Math.round((parseYmd(b2) - parseYmd(a3)) / DAY_MS);
}
function startOfWeek(s3, weekStart = 1) {
  const wd = weekday(s3);
  return addDays(s3, -((wd - weekStart + 7) % 7));
}
function startOfMonth(s3) {
  return s3.slice(0, 8) + "01";
}
function endOfMonth(s3) {
  const d3 = parseYmd(s3);
  return ymd(new Date(d3.getFullYear(), d3.getMonth() + 1, 0, 12));
}
function nextWeekday(from, wd, includeToday = true) {
  let diff = (wd - weekday(from) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(from, diff);
}
function nthWeekdayOfMonth(y3, m2, wd, n3) {
  if (n3 === -1) {
    const last = new Date(y3, m2 + 1, 0, 12);
    const back2 = (last.getDay() - wd + 7) % 7;
    last.setDate(last.getDate() - back2);
    return ymd(last);
  }
  const first = new Date(y3, m2, 1, 12);
  const off = (wd - first.getDay() + 7) % 7;
  const day = 1 + off + (n3 - 1) * 7;
  if (day > daysInMonth(y3, m2)) return null;
  return ymd(new Date(y3, m2, day, 12));
}
function nthOfWeekdayInMonth(s3) {
  return Math.floor((parseYmd(s3).getDate() - 1) / 7) + 1;
}
function isLastWeekdayOfMonth(s3) {
  const d3 = parseYmd(s3);
  return d3.getDate() + 7 > daysInMonth(d3.getFullYear(), d3.getMonth());
}
function ordinal(n3) {
  const s3 = ["th", "st", "nd", "rd"], v3 = n3 % 100;
  return n3 + (s3[(v3 - 20) % 10] || s3[v3] || s3[0]);
}
function relLabel(s3, opts = {}) {
  if (!s3) return "";
  const t4 = today();
  const dd = diffDays(t4, s3);
  if (dd === 0) return "Today";
  if (dd === 1) return "Tomorrow";
  if (dd === -1) return "Yesterday";
  const d3 = parseYmd(s3);
  if (dd > 1 && dd < 7 && !opts.long) return WD_SHORT[d3.getDay()];
  const base = `${MON_SHORT[d3.getMonth()]} ${d3.getDate()}`;
  return d3.getFullYear() === parseYmd(t4).getFullYear() ? base : `${base}, ${d3.getFullYear()}`;
}
function longLabel(s3) {
  const d3 = parseYmd(s3);
  return `${WEEKDAYS[d3.getDay()][0].toUpperCase() + WEEKDAYS[d3.getDay()].slice(1)}, ${MONTHS[d3.getMonth()][0].toUpperCase() + MONTHS[d3.getMonth()].slice(1)} ${d3.getDate()}`;
}
function monthLabel(s3) {
  const d3 = parseYmd(s3);
  const m2 = MONTHS[d3.getMonth()];
  return m2[0].toUpperCase() + m2.slice(1) + (d3.getFullYear() !== now().getFullYear() ? " " + d3.getFullYear() : "");
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  let [h3, m2] = hhmm.split(":").map(Number);
  const ap = h3 >= 12 ? "pm" : "am";
  h3 = h3 % 12 || 12;
  return m2 ? `${h3}:${pad(m2)}${ap}` : `${h3}${ap}`;
}
function fmtMinutes(min) {
  if (min == null) return "";
  if (min >= 480) return min % 480 === 0 ? min === 480 ? "Full day" : `${min / 480} days` : `${Math.round(min / 60)}h`;
  if (min >= 240 && min % 240 === 0) return "Half day";
  if (min >= 60) {
    const h3 = Math.floor(min / 60), m2 = min % 60;
    return m2 ? `${h3}h ${m2}m` : `${h3}h`;
  }
  return `${min}m`;
}
function timeAgo(ts) {
  const s3 = Math.max(0, (now().getTime() - ts) / 1e3);
  if (s3 < 60) return "just now";
  if (s3 < 3600) return `${Math.floor(s3 / 60)}m ago`;
  if (s3 < 86400) return `${Math.floor(s3 / 3600)}h ago`;
  const d3 = Math.floor(s3 / 86400);
  if (d3 < 7) return `${d3}d ago`;
  return relLabel(ymd(new Date(ts)), { long: true });
}
function nowHHMM() {
  const d3 = now();
  return `${pad(d3.getHours())}:${pad(d3.getMinutes())}`;
}

// src/lib/repeat.js
var cap = (s3) => s3[0].toUpperCase() + s3.slice(1);
function normalizeRule(r3) {
  if (!r3) return null;
  const rule = { interval: 1, ...r3 };
  rule.interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  if (!rule.anchor) rule.anchor = today();
  if (rule.freq === "week") {
    rule.days = (rule.days && rule.days.length ? [...new Set(rule.days)] : [weekday(rule.anchor)]).sort((a3, b2) => a3 - b2);
  }
  if (rule.freq === "month") {
    if (!rule.monthMode) rule.monthMode = "date";
    if (rule.monthMode === "date" && !rule.monthDay) rule.monthDay = parseYmd(rule.anchor).getDate();
    if (rule.monthMode === "nth") {
      if (rule.wd == null) rule.wd = weekday(rule.anchor);
      if (!rule.nth) rule.nth = Math.floor((parseYmd(rule.anchor).getDate() - 1) / 7) + 1;
    }
  }
  if (rule.freq === "after" && !rule.unit) rule.unit = "day";
  return rule;
}
function monthIndex(s3) {
  const d3 = parseYmd(s3);
  return d3.getFullYear() * 12 + d3.getMonth();
}
function monthCandidate(rule, y3, m2) {
  if (rule.monthMode === "nth") return nthWeekdayOfMonth(y3, m2, rule.wd, rule.nth);
  const dim = daysInMonth(y3, m2);
  const day = rule.monthDay === -1 ? dim : Math.min(rule.monthDay, dim);
  return ymd(new Date(y3, m2, day, 12));
}
function nextAfter(r3, date) {
  const rule = normalizeRule(r3);
  if (!rule) return null;
  const { freq, interval, anchor } = rule;
  if (freq === "after") {
    if (rule.unit === "week") return addDays(date, 7 * interval);
    if (rule.unit === "month") return addMonths(date, interval);
    return addDays(date, interval);
  }
  if (date < anchor) {
    if (matches(rule, anchor)) return anchor;
    return nextAfter(rule, anchor);
  }
  if (freq === "day") {
    const k3 = Math.floor(diffDays(anchor, date) / interval) + 1;
    return addDays(anchor, k3 * interval);
  }
  if (freq === "week") {
    const w0 = startOfWeek(anchor, 0);
    let d3 = addDays(date, 1);
    for (let i3 = 0; i3 < 7 * interval + 7; i3++, d3 = addDays(d3, 1)) {
      const weeks = Math.round(diffDays(w0, startOfWeek(d3, 0)) / 7);
      if (weeks % interval === 0 && rule.days.includes(weekday(d3))) return d3;
    }
    return null;
  }
  if (freq === "month") {
    const a3 = monthIndex(anchor);
    let mi = monthIndex(date);
    for (let i3 = 0; i3 < 12 * interval + 24; i3++, mi++) {
      if ((mi - a3) % interval !== 0) continue;
      const y3 = Math.floor(mi / 12), m2 = mi % 12;
      const c3 = monthCandidate(rule, y3, m2);
      if (c3 && c3 > date) return c3;
    }
    return null;
  }
  if (freq === "year") {
    const ay = parseYmd(anchor).getFullYear();
    let y3 = parseYmd(date).getFullYear();
    for (let i3 = 0; i3 < interval + 2; i3++, y3++) {
      if ((y3 - ay) % interval !== 0) continue;
      const c3 = addYears(anchor, y3 - ay);
      if (c3 > date) return c3;
    }
    return addYears(anchor, (Math.floor((parseYmd(date).getFullYear() - ay) / interval) + 1) * interval);
  }
  return null;
}
function matches(r3, date) {
  const rule = normalizeRule(r3);
  if (!rule || rule.freq === "after" || date < rule.anchor) return false;
  const { freq, interval, anchor } = rule;
  if (freq === "day") return diffDays(anchor, date) % interval === 0;
  if (freq === "week") {
    const weeks = Math.round(diffDays(startOfWeek(anchor, 0), startOfWeek(date, 0)) / 7);
    return weeks % interval === 0 && rule.days.includes(weekday(date));
  }
  if (freq === "month") {
    if ((monthIndex(date) - monthIndex(anchor)) % interval !== 0) return false;
    const d3 = parseYmd(date);
    return monthCandidate(rule, d3.getFullYear(), d3.getMonth()) === date;
  }
  if (freq === "year") {
    const ay = parseYmd(anchor).getFullYear(), y3 = parseYmd(date).getFullYear();
    return (y3 - ay) % interval === 0 && addYears(anchor, y3 - ay) === date;
  }
  return false;
}
function occurrencesBetween(r3, from, to, limit = 60) {
  const rule = normalizeRule(r3);
  const out = [];
  if (!rule) return out;
  let d3 = from;
  while (out.length < limit) {
    d3 = rule.freq === "after" ? nextAfter(rule, d3) : nextAfter(rule, d3);
    if (!d3 || d3 > to) break;
    out.push(d3);
  }
  return out;
}
function nextInstanceDates(task, completedOn = today()) {
  const rule = normalizeRule(task.repeat);
  const base = task.when || task.due || completedOn;
  let next;
  if (rule.freq === "after") {
    next = nextAfter(rule, completedOn);
  } else {
    const yesterday = addDays(completedOn, -1);
    next = nextAfter(rule, base > yesterday ? base : yesterday);
  }
  if (!next) return { when: task.when, due: task.due };
  const shift = diffDays(base, next);
  return {
    when: task.when ? addDays(task.when, shift) : task.due ? null : next,
    due: task.due ? addDays(task.due, shift) : null
  };
}
var wdList = (days) => {
  const s3 = [...days].sort((a3, b2) => a3 - b2);
  if (s3.join() === "1,2,3,4,5") return "weekdays";
  if (s3.join() === "0,6") return "weekends";
  if (s3.length === 7) return "every day";
  if (s3.length === 1) return cap(WEEKDAYS[s3[0]]);
  return s3.map((d3) => WD_SHORT[d3]).join(", ");
};
function describeRule(r3) {
  const rule = normalizeRule(r3);
  if (!rule) return "";
  const n3 = rule.interval;
  let s3 = "";
  switch (rule.freq) {
    case "day":
      s3 = n3 === 1 ? "Every day" : `Every ${n3} days`;
      break;
    case "week": {
      const l3 = wdList(rule.days);
      if (n3 === 1) s3 = l3 === "weekdays" ? "Weekdays" : l3 === "weekends" ? "Weekends" : l3 === "every day" ? "Every day" : `Every ${l3}`;
      else s3 = `Every ${n3} weeks on ${l3}`;
      break;
    }
    case "month": {
      const on = rule.monthMode === "nth" ? `the ${rule.nth === -1 ? "last" : ordinal(rule.nth)} ${cap(WEEKDAYS[rule.wd])}` : rule.monthDay === -1 ? "the last day" : `the ${ordinal(rule.monthDay)}`;
      s3 = n3 === 1 ? `Monthly on ${on}` : `Every ${n3} months on ${on}`;
      break;
    }
    case "year": {
      const d3 = parseYmd(rule.anchor);
      s3 = `${n3 === 1 ? "Yearly" : `Every ${n3} years`} on ${MON_SHORT[d3.getMonth()]} ${d3.getDate()}`;
      break;
    }
    case "after": {
      const u3 = rule.unit;
      s3 = `${n3} ${u3}${n3 === 1 ? "" : "s"} after completion`;
      break;
    }
  }
  return s3;
}
function firstOnOrAfter(r3, date) {
  const rule = normalizeRule(r3);
  if (rule.freq === "after") return date;
  if (matches(rule, date)) return date;
  return nextAfter(rule, date);
}

// src/data/model.js
var uid = (p3 = "") => p3 + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
var AREA_COLORS = ["blue", "sky", "teal", "green", "amber", "orange", "red", "pink", "purple", "indigo", "brown", "slate"];
var ACCENTS = [
  { id: "blue", name: "Blue" },
  { id: "indigo", name: "Indigo" },
  { id: "teal", name: "Teal" },
  { id: "green", name: "Green" },
  { id: "orange", name: "Orange" },
  { id: "pink", name: "Rose" },
  { id: "slate", name: "Graphite" }
];
var AREA_ICONS = [
  "hammer",
  "briefcase",
  "book-open",
  "church",
  "lightbulb",
  "house",
  "shopping-cart",
  "heart",
  "baby",
  "sprout",
  "code",
  "package",
  "car",
  "dumbbell",
  "piggy-bank",
  "graduation-cap",
  "wrench",
  "paint-roller",
  "tree-pine",
  "gift",
  "utensils",
  "plane",
  "music",
  "laptop",
  "store",
  "dog",
  "camera",
  "star",
  "target",
  "leaf"
];
var DEFAULT_CONTEXTS = ["@Home", "@Shop/Tools", "@Errands", "@Computer", "@Phone", "@DayJob", "@Commute", "@Together", "@Quick"];
var ESTIMATES = [5, 15, 30, 60, 120, 240, 480];
var TODS = [
  { id: "morning", name: "Morning", icon: "sunrise" },
  { id: "afternoon", name: "Afternoon", icon: "sun" },
  { id: "evening", name: "Evening", icon: "moon-star" },
  { id: null, name: "Anytime", icon: "circle-dashed" }
];
var PROJECT_STATUSES = [
  { id: "active", name: "Active" },
  { id: "someday", name: "Someday/Maybe" },
  { id: "hold", name: "On Hold" },
  { id: "done", name: "Completed" },
  { id: "archived", name: "Archived" }
];
var DEFAULT_SETTINGS = {
  theme: "system",
  accent: "blue",
  defaultView: "today",
  weekStart: 1,
  reviewDay: 0,
  reviewTime: "19:00",
  planTime: "07:00",
  features: { estimates: true, energy: true, handyman: true },
  contexts: DEFAULT_CONTEXTS,
  notify: { plan: true, review: true, followups: true },
  onboarded: false,
  lastPlan: null,
  lastReview: null,
  lastShutdown: null,
  dismissed: {},
  // Evenings and phone-free days
  shutdownTime: "19:00",
  shutdownReminder: true,
  dndReminder: true,
  quietMode: true,
  offDays: [1]
  // 0 = Sunday … 6 = Saturday. Mondays are phone-free.
};
var SEED_AREAS = [
  { name: "Handyman Business", color: "orange", icon: "hammer" },
  { name: "Day Job", color: "blue", icon: "briefcase" },
  { name: "Theology Degree", color: "purple", icon: "book-open" },
  { name: "Personal Projects", color: "teal", icon: "lightbulb" },
  { name: "Family & Home", color: "pink", icon: "house" },
  { name: "Errands & Groceries", color: "green", icon: "shopping-cart", listMode: "groceries" }
];
var GROCERY_CATS = [
  { id: "produce", name: "Produce", words: "apple banana berries strawberr blueberr grape lemon lime orange avocado tomato potato onion garlic lettuce spinach kale carrot celery pepper cucumber broccoli cauliflower mushroom zucchini squash cilantro parsley herb fruit veggie vegetable salad corn peach pear melon watermelon" },
  { id: "bakery", name: "Bakery", words: "bread bagel bun roll tortilla muffin croissant cake pie donut english muffin pita" },
  { id: "meat", name: "Meat & Seafood", words: "chicken beef steak pork bacon sausage ham turkey ground fish salmon tuna shrimp hot dog jerky meat" },
  { id: "dairy", name: "Dairy & Eggs", words: "milk egg cheese butter yogurt cream sour cream cottage half and half creamer" },
  { id: "frozen", name: "Frozen", words: "frozen ice cream pizza waffle popsicle ice " },
  { id: "pantry", name: "Pantry", words: "rice pasta noodle cereal oat oatmeal flour sugar salt spice sauce soup can canned beans peanut butter jelly jam honey oil vinegar syrup coffee tea broth stock baking ketchup mustard mayo dressing" },
  { id: "snacks", name: "Snacks & Drinks", words: "chip cracker cookie snack pretzel popcorn soda juice water sparkling candy chocolate granola bar drink gatorade" },
  { id: "baby", name: "Baby", words: "diaper wipe formula baby pacifier bottle nipple onesie" },
  { id: "household", name: "Household", words: "paper towel toilet paper trash bag detergent soap dish dishwasher cleaner bleach sponge foil plastic wrap ziploc battery light bulb laundry napkin" },
  { id: "personal", name: "Personal Care", words: "shampoo conditioner toothpaste toothbrush deodorant lotion razor floss tampon pad sunscreen" },
  { id: "pharmacy", name: "Pharmacy", words: "medicine tylenol ibuprofen advil vitamin prescription bandaid band-aid allergy" },
  { id: "hardware", name: "Hardware", words: "2x4 2x6 4x4 lumber plywood screw nail bolt washer drywall paint caulk tape glue sandpaper pvc pipe fitting wire outlet breaker hinge drill bit blade filter stain deck concrete mortar grout tile" },
  { id: "other", name: "Other", words: "" }
];
function guessGroceryCat(title) {
  const t4 = " " + (title || "").toLowerCase() + " ";
  let best = null;
  for (const c3 of GROCERY_CATS) {
    for (const w3 of c3.words.split(" ").filter(Boolean)) {
      if (t4.includes(w3) && (!best || w3.length > best.len)) best = { id: c3.id, len: w3.length };
    }
  }
  return best ? best.id : "other";
}
var BUILTIN_TEMPLATES = [
  {
    id: "tpl-handyman",
    name: "Handyman Job",
    icon: "hammer",
    areaHint: "Handyman Business",
    builtin: true,
    client: true,
    description: "From first call to a five-star review.",
    outcome: "Job finished, paid, and reviewed",
    sections: [
      { name: "Quote", tasks: [
        { title: "Initial call and notes", contexts: ["@Phone"], est: 15 },
        { title: "Site visit and photos", contexts: ["@Errands"], est: 60 },
        { title: "Write quote", contexts: ["@Computer"], est: 30 },
        { title: "Send quote", contexts: ["@Computer"], est: 5 },
        { title: "Follow up on quote", waiting: { who: "Client" }, est: 5 }
      ] },
      { name: "Job", tasks: [
        { title: "Order materials", contexts: ["@Computer"], est: 30, materials: true },
        { title: "Schedule work", contexts: ["@Phone"], est: 15 },
        { title: "Complete job", contexts: ["@Shop/Tools"], est: 240 },
        { title: "Final photos", est: 5 }
      ] },
      { name: "Close out", tasks: [
        { title: "Send invoice", contexts: ["@Computer"], est: 15 },
        { title: "Follow up on payment", waiting: { who: "Client" }, est: 5 },
        { title: "Ask for a review", contexts: ["@Phone"], est: 5 }
      ] }
    ]
  },
  {
    id: "tpl-course",
    name: "Theology Course",
    icon: "book-open",
    areaHint: "Theology Degree",
    builtin: true,
    description: "Syllabus to final paper.",
    outcome: "Course completed with a grade I am proud of",
    sections: [
      { name: "Setup", tasks: [{ title: "Syllabus review", contexts: ["@Computer"], est: 30 }] },
      { name: "Weekly", tasks: [{ title: "Weekly readings", est: 120, repeat: { freq: "week", interval: 1 } }] },
      { name: "Assignments", tasks: [{ title: "Assignments", est: 120, notes: "List each assignment and its due date as its own task." }] },
      { name: "Exams", tasks: [{ title: "Midterm prep", est: 240 }, { title: "Final exam prep", est: 240 }] },
      { name: "Final paper", tasks: [{ title: "Choose paper topic", est: 30 }, { title: "Research and outline", est: 240 }, { title: "Write final paper", est: 480 }] }
    ]
  },
  {
    id: "tpl-home",
    name: "Home Project",
    icon: "paint-roller",
    areaHint: "Personal Projects",
    builtin: true,
    description: "Plan, buy, build, clean up.",
    outcome: "Project built and the mess cleaned up",
    sections: [
      { name: "Plan", tasks: [{ title: "Plan and measure", contexts: ["@Home"], est: 60 }, { title: "Materials list", est: 30, materials: true }, { title: "Budget", est: 30 }] },
      { name: "Materials", tasks: [{ title: "Buy materials", contexts: ["@Errands"], est: 120 }] },
      { name: "Build", tasks: [{ title: "Prep", contexts: ["@Home"], est: 120 }, { title: "Build or install", contexts: ["@Home", "@Shop/Tools"], est: 480 }, { title: "Cleanup", contexts: ["@Home"], est: 60 }] }
    ]
  },
  {
    id: "tpl-resell",
    name: "Reselling Item",
    icon: "package",
    areaHint: "Personal Projects",
    builtin: true,
    description: "From garage to sold.",
    outcome: "Item sold and handed off",
    sections: [
      { name: "", tasks: [
        { title: "Clean and photograph", contexts: ["@Home"], est: 30 },
        { title: "Research price", contexts: ["@Phone"], est: 15 },
        { title: "List on Marketplace", contexts: ["@Phone"], est: 15 },
        { title: "Respond to buyers", waiting: { who: "Buyers" }, est: 15 },
        { title: "Sell and hand off", est: 30 }
      ] }
    ]
  },
  {
    id: "tpl-event",
    name: "Family Event",
    icon: "cake",
    areaHint: "Family & Home",
    builtin: true,
    description: "Birthdays, dinners, holidays.",
    outcome: "Everyone fed, celebrated, and home happy",
    sections: [
      { name: "Plan", tasks: [{ title: "Pick date", contexts: ["@Together"], est: 15 }, { title: "Invite people", contexts: ["@Phone"], est: 30 }, { title: "Plan food", contexts: ["@Together"], est: 30 }] },
      { name: "Prep", tasks: [{ title: "Shopping list", est: 15 }, { title: "Prep", contexts: ["@Home"], est: 120 }, { title: "Day-of checklist", est: 15, checklist: ["Set up", "Food out", "Photos", "Clean up"] }] }
    ]
  }
];
var isOpen = (t4) => t4 && t4.status === "open";
var isDone = (t4) => t4 && t4.status === "done";
function newTask(fields) {
  const now2 = Date.now();
  return {
    id: fields.id || uid("t"),
    title: (fields.title || "").trim() || "Untitled",
    notes: fields.notes || "",
    areaId: fields.areaId || null,
    projectId: fields.projectId || null,
    sectionId: fields.sectionId || null,
    when: fields.when || null,
    tod: fields.tod || null,
    time: fields.time || null,
    due: fields.due || null,
    someday: !!fields.someday,
    contexts: fields.contexts || [],
    energy: fields.energy || null,
    est: fields.est || null,
    important: !!fields.important,
    priority: fields.priority || "normal",
    checklist: fields.checklist || [],
    repeat: fields.repeat ? normalizeRule(fields.repeat) : null,
    waiting: fields.waiting || null,
    photos: fields.photos || [],
    handy: fields.handy || null,
    grocery: fields.grocery || null,
    list: fields.list || null,
    status: "open",
    doneAt: null,
    doneBy: null,
    createdAt: now2,
    updatedAt: now2,
    order: fields.order ?? now2,
    todayOrder: fields.todayOrder ?? null,
    reschedules: 0,
    focusMinutes: 0,
    history: [{ at: now2, what: "created" }]
  };
}
var isInbox = (t4) => isOpen(t4) && !t4.areaId && !t4.projectId && !t4.list && !t4.someday;
function homeOf(t4, data) {
  const p3 = t4.projectId && data.projects.get(t4.projectId);
  const a3 = t4.areaId && data.areas.get(t4.areaId) || p3 && p3.areaId && data.areas.get(p3.areaId);
  return { project: p3 || null, area: a3 || null };
}
function areaOfTask(t4, data) {
  if (t4.areaId) return data.areas.get(t4.areaId) || null;
  const p3 = t4.projectId && data.projects.get(t4.projectId);
  return p3 && p3.areaId && data.areas.get(p3.areaId) || null;
}
function projectActive(t4, data) {
  if (!t4.projectId) return true;
  const p3 = data.projects.get(t4.projectId);
  return !p3 || p3.status === "active";
}
var isGroceryItem = (t4) => !!t4.grocery;
function isActionable(t4, data) {
  return isOpen(t4) && !t4.someday && !t4.waiting && !isGroceryItem(t4) && !t4.list && projectActive(t4, data);
}
var byOrder = (a3, b2) => (a3.order ?? 0) - (b2.order ?? 0) || a3.createdAt - b2.createdAt;
var byToday = (a3, b2) => (a3.todayOrder ?? a3.order ?? 0) - (b2.todayOrder ?? b2.order ?? 0) || a3.createdAt - b2.createdAt;
function allTasks(data) {
  return [...data.tasks.values()];
}
function selectInbox(data) {
  return allTasks(data).filter(isInbox).sort((a3, b2) => a3.createdAt - b2.createdAt);
}
function selectToday(data) {
  const t4 = today();
  const main = [], overdue = [];
  for (const task of data.tasks.values()) {
    if (!isOpen(task) || task.someday) continue;
    if (task.when === t4 || task.due === t4) main.push(task);
    else if (task.when && task.when < t4 || task.due && task.due < t4) overdue.push(task);
  }
  main.sort(byToday);
  overdue.sort((a3, b2) => (a3.due || a3.when).localeCompare(b2.due || b2.when));
  const groups = { start: [], morning: [], afternoon: [], evening: [], anytime: [] };
  for (const task of main) groups[task.first === t4 ? "start" : task.tod || "anytime"].push(task);
  return { main, overdue, groups };
}
var isOffDay = (s3, date) => (s3.offDays || []).includes(weekday(date));
function nextWorkDay(s3, from) {
  let d3 = addDays(from, 1);
  for (let i3 = 0; i3 < 7 && isOffDay(s3, d3); i3++) d3 = addDays(d3, 1);
  return d3;
}
function quietState(s3, t4, hm) {
  if (!s3.quietMode) return null;
  const morning = s3.planTime || "07:00";
  const y3 = addDays(t4, -1);
  if (isOffDay(s3, t4)) return { kind: "offday", date: t4 };
  if (hm < morning && (s3.lastShutdown === y3 || isOffDay(s3, y3))) return { kind: "night", date: t4 };
  if (s3.lastShutdown === t4) return { kind: "evening", date: addDays(t4, 1) };
  return null;
}
function selectDay(data, date) {
  const tasks = [], repeats = [];
  for (const task of data.tasks.values()) {
    if (!isOpen(task) || task.someday || task.grocery) continue;
    if (task.when === date || task.due === date) tasks.push(task);
    else if (task.repeat && task.repeat.freq !== "after" && (task.when || task.due) && (task.when || task.due) < date && matches(task.repeat, date)) repeats.push(task);
  }
  const rank = (x2) => x2.first === date ? 0 : { morning: 1, afternoon: 2, evening: 3 }[x2.tod] || 4;
  tasks.sort((a3, b2) => rank(a3) - rank(b2) || byToday(a3, b2));
  return { tasks, repeats };
}
function selectUpcoming(data, opts = {}) {
  const t4 = today();
  const horizon = opts.horizon || addMonths(t4, 6);
  const tasks = [];
  const previews = [];
  for (const task of data.tasks.values()) {
    if (!isOpen(task) || task.someday) continue;
    const d3 = task.when || task.due;
    if (task.when && task.when > t4) tasks.push({ task, date: task.when, kind: "when" });
    else if (!task.when && task.due && task.due > t4) tasks.push({ task, date: task.due, kind: "due" });
    if (task.repeat && d3) {
      const from = d3 > t4 ? d3 : t4;
      for (const o3 of occurrencesBetween(task.repeat, from, horizon, 40)) {
        if (o3 > d3) previews.push({ task, date: o3, kind: "preview" });
      }
    }
  }
  return { tasks, previews };
}
function upcomingBuckets(weekStart = 1) {
  const t4 = today();
  const out = [];
  for (let i3 = 1; i3 <= 14; i3++) {
    const d3 = addDays(t4, i3);
    out.push({ kind: "day", from: d3, to: d3, key: d3 });
  }
  let from = addDays(t4, 15);
  const weeksEnd = addDays(startOfMonth(addMonths(t4, 2)), -1);
  let ws = startOfWeek(from, weekStart);
  while (from <= weeksEnd) {
    const to = addDays(ws, 6);
    out.push({ kind: "week", from, to: to < weeksEnd ? to : weeksEnd, key: "w" + from });
    from = addDays(to, 1);
    ws = from;
  }
  for (let i3 = 0; i3 < 4; i3++) {
    const mfrom = from;
    const mto = addDays(startOfMonth(addMonths(mfrom, 1)), -1);
    out.push({ kind: "month", from: mfrom, to: mto, key: "m" + mfrom });
    from = addDays(mto, 1);
  }
  out.push({ kind: "later", from, to: "9999-12-31", key: "later" });
  return out;
}
function selectAnytime(data, filters = {}) {
  const t4 = today();
  return allTasks(data).filter(
    (task) => isActionable(task, data) && (task.areaId || task.projectId) && !task.when && (!filters.context || (task.contexts || []).includes(filters.context)) && (!filters.energy || !task.energy || energyRank(task.energy) <= energyRank(filters.energy)) && (!filters.maxTime || !task.est || task.est <= filters.maxTime)
  ).sort(byOrder);
}
var energyRank = (e3) => ({ low: 1, med: 2, high: 3 })[e3] || 2;
function selectSomeday(data) {
  const tasks = allTasks(data).filter((t4) => isOpen(t4) && t4.someday).sort(byOrder);
  const projects = [...data.projects.values()].filter((p3) => p3.status === "someday").sort((a3, b2) => (a3.order || 0) - (b2.order || 0));
  return { tasks, projects };
}
function selectWaiting(data) {
  return allTasks(data).filter((t4) => isOpen(t4) && t4.waiting).sort((a3, b2) => (a3.waiting.followUp || "9999").localeCompare(b2.waiting.followUp || "9999") || (a3.waiting.since || "").localeCompare(b2.waiting.since || ""));
}
function selectLogbook(data) {
  return allTasks(data).filter(isDone).sort((a3, b2) => (b2.doneAt || 0) - (a3.doneAt || 0));
}
function projectTasks(data, pid) {
  return allTasks(data).filter((t4) => t4.projectId === pid);
}
function projectStats(data, p3) {
  const ts = projectTasks(data, p3.id);
  const open = ts.filter(isOpen).length;
  const done2 = ts.filter(isDone).length + (p3.archivedDone || 0);
  const total = open + done2;
  return { open, done: done2, total, pct: total ? done2 / total : 0 };
}
function sortProjectTasks(p3, tasks) {
  const secIndex = new Map((p3.sections || []).map((s3, i3) => [s3.id, i3]));
  return [...tasks].sort((a3, b2) => {
    const sa = a3.sectionId && secIndex.has(a3.sectionId) ? secIndex.get(a3.sectionId) : -1;
    const sb = b2.sectionId && secIndex.has(b2.sectionId) ? secIndex.get(b2.sectionId) : -1;
    return sa - sb || byOrder(a3, b2);
  });
}
function nextAction(data, p3) {
  const open = sortProjectTasks(p3, projectTasks(data, p3.id).filter((t4) => isOpen(t4) && !t4.waiting && !t4.someday));
  return open[0] || null;
}
function activeProjects(data) {
  return [...data.projects.values()].filter((p3) => p3.status === "active").sort((a3, b2) => (a3.order || 0) - (b2.order || 0));
}
function areaList(data, { includeArchived = false } = {}) {
  return [...data.areas.values()].filter((a3) => includeArchived || !a3.archived).sort((a3, b2) => (a3.order || 0) - (b2.order || 0) || a3.createdAt - b2.createdAt);
}
function suggestForToday(data, limit = 8) {
  const t4 = today();
  const nextIds = new Set(activeProjects(data).map((p3) => nextAction(data, p3)).filter(Boolean).map((x2) => x2.id));
  const scored = selectAnytime(data).filter((x2) => !x2.when).map((task) => {
    let s3 = 0;
    const why = [];
    if (task.due) {
      const dd = diffDays(t4, task.due);
      if (dd <= 1) {
        s3 += 50;
        why.push("Due " + (dd <= 0 ? "today" : "tomorrow"));
      } else if (dd <= 3) {
        s3 += 30;
        why.push("Due soon");
      } else if (dd <= 7) {
        s3 += 15;
        why.push("Due this week");
      }
    }
    if (task.important) {
      s3 += 20;
      why.push("Important");
    }
    if (task.priority === "high") s3 += 12;
    if (task.priority === "low") s3 -= 8;
    if (nextIds.has(task.id)) {
      s3 += 14;
      why.push("Next action");
      const p3 = data.projects.get(task.projectId);
      if (p3 && p3.deadline && diffDays(t4, p3.deadline) <= 14) {
        s3 += 12;
        why.push("Project deadline");
      }
    }
    s3 += Math.min(10, (Date.now() - task.createdAt) / 864e5 / 3);
    return { task, score: s3, why };
  });
  return scored.sort((a3, b2) => b2.score - a3.score).slice(0, limit);
}
function bestNow(data, { context, minutes, energy }) {
  const t4 = today();
  return allTasks(data).filter((task) => isActionable(task, data) && (!task.when || task.when <= t4)).map((task) => {
    let s3 = 0;
    const ctx = task.contexts || [];
    if (context) {
      if (ctx.includes(context)) s3 += 30;
      else if (ctx.length) return null;
      if (context === "@Quick" && !(task.est && task.est <= 5) && !ctx.includes("@Quick")) return null;
    }
    if (minutes) {
      if (task.est && task.est > minutes) return null;
      if (task.est) s3 += 10 - Math.abs(minutes - task.est) / Math.max(minutes, 1) * 5;
    }
    if (energy && task.energy && energyRank(task.energy) > energyRank(energy)) return null;
    if (energy && task.energy === energy) s3 += 5;
    if (task.when === t4) s3 += 15;
    if (task.due) s3 += Math.max(0, 20 - diffDays(t4, task.due) * 2);
    if (task.important) s3 += 10;
    return { task, score: s3 };
  }).filter(Boolean).sort((a3, b2) => b2.score - a3.score).slice(0, 12).map((x2) => x2.task);
}
function completedBetween(data, fromTs, toTs) {
  return allTasks(data).filter((t4) => isDone(t4) && t4.doneAt >= fromTs && t4.doneAt < toTs);
}
function compactForLogbook(t4) {
  const { history: history2, _s, ...rest } = t4;
  return { ...rest, notes: (t4.notes || "").slice(0, 2e3) };
}
function searchAll(data, q3, archive = []) {
  const s3 = q3.trim().toLowerCase();
  if (!s3) return { tasks: [], projects: [], areas: [] };
  const hit = (x2) => x2 && x2.toLowerCase().includes(s3);
  const tasks = [...allTasks(data), ...archive.filter((a3) => !data.tasks.has(a3.id))].filter((t4) => hit(t4.title) || hit(t4.notes) || (t4.checklist || []).some((c3) => hit(c3.text)) || t4.handy && (hit(t4.handy.client) || hit(t4.handy.address)) || (t4.contexts || []).some(hit)).sort((a3, b2) => isOpen(b2) - isOpen(a3) || (b2.updatedAt || 0) - (a3.updatedAt || 0)).slice(0, 80);
  const projects = [...data.projects.values()].filter((p3) => hit(p3.name) || hit(p3.notes) || hit(p3.outcome) || hit(p3.description));
  const areas = [...data.areas.values()].filter((a3) => hit(a3.name));
  return { tasks, projects, areas };
}
function csvForTasks(tasks, data) {
  const cols = ["Title", "Status", "Area", "Project", "When", "Time of day", "Due", "Contexts", "Energy", "Estimate (min)", "Important", "Priority", "Repeat", "Waiting on", "Client", "Notes", "Created", "Completed"];
  const esc2 = (v3) => {
    const s3 = v3 == null ? "" : String(v3);
    return /[",\n]/.test(s3) ? '"' + s3.replace(/"/g, '""') + '"' : s3;
  };
  const rows = tasks.map((t4) => {
    const { area, project } = homeOf(t4, data);
    return [
      t4.title,
      t4.status,
      area && area.name,
      project && project.name,
      t4.when,
      t4.tod,
      t4.due,
      (t4.contexts || []).join(" "),
      t4.energy,
      t4.est,
      t4.important ? "yes" : "",
      t4.priority,
      t4.repeat ? t4.repeat.freq : "",
      t4.waiting && t4.waiting.who,
      t4.handy && t4.handy.client,
      t4.notes,
      t4.createdAt && new Date(t4.createdAt).toISOString(),
      t4.doneAt && new Date(t4.doneAt).toISOString()
    ].map(esc2).join(",");
  });
  return [cols.join(","), ...rows].join("\n");
}

var esc = (s3) => s3.replace(/[&<>"']/g, (c3) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c3]);
function inline(s3) {
  let t4 = esc(s3);
  t4 = t4.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t4 = t4.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  t4 = t4.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return t4;
}
function renderNotes(text) {
  const lines = (text || "").split("\n");
  let out = "", inList = false;
  lines.forEach((line, i3) => {
    const cb = line.match(/^\s*[-*] \[( |x|X)\] (.*)$/);
    const li = line.match(/^\s*[-*] (.*)$/);
    const hd = line.match(/^#{1,3} (.*)$/);
    if (cb) {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      const on = cb[1].toLowerCase() === "x";
      out += `<div class="md-check"><button class="check sq${on ? " on" : ""}" data-line="${i3}" aria-label="Toggle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button><span style="${on ? "color:var(--ink-3);text-decoration:line-through" : ""}">${inline(cb[2])}</span></div>`;
    } else if (li) {
      if (!inList) {
        out += "<ul>";
        inList = true;
      }
      out += `<li>${inline(li[1])}</li>`;
    } else {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      if (hd) out += `<h4>${inline(hd[1])}</h4>`;
      else if (line.trim()) out += `<p>${inline(line)}</p>`;
    }
  });
  if (inList) out += "</ul>";
  return out;
}
function toggleNoteLine(text, i3) {
  const lines = text.split("\n");
  lines[i3] = lines[i3].replace(/\[( |x|X)\]/, (m2, c3) => c3 === " " ? "[x]" : "[ ]");
  return lines.join("\n");
}
// src/lib/parse.js
var WD_ALIASES = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};
var WD_RE = "(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)";
var MONTH_ALIASES = {};
MONTHS.forEach((m2, i3) => {
  MONTH_ALIASES[m2] = i3;
  MONTH_ALIASES[m2.slice(0, 3)] = i3;
});
MONTH_ALIASES.sept = 8;
var MONTH_RE = "(?:january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";
var NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, "a couple": 2, "a couple of": 2, few: 3, "a few": 3 };
var NUM_RE = "(?:\\d+|a couple of|a couple|a few|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few)";
var ORD = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, last: -1 };
var ORD_RE = "(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)";
var TOD_RE = "(?:morning|afternoon|evening|night|tonight)";
var END = "(?![\\w])";
var num = (s3) => /^\d+$/.test(s3) ? Number(s3) : NUM_WORDS[s3.toLowerCase()] || 1;
var todFromWord = (w3) => ({ morning: "morning", afternoon: "afternoon", evening: "evening", night: "evening", tonight: "evening" })[w3];
var todFromHour = (h3) => h3 < 12 ? "morning" : h3 < 17 ? "afternoon" : "evening";
var norm = (s3) => s3.toLowerCase().replace(/[^a-z0-9]/g, "");
function matchDateAt(s3, ctx = {}) {
  const t4 = ctx.today || today();
  const ws = ctx.weekStart ?? 1;
  const lower = s3.toLowerCase();
  let m2;
  const R = (re) => m2 = lower.match(new RegExp("^" + re + END));
  let res = null;
  if (R("(tomorrow|tmrw|today|tonight)(?:'s|’s|s)")) res = { len: m2[0].length, date: /^tom|^tmrw/.test(m2[1]) ? addDays(t4, 1) : t4, tod: m2[1] === "tonight" ? "evening" : void 0, keep: true };
  else if (R("(?:today|tod)")) res = { len: m2[0].length, date: t4 };
  else if (R("tonight")) res = { len: m2[0].length, date: t4, tod: "evening" };
  else if (R("this (morning|afternoon|evening)")) res = { len: m2[0].length, date: t4, tod: m2[1] };
  else if (R("(?:the )?day after (?:tomorrow|tmrw)")) res = { len: m2[0].length, date: addDays(t4, 2) };
  else if (R("(?:tomorrow|tmrw|tmr|tmw|tomorow|tommorow)")) res = { len: m2[0].length, date: addDays(t4, 1) };
  else if (R("next week")) res = { len: m2[0].length, date: addDays(startOfWeek(t4, ws), 7) };
  else if (R("next month")) res = { len: m2[0].length, date: addMonths(t4.slice(0, 8) + "01", 1) };
  else if (R("next weekend")) res = { len: m2[0].length, date: addDays(nextWeekday(addDays(startOfWeek(t4, ws), 7), 6), 0) };
  else if (R("(?:this )?weekend")) res = { len: m2[0].length, date: weekday(t4) === 0 ? t4 : nextWeekday(t4, 6) };
  else if (R("end of (?:the )?month")) res = { len: m2[0].length, date: ymd(new Date(parseYmd(t4).getFullYear(), parseYmd(t4).getMonth() + 1, 0, 12)) };
  else if (R("end of (?:the )?week")) res = { len: m2[0].length, date: nextWeekday(t4, 5) };
  else if (R(`in (${NUM_RE}) (day|days|week|weeks|month|months|year|years)`)) {
    const n3 = num(m2[1]);
    const u3 = m2[2].replace(/s$/, "");
    const date = u3 === "day" ? addDays(t4, n3) : u3 === "week" ? addDays(t4, 7 * n3) : u3 === "month" ? addMonths(t4, n3) : addMonths(t4, 12 * n3);
    res = { len: m2[0].length, date };
  } else if (R(`(next |this |on )?(${WD_RE})`)) {
    const wd = WD_ALIASES[m2[2]];
    if (m2[2] === "sun" && !m2[1]) return null;
    let date;
    if (m2[1] === "next ") {
      const nw = addDays(startOfWeek(t4, ws), 7);
      date = nextWeekday(nw, wd);
    } else date = nextWeekday(t4, wd);
    res = { len: m2[0].length, date };
  } else if (R(`(?:on )?(${MONTH_RE})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`)) {
    res = monthDay(t4, MONTH_ALIASES[m2[1]], Number(m2[2]), m2[3] && Number(m2[3]), m2[0].length);
  } else if (R(`(?:on )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_RE})(?:,? (\\d{4}))?`)) {
    res = monthDay(t4, MONTH_ALIASES[m2[2]], Number(m2[1]), m2[3] && Number(m2[3]), m2[0].length);
  } else if (R("(?:on )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?")) {
    let y3 = m2[3] ? Number(m2[3]) : null;
    if (y3 && y3 < 100) y3 += 2e3;
    res = monthDay(t4, Number(m2[1]) - 1, Number(m2[2]), y3, m2[0].length);
  } else if (R("(?:on )?the (\\d{1,2})(?:st|nd|rd|th)")) {
    const day = Number(m2[1]);
    if (day < 1 || day > 31) return null;
    const d3 = parseYmd(t4);
    let y3 = d3.getFullYear(), mo = d3.getMonth();
    if (day < d3.getDate()) {
      mo++;
      if (mo > 11) {
        mo = 0;
        y3++;
      }
    }
    const dd = Math.min(day, daysInMonth(y3, mo));
    res = { len: m2[0].length, date: ymd(new Date(y3, mo, dd, 12)) };
  }
  if (!res) return null;
  const rest = lower.slice(res.len);
  const tm = rest.match(new RegExp("^ (?:in the )?(" + TOD_RE + ")" + END));
  if (tm && !res.tod) {
    res.tod = todFromWord(tm[1]);
    res.len += tm[0].length;
  }
  return res;
}
function monthDay(t4, mo, day, year, len) {
  if (mo == null || mo < 0 || mo > 11 || day < 1 || day > 31) return null;
  const td = parseYmd(t4);
  let y3 = year || td.getFullYear();
  if (day > daysInMonth(y3, mo)) return null;
  let date = ymd(new Date(y3, mo, day, 12));
  if (!year && date < t4) date = ymd(new Date(y3 + 1, mo, Math.min(day, daysInMonth(y3 + 1, mo)), 12));
  return { len, date };
}
function matchTimeAt(s3) {
  const lower = s3.toLowerCase();
  let m2 = lower.match(new RegExp("^(?:at |@ ?)?(noon|midday|midnight)" + END));
  if (m2) return { len: m2[0].length, time: m2[1] === "midnight" ? "00:00" : "12:00" };
  m2 = lower.match(/^(at )?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.|a|p)?(?![\w])/);
  if (!m2) return null;
  const hasAt = !!m2[1], hasMer = !!m2[4], hasMin = m2[3] != null;
  if (!hasAt && !hasMer) return null;
  let h3 = Number(m2[2]);
  const min = hasMin ? Number(m2[3]) : 0;
  if (h3 > 23 || min > 59) return null;
  if (hasMer) {
    const pm = m2[4][0] === "p";
    if (h3 > 12 || h3 === 0) return null;
    h3 = h3 % 12 + (pm ? 12 : 0);
  } else if (h3 <= 12) {
    if (h3 >= 1 && h3 <= 6) h3 += 12;
  }
  return { len: m2[0].length, time: `${String(h3).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}
function matchRepeatAt(s3, ctx = {}) {
  const t4 = ctx.today || today();
  const lower = s3.toLowerCase();
  let m2;
  const R = (re) => m2 = lower.match(new RegExp("^" + re + END));
  const AFTER = `(?: (?:after|from) (?:completion|completed|complete|done|finishing|finished|last time|i finish|it'?s done))`;
  let rule = null, len = 0;
  if (R(`every (${NUM_RE}|other) (day|days|week|weeks|month|months|year|years)${AFTER}`) || R(`(${NUM_RE}) (day|days|week|weeks|month|months)${AFTER}`)) {
    const n3 = m2[1] === "other" ? 2 : num(m2[1]);
    rule = { freq: "after", interval: n3, unit: m2[2].replace(/s$/, "") };
  } else if (R("(?:every ?day|daily)")) rule = { freq: "day", interval: 1 };
  else if (R("every (?:weekday|weekdays|work ?day|work ?days)")) rule = { freq: "week", interval: 1, days: [1, 2, 3, 4, 5] };
  else if (R("every (?:weekend|weekends)")) rule = { freq: "week", interval: 1, days: [0, 6] };
  else if (R("(?:every week|weekly)")) rule = { freq: "week", interval: 1 };
  else if (R("(?:every month|monthly)(?: on the (\\d{1,2})(?:st|nd|rd|th))?")) {
    rule = { freq: "month", interval: 1, monthMode: "date" };
    if (m2[1]) rule.monthDay = Number(m2[1]);
  } else if (R("(?:every year|yearly|annually)")) rule = { freq: "year", interval: 1 };
  else if (R(`every (${NUM_RE}|other) (day|days|week|weeks|month|months|year|years)(?: on (${WD_RE}(?:(?:, ?| and |,? & ?)${WD_RE})*))?`)) {
    const n3 = m2[1] === "other" ? 2 : num(m2[1]);
    const u3 = m2[2].replace(/s$/, "");
    rule = { freq: u3, interval: n3 };
    if (u3 === "week" && m2[3]) rule.days = m2[3].split(/, ?| and |,? & ?/).map((w3) => WD_ALIASES[w3.trim()]);
  } else if (R(`every (${ORD_RE}) (${WD_RE})(?: of (?:the|every) month)?`)) {
    rule = { freq: "month", interval: 1, monthMode: "nth", nth: ORD[m2[1]], wd: WD_ALIASES[m2[2]] };
  } else if (R("every (?:last day of the month|month end|end of (?:the )?month)")) {
    rule = { freq: "month", interval: 1, monthMode: "date", monthDay: -1 };
  } else if (R("every (\\d{1,2})(?:st|nd|rd|th)(?: of (?:the|every) month)?")) {
    const d3 = Number(m2[1]);
    if (d3 >= 1 && d3 <= 31) rule = { freq: "month", interval: 1, monthMode: "date", monthDay: d3 };
  } else if (R(`every (${MONTH_RE}) (\\d{1,2})(?:st|nd|rd|th)?`)) {
    const md = monthDay(t4, MONTH_ALIASES[m2[1]], Number(m2[2]), null, 0);
    if (md) rule = { freq: "year", interval: 1, anchor: md.date };
  } else if (R(`every (${WD_RE}(?:(?:, ?| and |,? & ?)${WD_RE})*)`)) {
    rule = { freq: "week", interval: 1, days: m2[1].split(/, ?| and |,? & ?/).map((w3) => WD_ALIASES[w3.trim()]) };
  }
  if (!rule) return null;
  len = m2[0].length;
  return { len, rule };
}
var EST = { half: 240, halfday: 240, "half-day": 240, day: 480, fullday: 480, "full-day": 480, full: 480 };
function parseEstimate(v3) {
  const s3 = v3.toLowerCase();
  if (EST[s3]) return EST[s3];
  let m2 = s3.match(/^(\d+(?:\.\d+)?)(m|min|mins|minutes?)?$/);
  if (m2) return Math.round(Number(m2[1]));
  m2 = s3.match(/^(\d+(?:\.\d+)?)(h|hr|hrs|hours?)$/);
  if (m2) return Math.round(Number(m2[1]) * 60);
  m2 = s3.match(/^(\d+)h(\d+)m?$/);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  m2 = s3.match(/^(\d+(?:\.\d+)?)(d|days?)$/);
  if (m2) return Math.round(Number(m2[1]) * 480);
  return null;
}
function matchName(list, raw, field = "name") {
  const q3 = norm(raw);
  if (!q3) return null;
  let best = null;
  for (const it of list) {
    const n3 = norm(it[field]);
    const words = it[field].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    if (n3 === q3) score = 3;
    else if (n3.startsWith(q3)) score = 2;
    else if (words.some((w3) => w3.startsWith(q3))) score = 1;
    if (score && (!best || score > best.score)) best = { item: it, score };
  }
  return best && best.item;
}
function parseQuickAdd(text, ctx = {}) {
  const ignore = ctx.ignore || /* @__PURE__ */ new Set();
  const tokens = [];
  const fields = {};
  const n3 = text.length;
  const state = new Array(n3).fill(0);
  const isFree = (a3, b2) => {
    for (let i3 = a3; i3 < b2; i3++) if (state[i3]) return false;
    return true;
  };
  const mark = (a3, b2, v3) => {
    for (let i3 = a3; i3 < b2; i3++) state[i3] = v3;
  };
  const add = (tok) => {
    const raw = text.slice(tok.start, tok.end);
    tok.raw = raw;
    if (ignore.has(raw.toLowerCase().trim())) {
      mark(tok.start, tok.end, 2);
      return false;
    }
    mark(tok.start, tok.end, tok.keep ? 2 : 1);
    tokens.push(tok);
    return true;
  };
  const symRe = /(^|\s)([+^@~])([^\s+^@~!]+)/g;
  let m2;
  while (m2 = symRe.exec(text)) {
    const start = m2.index + m2[1].length, end = start + 1 + m2[3].length;
    const sym = m2[2], val = m2[3].replace(/[.,;:]+$/, "");
    const realEnd = start + 1 + val.length;
    if (!val) continue;
    if (sym === "+") {
      const p3 = matchName(ctx.projects || [], val.replace(/[-_]/g, " "));
      add({ type: "project", start, end: realEnd, symbol: true, value: p3 ? p3.id : null, label: p3 ? p3.name : `No project “${val}”`, unresolved: !p3 });
      if (p3 && !fields.projectId) fields.projectId = p3.id;
    } else if (sym === "^") {
      const a3 = matchName(ctx.areas || [], val.replace(/[-_]/g, " "));
      add({ type: "area", start, end: realEnd, symbol: true, value: a3 ? a3.id : null, label: a3 ? a3.name : `No area “${val}”`, unresolved: !a3 });
      if (a3 && !fields.areaId) fields.areaId = a3.id;
    } else if (sym === "@") {
      const list = (ctx.contexts || []).map((c4) => ({ name: c4.replace(/^@/, "") }));
      const c3 = matchName(list, val);
      const name = "@" + (c3 ? c3.name : val[0].toUpperCase() + val.slice(1));
      add({ type: "context", start, end: realEnd, symbol: true, value: name, label: name });
      fields.contexts = [.../* @__PURE__ */ new Set([...fields.contexts || [], name])];
    } else if (sym === "~") {
      const est = parseEstimate(val);
      if (est) {
        add({ type: "estimate", start, end: realEnd, symbol: true, value: est, label: fmtMinutes(est) });
        fields.est = est;
      }
    }
  }
  const bangRe = /(^|\s)(!{1,3})(?=\s|$)/g;
  while (m2 = bangRe.exec(text)) {
    const start = m2.index + m2[1].length, end = start + m2[2].length;
    if (!isFree(start, end)) continue;
    add({ type: "important", start, end, symbol: true, value: m2[2].length, label: m2[2].length > 1 ? "Important · High" : "Important" });
    fields.important = true;
    if (m2[2].length > 1) fields.priority = "high";
  }
  const wordStarts = () => {
    const out = [];
    for (let i3 = 0; i3 < n3; i3++) if (!state[i3] && /\S/.test(text[i3]) && (i3 === 0 || /\s/.test(text[i3 - 1]))) out.push(i3);
    return out;
  };
  const tryAt = (fn, type) => {
    for (const i3 of wordStarts()) {
      if (state[i3]) continue;
      const r3 = fn(text.slice(i3), ctx);
      if (!r3) continue;
      const end = i3 + r3.len;
      if (!isFree(i3, end)) continue;
      const added = type(i3, end, r3);
      if (added === "stop") break;
    }
  };
  tryAt(matchRepeatAt, (start, end, r3) => {
    if (fields.repeat) return;
    const rule = normalizeRule({ ...r3.rule, anchor: r3.rule.anchor || ctx.today || today() });
    if (add({ type: "repeat", start, end, value: rule, label: describeRule(rule) })) fields.repeat = rule;
  });
  for (const i3 of wordStarts()) {
    const rest = text.slice(i3);
    const dm = rest.match(/^(due|deadline)(?: (?:on|by))? /i);
    if (!dm) continue;
    const r3 = matchDateAt(rest.slice(dm[0].length), ctx);
    if (!r3) continue;
    const end = i3 + dm[0].length + r3.len;
    if (!isFree(i3, end)) continue;
    if (add({ type: "due", start: i3, end, value: r3.date, label: "Due " + relLabel(r3.date) })) fields.due = r3.date;
    break;
  }
  tryAt(matchDateAt, (start, end, r3) => {
    if (fields.when) return;
    const label = relLabel(r3.date) + (r3.tod ? " " + r3.tod : "");
    if (add({ type: "when", start, end, value: r3.date, tod: r3.tod, label, keep: r3.keep })) {
      fields.when = r3.date;
      if (r3.tod) fields.tod = r3.tod;
    }
  });
  tryAt((s3) => matchTimeAt(s3), (start, end, r3) => {
    if (fields.time) return;
    const h3 = Number(r3.time.slice(0, 2));
    if (add({ type: "time", start, end, value: r3.time, label: fmtTime(r3.time) })) {
      fields.time = r3.time;
      fields.tod = todFromHour(h3);
    }
  });
  tryAt((s3) => {
    const mm = s3.toLowerCase().match(new RegExp("^in the (morning|afternoon|evening)" + END));
    return mm ? { len: mm[0].length, tod: mm[1] } : null;
  }, (start, end, r3) => {
    if (fields.tod) return;
    if (add({ type: "tod", start, end, value: r3.tod, label: r3.tod[0].toUpperCase() + r3.tod.slice(1) })) fields.tod = r3.tod;
  });
  const t4 = ctx.today || today();
  if ((fields.time || fields.tod) && !fields.when && !fields.due) fields.when = t4;
  if (fields.repeat) {
    if (fields.when) {
      const r3 = { ...fields.repeat, anchor: fields.when };
      if (r3.freq === "week" && !tokens.find((k3) => k3.type === "repeat" && /(sun|mon|tue|wed|thu|fri|sat|weekday|weekend)/i.test(k3.raw))) r3.days = null;
      if (r3.freq === "month" && r3.monthMode === "date" && !/\d/.test((tokens.find((k3) => k3.type === "repeat") || {}).raw || "")) r3.monthDay = null;
      fields.repeat = normalizeRule(r3);
    } else if (!fields.due && fields.repeat.freq !== "after") {
      fields.when = firstOnOrAfter(fields.repeat, t4);
      fields.repeat = normalizeRule({ ...fields.repeat, anchor: fields.when, days: fields.repeat.days });
    }
    const tk = tokens.find((k3) => k3.type === "repeat");
    if (tk) {
      tk.value = fields.repeat;
      tk.label = describeRule(fields.repeat);
    }
  }
  let title = "";
  for (let i3 = 0; i3 < n3; i3++) title += state[i3] === 1 ? " " : text[i3];
  title = title.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  tokens.sort((a3, b2) => a3.start - b2.start);
  return { title, fields, tokens };
}
function parseDuration(s3) {
  if (!s3) return null;
  const t4 = s3.toLowerCase().trim();
  let m2 = t4.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(?:and\s*)?(\d+)\s*(?:m|min|mins|minutes)?)?/);
  if (m2) return Math.round(Number(m2[1]) * 60 + (m2[2] ? Number(m2[2]) : 0));
  m2 = t4.match(/(\d+)\s*(?:m|min|mins|minutes)/);
  if (m2) return Number(m2[1]);
  if (/half(?:\s|-)?day/.test(t4)) return 240;
  if (/(full|whole|all)\s*day/.test(t4)) return 480;
  m2 = t4.match(/(an?|one|two|three|four|five|six)\s+hours?/);
  if (m2) return num(m2[1]) * 60;
  if (/half an hour/.test(t4)) return 30;
  m2 = t4.match(/^(\d+(?:\.\d+)?)$/);
  if (m2) return Number(m2[1]) <= 12 ? Math.round(Number(m2[1]) * 60) : Number(m2[1]);
  return null;
}

// src/lib/ramble.js
var cap4 = (s3) => s3 ? s3[0].toUpperCase() + s3.slice(1) : s3;
var ISO = /^\d{4}-\d{2}-\d{2}$/;
function rambleprompt({ focusName, focusKind, areaName, existing = [], sections = [], contexts = [], text, weekStart = 1 }) {
  const t4 = today();
  const d3 = parseYmd(t4);
  const wd = WEEKDAYS[d3.getDay()];
  const week = Array.from({ length: 7 }, (_3, i3) => {
    const x2 = addDays(t4, i3);
    return `${WEEKDAYS[parseYmd(x2).getDay()]} ${x2}`;
  }).join(", ");
  return [
    "You turn a person’s spoken or typed ramble about ONE thing into a clean, practical to-do list for their task manager.",
    "",
    `Today is ${cap4(wd)}, ${MONTHS[d3.getMonth()][0].toUpperCase() + MONTHS[d3.getMonth()].slice(1)} ${d3.getDate()}, ${d3.getFullYear()} (${t4}). The next seven days are: ${week}. Weeks start on ${weekStart === 0 ? "Sunday" : "Monday"}.`,
    `The one thing they are thinking through: "${focusName}"${focusKind === "project" ? " (an existing project)" : focusKind === "task" ? " (an existing task)" : ""}${areaName ? ` in their "${areaName}" area` : ""}.`,
    existing.length ? `Already on its list (do not repeat these):
${existing.slice(0, 40).map((x2) => "- " + x2).join("\n")}` : "",
    sections.length ? `Its existing phases: ${sections.join(", ")}.` : "",
    contexts.length ? `Context tags they use (only use these, and only when clearly right): ${contexts.join(", ")}.` : "",
    "",
    "Rules:",
    "- Each to-do is ONE concrete next action. Start with a verb. Keep it under 80 characters and close to their own words.",
    '- Split compound thoughts: "call the supplier and order the tile" becomes two to-dos.',
    "- Leave out filler, repeats, feelings, and anything they say is already done.",
    '- "when" is the day they plan to do it; "due" is a real deadline. Resolve words like "Friday" or "next week" against today. Use YYYY-MM-DD or null.',
    '- "waitingOn": the person or company they are waiting on, only if the item is really out of their hands right now. Otherwise null.',
    '- "est": minutes, only if they said or clearly implied how long it takes. Otherwise null.',
    '- "phase": a short phase name (like "Demo" or "Install") only when the work clearly has stages; prefer existing phases. Otherwise null.',
    '- "note": a short detail that belongs with that one to-do (a measurement, a model number, a phone number). Otherwise null.',
    '- Put supplies or materials to buy in "materials" as short item names with any quantity or size they said (e.g. "2x4x8 studs (6)"). Do not also make a separate "buy materials" to-do.',
    '- Put useful facts that are not actions (prices, measurements, names, addresses, decisions, ideas, worries worth remembering) in "notes" as short lines.',
    "- Order the to-dos the way they would naturally be done.",
    '- If nothing in the ramble is actionable, return an empty "todos" list.',
    "",
    "Reply with only this JSON, no other text:",
    '{"todos":[{"title":"Measure the bathroom floor","when":null,"due":null,"contexts":[],"est":null,"waitingOn":null,"phase":null,"note":null}],"materials":["Thinset (2 bags)"],"notes":["Client wants it done before Thanksgiving"]}',
    "",
    "The ramble:",
    '"""',
    text.slice(0, 2e4),
    '"""'
  ].filter((x2) => x2 !== "").join("\n");
}
function normalizeSorted(raw, { contexts = [] } = {}) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { todos: Array.isArray(raw) ? raw : [] };
  const ctxSet = new Map(contexts.map((c3) => [c3.toLowerCase(), c3]));
  const t4 = today();
  const date = (v3) => typeof v3 === "string" && ISO.test(v3) && v3 >= addDays(t4, -1) ? v3 : null;
  const str = (v3, n3 = 300) => typeof v3 === "string" && v3.trim() ? v3.trim().slice(0, n3) : null;
  const seen = /* @__PURE__ */ new Set();
  const todos = (Array.isArray(obj.todos) ? obj.todos : []).map((x2) => {
    if (typeof x2 === "string") x2 = { title: x2 };
    if (!x2 || typeof x2 !== "object") return null;
    const title = str(x2.title, 140);
    if (!title) return null;
    const key2 = title.toLowerCase();
    if (seen.has(key2)) return null;
    seen.add(key2);
    const est = Number(x2.est);
    return {
      title: cap4(title.replace(/[.\s]+$/, "")),
      when: date(x2.when),
      due: date(x2.due),
      contexts: (Array.isArray(x2.contexts) ? x2.contexts : []).map((c3) => ctxSet.get(String(c3).toLowerCase()) || ctxSet.get("@" + String(c3).toLowerCase().replace(/^@/, ""))).filter(Boolean),
      est: Number.isFinite(est) && est > 0 && est <= 960 ? Math.round(est) : null,
      waitingOn: str(x2.waitingOn, 60),
      phase: str(x2.phase, 40),
      note: str(x2.note, 500)
    };
  }).filter(Boolean).slice(0, 60);
  const list = (v3, n3) => (Array.isArray(v3) ? v3 : typeof v3 === "string" ? v3.split("\n") : []).map((s3) => typeof s3 === "string" ? s3.replace(/^[-•*\s]+/, "").trim() : "").filter(Boolean).slice(0, n3);
  return { todos, materials: list(obj.materials, 60), notes: list(obj.notes, 40) };
}
var FILLER = /\b(um+|uh+|erm|you know|i mean|basically|kind of|sort of|like i said|okay so|ok so|so yeah|anyway|anyways)\b[,]?/gi;
var LEADS = [
  "i also need to",
  "i still need to",
  "i need to",
  "we need to",
  "need to",
  "i have to",
  "we have to",
  "have to",
  "i've got to",
  "i got to",
  "i gotta",
  "gotta",
  "i should",
  "we should",
  "should",
  "i want to",
  "i wanna",
  "i'll need to",
  "i'll",
  "i will",
  "we will",
  "let's",
  "remember to",
  "don't forget to",
  "dont forget to",
  "make sure to",
  "make sure i",
  "be sure to",
  "probably",
  "maybe",
  "then",
  "also",
  "and",
  "so",
  "first",
  "second",
  "next",
  "after that",
  "finally",
  "plus"
];
var VERBS = new Set(`call text email phone ask tell buy get grab pick order send schedule book fix replace install remove measure check finish start write read pay clean paint prime sand caulk
grout tile demo cut build hang move return plan research list sell post follow submit study review prepare prep set find make take bring drop load haul mow trim rake dig pour frame wire
plumb patch seal stain mount assemble repair inspect quote invoice confirm cancel renew update text print sign file organize sort pack ship deliver charge wash fill empty mail
reach rent borrow price compare choose decide talk meet visit drive cover tape mud level square shim glue screw nail drill tighten adjust test try clear vacuum sweep mop
rip tear pull lay spread plant water weed compact till rototill grade dig fill haul dump spray treat edge stake frame sheet insulate pressure power`.split(/\s+/));
var MATERIAL_LEAD = /^(?:buy|get|grab|pick up|order)\s+(?:some\s+|a\s+few\s+|more\s+|a\s+|an\s+|the\s+)?(.+)$/i;
var MATERIAL_WORDS = /\b(fabric|edging|pavers?|sod|rocks?|landscape|lights?|fixtures?|faucets?|valves?|screws?|nails?|bolts?|2x4s?|2x6s?|4x4s?|lumber|plywood|drywall|sheetrock|paint|primer|caulk|grout|thinset|mortar|tile|tiles|sandpaper|tape|glue|adhesive|pvc|pipe|fittings?|wire|outlets?|breakers?|hinges?|filters?|stain|concrete|gravel|sand|mulch|soil|seed|boards?|trim|shims?|anchors?|brackets?|studs?)\b/i;
function splitRamble(text, ctx = {}) {
  const clean2 = (text || "").replace(/\r/g, "").replace(FILLER, " ").replace(/[ \t]+/g, " ");
  const pieces = clean2.split(/(?:[.!?;\n]+\s*|\s+(?:and then|then i|and also|also|plus|after that|oh and|another thing is|another thing)\s+)/i).flatMap((p3) => p3.split(/,\s+(?=(?:and\s+)?(?:i\s+)?(?:need|have|gotta|should|call|buy|get|order|pick|schedule|text|email)\b)/i)).map((s3) => s3.trim()).filter(Boolean);
  const todos = [], notes = [], materials = [];
  const seen = /* @__PURE__ */ new Set();
  for (let p3 of pieces) {
    let actionish = false;
    let changed = true;
    while (changed) {
      changed = false;
      for (const l3 of LEADS) {
        const re = new RegExp("^" + l3.replace(/'/g, "['’]?") + "\\b[,]?\\s*", "i");
        if (re.test(p3)) {
          p3 = p3.replace(re, "");
          changed = true;
          if (!["then", "also", "and", "so", "first", "second", "next", "after that", "finally", "plus", "probably", "maybe"].includes(l3)) actionish = true;
        }
      }
    }
    p3 = p3.replace(/^(?:to|i)\s+/i, "").replace(/[,\s]+$/, "").trim();
    if (p3.split(/\s+/).length < 3 && !actionish) continue;
    p3 = p3.replace(/\bby\s+(?=(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|tonight|next|this|the\s+\d|end of|\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i, "due ");
    const first = p3.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    const m2 = p3.match(MATERIAL_LEAD);
    if (m2 && MATERIAL_WORDS.test(m2[1]) && m2[1].split(/\s+/).length <= 14) {
      materials.push(...m2[1].split(/\s*(?:,|\band\b)\s*/i).map((x2) => x2.trim()).filter(Boolean));
      continue;
    }
    if (actionish || VERBS.has(first)) {
      const parsed = parseQuickAdd(p3, ctx);
      const title = cap4((parsed.title || p3).replace(/\s+(?:by|on|before|due)$/i, "").slice(0, 120));
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      todos.push({
        title,
        when: parsed.fields.when || null,
        due: parsed.fields.due || null,
        contexts: parsed.fields.contexts || [],
        est: parsed.fields.est || null,
        waitingOn: null,
        phase: null,
        note: null
      });
    } else if (p3.length > 3) notes.push(cap4(p3));
  }
  return { todos, materials: [...new Set(materials.map((x2) => cap4(x2.replace(/^(?:some|a few|more|a|an|the)\s+/i, ""))))], notes };
}

export {
  ACCENTS,
  AREA_COLORS,
  AREA_ICONS,
  BUILTIN_TEMPLATES,
  DAY_MS,
  DEFAULT_CONTEXTS,
  DEFAULT_SETTINGS,
  END,
  EST,
  ESTIMATES,
  FILLER,
  GROCERY_CATS,
  ISO,
  LEADS,
  MATERIAL_LEAD,
  MATERIAL_WORDS,
  MONTHS,
  MONTH_ALIASES,
  MONTH_RE,
  MON_SHORT,
  NUM_RE,
  NUM_WORDS,
  ORD,
  ORD_RE,
  PROJECT_STATUSES,
  SEED_AREAS,
  TODS,
  TOD_RE,
  VERBS,
  WD_ALIASES,
  WD_RE,
  WD_SHORT,
  WEEKDAYS,
  activeProjects,
  addDays,
  addMonths,
  addYears,
  allTasks,
  areaList,
  areaOfTask,
  bestNow,
  byOrder,
  byToday,
  cap,
  cap4,
  compactForLogbook,
  completedBetween,
  csvForTasks,
  daysInMonth,
  describeRule,
  diffDays,
  endOfMonth,
  energyRank,
  esc,
  firstOnOrAfter,
  fmtMinutes,
  fmtTime,
  guessGroceryCat,
  homeOf,
  inline,
  isActionable,
  isDone,
  isGroceryItem,
  isInbox,
  isLastWeekdayOfMonth,
  isOffDay,
  isOpen,
  longLabel,
  matchDateAt,
  matchName,
  matchRepeatAt,
  matchTimeAt,
  matches,
  monthCandidate,
  monthDay,
  monthIndex,
  monthLabel,
  newTask,
  nextAction,
  nextAfter,
  nextInstanceDates,
  nextWeekday,
  nextWorkDay,
  norm,
  normalizeRule,
  normalizeSorted,
  now,
  nowHHMM,
  nthOfWeekdayInMonth,
  nthWeekdayOfMonth,
  num,
  occurrencesBetween,
  ordinal,
  pad,
  parseDuration,
  parseEstimate,
  parseQuickAdd,
  parseYmd,
  projectActive,
  projectStats,
  projectTasks,
  quietState,
  rambleprompt,
  relLabel,
  renderNotes,
  searchAll,
  selectAnytime,
  selectDay,
  selectInbox,
  selectLogbook,
  selectSomeday,
  selectToday,
  selectUpcoming,
  selectWaiting,
  setNow,
  sortProjectTasks,
  splitRamble,
  startOfMonth,
  startOfWeek,
  suggestForToday,
  timeAgo,
  todFromHour,
  todFromWord,
  today,
  toggleNoteLine,
  uid,
  upcomingBuckets,
  wdList,
  weekday,
  ymd
};
