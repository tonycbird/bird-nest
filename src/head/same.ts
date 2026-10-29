/* "Is this already on the list?" — loose enough for "Rent the sod cutter" vs "Rent sod cutter",
   strict enough that "Buy materials" for one job isn't "Buy materials" for another (callers compare within a project). */
const SKIP = new Set(["a", "an", "the", "my", "our", "some", "to", "for", "of", "and", "at", "on", "in", "with", "from", "up", "out", "please"]);

export function normTitle(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w && !SKIP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/ies$/, "y").replace(/(?<!s)s$/, "") : w))
    .join(" ");
}

export function sameTask(a: string, b: string): boolean {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  const both = [...A].filter((w) => B.has(w)).length;
  return Math.min(A.size, B.size) >= 2 && both / new Set([...A, ...B]).size >= 0.8;
}
