import { DEFAULT_TZ, dayKey } from "./dayKey";

/** "HH:MM" (24h) for right now in Anthony's time zone. */
export function nowHHMM(d: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

/** "17:30" → "5:30". The River shows short times; the am/pm is obvious from the order. */
export function shortTime(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}`;
}

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function addDays(key: string, n: number): string {
  const [y, mo, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n, 12));
  return t.toISOString().slice(0, 10); // safe: noon UTC on a pure calendar date, not "now"
}

export function today(tz: string = DEFAULT_TZ): string { return dayKey(new Date(), tz); }

/** "Wed · Oct 14" for a day key. */
export function keyLabel(key: string): string {
  const [y, mo, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 12));
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(t);
  const md = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(t);
  return `${wd} · ${md}`;
}
