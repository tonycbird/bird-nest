#!/usr/bin/env node
/* One-time move from Bird Budgeting to Nest (Phase 7): envelopes, plans, bills and store rules.
     node claude/tools/money-setup.mjs <dir>   → prints the setup as JSON
   <dir> is an ArtifactData out_dir dump of Bird Budgeting (read-only): categories, groups, budgets,
   recurring, labelRules, transactions (to learn store rules; none are copied) and billMarks. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { buildSetup } from "../../src/lib/money-core.js";

function read(dir, col) {
  const p = join(dir, col);
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((f) => f.endsWith(".json")).map((f) => {
    const raw = JSON.parse(readFileSync(join(p, f), "utf8"));
    const doc = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) && raw.version ? raw.data : raw;
    return { ...doc, id: basename(f, ".json") };
  });
}
export function readBird(dir) {
  const r = (c) => read(dir, c);
  return { categories: r("categories"), groups: r("groups"), budgets: r("budgets"), recurring: r("recurring"), labelRules: r("labelRules"), transactions: r("transactions"), billMarks: r("billMarks") };
}
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node money-setup.mjs <dir>"); process.exit(2); }
  process.stdout.write(JSON.stringify(buildSetup(readBird(dir))) + "\n");
}
