// Bird Nest is an app, not a Claude artifact. Fail the build if artifact APIs sneak in.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BAD = [/window\.claude/, /\bsampleFn\b/, /window\.cowork/, /\bclaude\.sample\(/];
const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|html)$/.test(f)) {
      const t = readFileSync(p, "utf8");
      for (const re of BAD) if (re.test(t)) hits.push(`${p}: ${re}`);
    }
  }
}
walk("src");
if (hits.length) { console.error("Artifact APIs found:\n" + hits.join("\n")); process.exit(1); }
console.log("✓ no artifact APIs in src/");
