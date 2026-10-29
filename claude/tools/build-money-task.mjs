#!/usr/bin/env node
/* Builds claude/tasks/money.md from money.template.md with money.mjs inside it (and its sha256),
   so a scheduled run can write the script out and check it wasn't changed on the way.
     node claude/tools/build-money-task.mjs          → writes money.md
     node claude/tools/build-money-task.mjs --check  → exits 1 if money.md is out of date */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../../", import.meta.url).pathname;
const script = readFileSync(root + "claude/tools/money.mjs", "utf8").replace(/\n?$/, "\n");
const sha = createHash("sha256").update(script).digest("hex");
const out = readFileSync(root + "claude/tasks/money.template.md", "utf8").replace("@@SCRIPT@@\n", script).replace("@@SHA@@", sha);
const file = root + "claude/tasks/money.md";
if (process.argv.includes("--check")) {
  const ok = existsSync(file) && readFileSync(file, "utf8") === out;
  console.log(ok ? "money.md is up to date" : "money.md is out of date: run node claude/tools/build-money-task.mjs");
  process.exit(ok ? 0 : 1);
}
writeFileSync(file, out);
console.log("wrote claude/tasks/money.md · sha256 " + sha.slice(0, 12));
