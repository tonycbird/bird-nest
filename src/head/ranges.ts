/* "Dance rehearsal tonight 6-7": a time range is a start time and a length.
   Clearhead's parser (kept exactly as it was, see tests/clearhead-parity.test.ts) reads "6pm" but not "6-7",
   so Nest finds the range first, hides it from the parser (same length, so the colored marks still line up),
   and adds the time and the length itself. */
import * as C from "./core/clearhead.js";
import type { ParseToken } from "./core/clearhead.js";

const RANGE = /(?<![\w:/.$-])(?:from\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?(?![\w:/.%-])/i;
/* A bare "6-7" could be a count ("6-7 bags"); it's a time only with am/pm, a colon, or a day word nearby. */
const DAYISH = /\b(tonight|today|tomorrow|this (?:morning|afternoon|evening)|morning|afternoon|evening|from|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

export interface Range { start: number; end: number; from: string; to: string; mins: number; label: string }
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const isPm = (x?: string) => !!x && /^p/i.test(x);
const short = (m: number) => { const h = Math.floor(m / 60) % 24, mi = m % 60; return `${((h + 11) % 12) + 1}${mi ? ":" + pad(mi) : ""}`; };

export function findRange(text: string): Range | null {
  const m = RANGE.exec(text);
  if (!m) return null;
  const [all, h1s, m1s, a1, h2s, m2s, a2] = m;
  if (!a1 && !a2 && !m1s && !m2s && !DAYISH.test(text)) return null;
  const h1 = +h1s, h2 = +h2s;
  const m1 = +(m1s ?? 0), m2 = +(m2s ?? 0);
  if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12) return null;
  const evening = /\b(tonight|evening|afternoon)\b/i.test(text);
  const to24 = (h: number, pm: boolean) => (pm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h);
  // "6-7pm" → both pm; "11-1pm" → 11 am to 1 pm; "9-10am" → both am; bare "6-7" → pm tonight or for 1–6 o'clock.
  const pm1 = a1 ? isPm(a1) : a2 ? isPm(a2) && !(h1 > h2 && h1 !== 12) : evening || h1 === 12 || h1 <= 6;
  const s = to24(h1, pm1) * 60 + m1;
  let e = to24(h2, a2 ? isPm(a2) : pm1) * 60 + m2;
  if (e <= s) e += 12 * 60;
  if (e <= s || e - s > 12 * 60 || e > 24 * 60) return null;
  const start = m.index + (all.length - all.trimStart().length);
  return { start, end: m.index + all.length, from: hm(s), to: hm(e), mins: e - s, label: `${short(s)}–${short(e)}${e >= 12 * 60 ? "pm" : "am"}` };
}

/* "30 min", "for an hour", "1.5 hours", "half an hour": how long, said in words (Clearhead wants "~30m").
   "in 2 hours", "every 3 hours" say when, not how long. */
const LONG = /(?<![\w~])(?<!\b(?:in|within|after|every|each|last|past|next)\s+)(?:for\s+)?(?:(an?|one|1)\s+hour|half\s+an?\s+hour|(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)|(\d{1,3})\s*(?:minutes?|mins?|m))(?![\w])/i;
export function findLength(text: string): { start: number; end: number; mins: number } | null {
  const m = LONG.exec(text);
  if (!m) return null;
  const mins = m[1] ? 60 : /half/i.test(m[0]) ? 30 : m[2] ? Math.round(parseFloat(m[2]) * 60) : +m[3];
  if (!(mins >= 5 && mins <= 8 * 60)) return null;
  return { start: m.index, end: m.index + m[0].length, mins };
}

type Parsed = ReturnType<typeof C.parseQuickAdd>;
const hide = (t: string, a: number, b: number) => t.slice(0, a) + " ".repeat(b - a) + t.slice(b);
/** Quick add, with "6-7", "6–7pm", "6pm-7pm", "9:30 to 11" read as a start time and a length,
    and "30 min" / "for an hour" as a length. */
export function parseQuick(text: string, ctx?: unknown): Parsed {
  const r = findRange(text);
  let masked = r ? hide(text, r.start, r.end) : text;
  const l = findLength(masked);
  if (l) masked = hide(masked, l.start, l.end);
  if (!r && !l) return C.parseQuickAdd(text, ctx);
  const out = C.parseQuickAdd(masked, ctx);
  const fields = { ...out.fields };
  const tokens = [...out.tokens];
  if (r) {
    Object.assign(fields, { time: r.from, est: fields.est ?? r.mins, tod: fields.tod ?? (r.from >= "17:00" ? "evening" : r.from >= "12:00" ? "afternoon" : "morning") });
    tokens.splice(0, tokens.length, ...tokens.filter((t) => t.type !== "time"));
    tokens.push({ type: "time", start: r.start, end: r.end, raw: text.slice(r.start, r.end), label: r.label, value: r.from } as ParseToken);
  }
  if (l && fields.est == null) {
    fields.est = l.mins;
    tokens.push({ type: "estimate", start: l.start, end: l.end, raw: text.slice(l.start, l.end), label: l.mins % 60 ? `${l.mins}m` : `${l.mins / 60}h`, value: l.mins, symbol: true } as ParseToken);
  }
  return { title: out.title.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim(), fields, tokens: tokens.sort((a, b) => a.start - b.start) };
}
