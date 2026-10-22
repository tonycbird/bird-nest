/* One at a time: a second tap on a slow button (Create, Put away, Start my day) while the first is still
   saving does nothing, instead of adding everything twice. */
const running = new Set<string>();

export async function once<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (running.has(key)) return undefined;
  running.add(key);
  try { return await fn(); } finally { running.delete(key); }
}
