import { db as defaultDb, nowISO, TABLES, type NestDB } from "./db";

/* One-tap JSON backup and restore. While Bird Nest is phone-only, this file is the only copy
   of Anthony's data outside the phone — Settings nudges when the last backup is old. */

export interface Backup {
  app: "bird-nest";
  version: 1;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(db: NestDB = defaultDb): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  return { app: "bird-nest", version: 1, exported_at: nowISO(), tables };
}

export function counts(b: Backup): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of TABLES) c[t] = (b.tables[t] ?? []).length;
  return c;
}

export function validate(x: unknown): Backup {
  const b = x as Backup;
  if (!b || b.app !== "bird-nest" || b.version !== 1 || typeof b.tables !== "object") {
    throw new Error("That file isn't a Bird Nest backup.");
  }
  for (const t of TABLES) if (b.tables[t] && !Array.isArray(b.tables[t])) throw new Error(`Backup table ${t} is broken.`);
  return b;
}

/** Replace everything on this device with the backup. A safety copy of the current data is returned first. */
export async function restoreAll(b: Backup, db: NestDB = defaultDb): Promise<Backup> {
  const safety = await exportAll(db);
  await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      // A table the backup doesn't have (an older backup, before Body) is left as it is.
      if (!b.tables[t]) continue;
      await db.table(t).clear();
      const rows = b.tables[t];
      if (rows.length) await db.table(t).bulkPut(rows);
    }
  });
  return safety;
}

export async function markBackedUp(db: NestDB = defaultDb): Promise<void> {
  await db.settings.put({ key: "last_backup", value: nowISO(), updated_at: nowISO() });
}

export function download(b: Backup): void {
  saveJSON(b, `bird-nest-backup-${b.exported_at.slice(0, 10)}.json`);
}

export function saveJSON(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string): void {
  const file = new File([blob], name, { type: blob.type });
  // iPhone: the share sheet lets Anthony save to Files or iCloud Drive.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) { void navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
