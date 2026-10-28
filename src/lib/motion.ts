/* Small motion helpers (Phase 5). A check only "pops" right after you tap it, never when a list
   simply draws things that were already done. */
const recent = new Map<string, number>();
export function markJustDone(id: string): void { recent.set(id, Date.now()); }
export function justDone(id: string): boolean { const t = recent.get(id); return !!t && Date.now() - t < 1500; }
