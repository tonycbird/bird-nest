#!/usr/bin/env node
/* One-time move from Bird Budgeting to Nest (Phase 7): envelopes, plans, bills, store rules, paid marks
   and the sorting history (date, amount, envelope, short name: so each past purchase finds its bank twin).
     node claude/tools/money-setup.mjs <dir>                        → prints the setup as JSON
     node claude/tools/money-setup.mjs <dir> --with <summary.json>  → the money door's payload: the summary
                                                                       plus the setup, gzipped (setup_gz)
   <dir> is an ArtifactData out_dir dump of Bird Budgeting (read-only): categories, groups, budgets,
   recurring, labelRules, transactions and billMarks. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { gzipSync } from "node:zlib";
import { buildSetup } from "../../src/lib/money-core.js";

/** Anthony's calls on Bird Budgeting's bills, Oct 29 2026 (from its email review queue):
    one Chase bill, $85 on the 7th; Electric is Kootenai Electric, $90 on the 5th;
    State Farm auto insurance is $76.19 on the 30th (Honda's stays as it is). */
export function anthonysFixes(setup) {
  const bills = setup.bills.filter((b) => b.categoryId !== "chase-card");
  const chase = setup.bills.find((b) => b.categoryId === "chase-card");
  if (chase) bills.push({ ...chase, name: "Chase Prime Visa", amount: 85, dueDay: 7, cadence: "monthly" });
  for (const b of bills) {
    if (b.categoryId === "electric") Object.assign(b, { name: "Kootenai Electric", amount: 90, dueDay: 5 });
    if (b.id === "87qtx8cxmu2l3cn8dqk7") Object.assign(b, { name: "State Farm Auto", amount: 76.19, dueDay: 30 });
  }
  return { ...setup, bills };
}

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
  const setup = anthonysFixes(buildSetup(readBird(dir)));
  const wi = process.argv.indexOf("--with");
  if (wi > 0) {
    const summary = JSON.parse(readFileSync(process.argv[wi + 1], "utf8"));
    process.stdout.write(JSON.stringify({ ...summary, setup_gz: gzipSync(Buffer.from(JSON.stringify(setup)), { level: 9 }).toString("base64") }) + "\n");
  } else process.stdout.write(JSON.stringify(setup) + "\n");
}
