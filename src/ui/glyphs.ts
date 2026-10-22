import { ICONS, type IconName } from "./icons";

/* Old emoji (in saved blocks, Claude's plans, area icons, toasts) map to Nest icons. */
export const EMOJI: Record<string, IconName> = {
  "✓": "tick", "✔": "tick", "✅": "check", "☑": "select", "☐": "select", "✕": "close", "✖": "close",
  "→": "arrow", "➤": "arrow", "↪": "arrow", "⤼": "skip", "↻": "refresh", "🔁": "swap", "⇄": "swap", "↺": "undo",
  "⬆": "upload", "⬇": "download", "＋": "plus", "⋯": "more", "…": "more", "‹": "chevL", "›": "chevR", "▶": "play",
  "⏸": "pause", "ⓘ": "info", "⚙": "settings", "⎋": "signout", "🔑": "key", "🔍": "search", "☁": "sync", "📶": "sync",
  "☀": "today", "🌅": "morning", "🌙": "sleep", "💤": "sleep", "🛏": "sleep", "🛋": "weekend", "🏡": "home", "☕": "pause", "📆": "calendar", "🧺": "groceries", "⏻": "shutdown", "🔕": "quiet", "📵": "quiet", "🧭": "compass",
  "🧠": "head", "📥": "inbox", "⭐": "star", "📅": "calendar", "🗓": "calendar", "🗂": "layers", "📁": "project", "▣": "project",
  "⏳": "waiting", "✦": "sort", "🗣": "talk", "💬": "talk", "🎙": "mic", "📷": "camera", "✏": "edit", "✎": "edit", "📋": "copy",
  "⚑": "flag", "🚩": "flag", "🎯": "target", "⚡": "bolt", "🔋": "bolt", "⏱": "timer", "⏰": "later", "🕓": "later", "🕘": "later",
  "⚠": "warn", "🗑": "trash", "🔨": "job", "🔧": "job", "🧰": "box", "📦": "box", "🏪": "box", "💼": "briefcase", "💻": "laptop", "📱": "laptop",
  "💡": "idea", "📖": "study", "🎓": "study", "⛪": "church", "🙏": "church",
  "🏋": "lift", "🧘": "stretch", "🔥": "warmup", "🍽": "meal", "🍴": "meal", "🥗": "meal", "🎫": "barcode", "🫀": "heart",
  "🛒": "groceries", "🏠": "home", "🧹": "home", "🖌": "home", "🚗": "drive", "📍": "place", "✈": "place", "🌲": "leaf", "🌱": "leaf", "🍃": "leaf",
  "🎁": "gift", "🎂": "gift", "🐕": "paw", "🐶": "paw", "❤": "heart", "♡": "heart", "👶": "heart", "🎵": "heart",
  "💵": "coin", "💲": "coin", "🐷": "coin", "💰": "coin", "🧾": "bill",
  "📞": "call", "👤": "person", "👋": "claude", "📧": "mail", "✉": "mail",
  "🌊": "river", "🪺": "nest", "✂": "edit", "🔺": "chevU", "🔻": "chevD", "📒": "doc", "📄": "doc", "💾": "download", "🏷": "dot", "•": "dot", "⧉": "copy", "▫": "dot", "◦": "dot", "⚙︎": "settings",
};

/* Typographic marks stay as text inside sentences. */
const KEEP_INLINE = new Set(["•", "…", "→", "‹", "›", "＋"]);
const KEYS = Object.keys(EMOJI).filter((k) => !KEEP_INLINE.has(k)).sort((a, b) => b.length - a.length);
const RE = new RegExp("(" + KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\uFE0F?", "gu");

/** The Nest icon name for a stored icon value: an icon name already, an old emoji, or a fallback. */
export function iconName(v: string | null | undefined, fallback: IconName = "dot"): IconName {
  if (!v) return fallback;
  const s = v.replace(/\uFE0F/g, "").trim();
  if (s in ICONS) return s as IconName;
  return EMOJI[s] ?? EMOJI[[...s][0] ?? ""] ?? fallback;
}

/** Split text into plain parts and icon names (odd indexes are icon names). Null if there's nothing to swap. */
export function splitGlyphs(s: string): string[] | null {
  RE.lastIndex = 0;
  if (!RE.test(s)) return null;
  RE.lastIndex = 0;
  return s.split(RE).map((p, i) => (i % 2 === 1 ? EMOJI[p] ?? "dot" : p));
}
