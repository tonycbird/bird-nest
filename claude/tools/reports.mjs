#!/usr/bin/env node
/* Claude's tool for Testing mode reports.
     node claude/tools/reports.mjs list [open|fixed|later|all]     → prints the reports
     node claude/tools/reports.mjs pull <outDir>                    → saves each open report (json, screen html, photo)
     node claude/tools/reports.mjs mark <id> <fixed|later|open> "what changed"
   Reads the public URL + key from .env.production and the door key from .env.gateway-token (gitignored). Never prints the key. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Behind a proxy (Claude's cloud), Node's fetch needs NODE_USE_ENV_PROXY=1: run again with it.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const root = new URL("../../", import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(join(root, ".env.production"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const raw = readFileSync(join(root, ".env.gateway-token"), "utf8").trim();
const token = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1).trim() : raw;

async function call(action, args = {}) {
  const r = await fetch(env.VITE_SUPABASE_URL + "/rest/v1/rpc/nest_reports", {
    method: "POST",
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ token, action, args }),
  });
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
}

const [cmd = "list", a, b, c] = process.argv.slice(2);
if (cmd === "list") {
  const { items } = await call("list", { status: a || "open" });
  for (const r of items) {
    const x = r.ctx || {};
    console.log(`\n[${r.kind}] ${r.text || "(no words)"}  · ${r.status}\n  id ${r.id} · ${r.created_at}\n  where: ${x.tab}${x.overlay ? " › " + x.overlay : ""}${(x.open || []).length ? " › " + x.open.join(" / ") : ""} · ${x.look} · ${x.version} · ${x.size}`);
    if ((r.errors || []).length) console.log("  errors: " + r.errors.map((e) => e.msg).join(" | ").slice(0, 400));
    if ((r.trail || []).length) console.log("  taps: " + r.trail.map((t) => t.what).join(" → ").slice(0, 400));
    console.log(`  photo: ${r.has_photo ? "yes" : "no"} · screen: ${r.has_dom ? "yes" : "no"}`);
  }
  console.log(`\n${items.length} report(s)`);
} else if (cmd === "pull") {
  const out = a || "reports";
  mkdirSync(out, { recursive: true });
  const { items } = await call("list", { status: b || "open", full: true });
  for (const r of items) {
    const { dom, frame_dom, photo, ...rest } = r;
    writeFileSync(join(out, r.id + ".json"), JSON.stringify(rest, null, 2));
    if (dom) writeFileSync(join(out, r.id + ".screen.html"), dom);
    if (frame_dom) writeFileSync(join(out, r.id + ".body.html"), frame_dom);
    if (photo) writeFileSync(join(out, r.id + ".jpg"), Buffer.from(photo.split(",")[1] || "", "base64"));
  }
  console.log(`${items.length} report(s) saved to ${out}`);
} else if (cmd === "mark") {
  console.log(await call("mark", { items: [{ id: a, status: b || "fixed", note: c || "" }] }));
} else {
  console.log("list | pull <dir> | mark <id> <status> <note>");
}
