import type { Kind } from "../lib/db";
import { ICONS, type IconName } from "./icons";
import { iconName } from "./glyphs";

/* One color per life area. A block or task takes the color of its icon's area. */

export const KIND_COLOR: Record<Kind, string> = { body: "var(--c-body)", head: "var(--c-head)", life: "var(--c-home)", money: "var(--c-money)" };
export const KIND_DEFAULT_ICON: Record<Kind, IconName> = { body: "lift", head: "head", life: "home", money: "coin" };

const GROUP: Record<string, string> = {
  body: "var(--c-body)", head: "var(--c-head)", money: "var(--c-money)", people: "var(--c-people)",
  home: "var(--c-home)", rest: "var(--c-rest)", cal: "var(--c-cal)",
};
const SPECIAL: Partial<Record<IconName, string>> = {
  warmup: "var(--c-warm)", stretch: "var(--c-stretch)", meal: "var(--c-home)", lift: "var(--c-body)", body: "var(--c-body)",
  head: "var(--c-head)", calendar: "var(--c-cal)",
};

export function colorFor(icon: IconName, kind?: Kind | null): string {
  if (SPECIAL[icon]) return SPECIAL[icon]!;
  const g = (ICONS as Record<string, { g: string }>)[icon]?.g;
  if (g && GROUP[g]) return GROUP[g];
  return kind ? KIND_COLOR[kind] : "var(--c-head)";
}

/** Icon + color for a River block (its saved icon may be a name or an old emoji). */
export function blockLook(b: { icon?: string | null; kind: Kind }): { icon: IconName; color: string } {
  const icon = iconName(b.icon, KIND_DEFAULT_ICON[b.kind]);
  return { icon, color: colorFor(icon, b.kind) };
}

/* A task's icon from its words, then its area's icon. */
const WORDS: [RegExp, IconName][] = [
  [/\b(call|phone|text|ring)\b/i, "call"],
  [/\b(pay|bill|invoice|rent|avista|insurance|tax|taxes)\b/i, "bill"],
  [/\b(budget|bank|deposit|money)\b/i, "coin"],
  [/\b(grocer|groceries|winco|costco|walmart|safeway|fred meyer|shopping|store)\b/i, "groceries"],
  [/\b(email|e-mail|mail|reply|respond)\b/i, "mail"],
  [/\b(quote|estimate|bid|proposal|contract)\b/i, "doc"],
  [/\b(fix|repair|install|replace|build|paint|patch|wire|wiring|hvac|plumb)/i, "job"],
  [/\b(study|read|class|chapter|theology|bible|homework|paper|exam)\b/i, "study"],
  [/\b(church|pray|prayer|sermon|ministry|kids)\b/i, "church"],
  [/\b(gym|workout|lift|run|walk)\b/i, "lift"],
  [/\b(stretch|yoga|mobility)\b/i, "stretch"],
  [/\b(meal|cook|dinner|lunch|breakfast|prep)\b/i, "meal"],
  [/\b(clean|laundry|dishes|yard|mow|trash|chores?)\b/i, "home"],
  [/\b(drive|pick up|drop off|errand|car|oil)\b/i, "drive"],
  [/\b(doctor|dentist|appointment|appt|meeting)\b/i, "calendar"],
  [/\b(dog|vet|walk the dog)\b/i, "paw"],
  [/\b(gift|birthday|anniversary)\b/i, "gift"],
  [/\b(abby|abigail|wife|date night|baby|kids?)\b/i, "heart"],
  [/\b(computer|laptop|app|website|code)\b/i, "laptop"],
];
export function taskIcon(title: string, areaIcon?: string | null): IconName {
  for (const [re, ic] of WORDS) if (re.test(title)) return ic;
  return iconName(areaIcon, "head");
}

/** A word or two to sit under a circle. The icon already says the verb ("Call", "Pay"), so the label names the thing. */
const VERB = /^(call|phone|text|pay|email|e-mail|reply to|reply|buy|get|order|send|write|fix|replace|install|ask|book|schedule|pick up|drop off|return|finish|review|clean|mow)\s+/i;
const SKIP = new Set(["the", "a", "an", "my", "to", "about", "for", "with", "&", "and", "on", "at", "of", "up"]);
export function shortLabel(title: string): string {
  const stripped = title.replace(VERB, "");
  const words = (stripped || title).replace(/[^\p{L}\p{N}\s'&-]/gu, " ").trim().split(/\s+/).filter((w) => !SKIP.has(w.toLowerCase()) && (w.length > 2 || /^\d+$/.test(w)));
  let out = words[0] ?? title;
  if (words[1] && /^\p{L}+$/u.test(words[1]) && (out + " " + words[1]).length <= 9) out += " " + words[1];
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return out.length > 11 ? out.slice(0, 10) + "…" : out;
}
