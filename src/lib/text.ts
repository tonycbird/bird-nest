/* Text helpers that keep strings safe for the cloud copy.
   A string cut in the middle of an emoji leaves half a character behind, and Postgres rejects it
   (along with \u0000) — which used to stop every row after it from syncing. */

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Like s.slice(0, n), but never splits an emoji. */
export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  let t = s.slice(0, n);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** Replace half-characters and drop NUL, which the cloud can't store. */
export function wellFormed(s: string): string {
  return s.replace(LONE, "�").replace(/\u0000/g, "");
}

/** wellFormed() for every string inside a value (objects and arrays included). */
export function cleanDeep<T>(v: T): T {
  if (typeof v === "string") return wellFormed(v) as unknown as T;
  if (Array.isArray(v)) return v.map(cleanDeep) as unknown as T;
  if (v && typeof v === "object" && !(v instanceof Blob) && !(v instanceof Date)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[wellFormed(k)] = cleanDeep(x);
    return o as T;
  }
  return v;
}
