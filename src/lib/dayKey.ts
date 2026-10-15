/**
 * A day in Bird Nest is a text key, YYYY-MM-DD, in Anthony's time zone.
 * Never use toISOString() for a day: it is UTC and moves a 9 PM workout to tomorrow.
 */
export const DEFAULT_TZ = "America/Los_Angeles";

export function dayKey(d: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Wed · Oct 14" for the top of Today. */
export function dayLabel(d: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const md = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
  return `${wd} · ${md}`;
}
