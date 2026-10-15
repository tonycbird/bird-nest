import { useLiveQuery } from "dexie-react-hooks";
import { db, nowISO } from "./db";

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value, updated_at: nowISO() });
}
export function useSetting<T>(key: string, fallback: T): T {
  return useLiveQuery(async () => ((await db.settings.get(key))?.value as T | undefined) ?? fallback, [key], fallback);
}
