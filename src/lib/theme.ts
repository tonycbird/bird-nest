/* Follow the sun: Mist (light) from sunrise to sunset, Dusk (dark) the rest of the day.
   Sun times are worked out on the phone for Coeur d'Alene, so there's nothing to fetch. */

export type ThemeMode = "auto" | "light" | "dark";
const MODE_KEY = "nest:theme-mode";
const NOW_KEY = "nest:theme-now";
const LAT = 47.6777, LON = -116.7805;
const BG = { light: "#F4F5F8", dark: "#1B1E26" };

const rad = Math.PI / 180;
/** Sunrise and sunset (ms since epoch) for the calendar day that contains `d` (sunrise equation). */
export function sunTimes(d: Date = new Date(), lat = LAT, lon = LON): { rise: number; set: number } {
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 864e5 + 2440587.5;
  const n = Math.round(noon - 2451545.0 + 0.0008 + lon / 360); // the solar noon closest to this day's local noon
  const J = n - lon / 360;
  const M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545.0 + J + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  const toMs = (j: number) => (j - 2440587.5) * 864e5;
  return { rise: toMs(transit - w / 360), set: toMs(transit + w / 360) };
}

export function getMode(): ThemeMode {
  try { const m = localStorage.getItem(MODE_KEY); return m === "light" || m === "dark" ? m : "auto"; } catch { return "auto"; }
}

export function resolve(mode: ThemeMode = getMode(), now: Date = new Date()): "light" | "dark" {
  if (mode !== "auto") return mode;
  const { rise, set } = sunTimes(now);
  const t = now.getTime();
  return t >= rise && t < set ? "light" : "dark";
}

const subs = new Set<() => void>();
export function onTheme(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** Put the current look on the page, the Body frame, and the iPhone status bar. */
export function applyTheme() {
  const t = resolve();
  const el = document.documentElement;
  if (el.dataset.theme !== t) {
    el.dataset.theme = t;
    try { localStorage.setItem(NOW_KEY, t); } catch { /* storage blocked */ }
    subs.forEach((f) => f());
  }
  document.querySelectorAll<HTMLIFrameElement>("iframe.bodyframe").forEach((f) => {
    try { const d = f.contentDocument?.documentElement; if (d && d.dataset.theme !== t) d.dataset.theme = t; } catch { /* not loaded */ }
  });
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = BG[t]; m.removeAttribute("media"); });
}

export function setMode(m: ThemeMode) {
  try { if (m === "auto") localStorage.removeItem(MODE_KEY); else localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked */ }
  applyTheme();
  subs.forEach((f) => f());
}

export function installTheme() {
  applyTheme();
  window.setInterval(applyTheme, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) applyTheme(); });
}

/** "7:28" style local times, for Settings. */
export function sunLabel(now = new Date()): { rise: string; set: string } {
  const { rise, set } = sunTimes(now);
  const f = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  return { rise: f(rise), set: f(set) };
}
