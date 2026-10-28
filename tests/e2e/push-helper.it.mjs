// Integration test for the Nest push helper (worker/) running under `wrangler dev`.
// Not part of `npm test` (needs wrangler + http_ece, which aren't app dependencies). To run:
//   1. npm i wrangler http_ece in a scratch folder (W); make test-only VAPID keys into keys.json {pub, priv}
//   2. W/node_modules/.bin/wrangler dev -c <config like wrangler.jsonc, assets = any built dist> --port 8787
//        --var PUSH_DEV:1 --var VAPID_PUBLIC:<pub> --var VAPID_PRIVATE:<priv>
//   3. ECE_DIR=W/ KEYS=keys.json node tests/e2e/push-helper.it.mjs
// A fake push service on 127.0.0.1:9911 records what arrives; we decrypt it with http_ece (an
// independent implementation) and check the VAPID signature with node:crypto.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.ECE_DIR || "/tmp/claude-0/wr/");
const ece = require("http_ece");

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "/tmp/claude-0/wr/wtest/testkeys.json", "utf8"));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✓", m); } else { fail++; console.log("✗", m); } };

const got = [];
let mode = 201;
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { got.push({ t: Date.now(), path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(mode); res.end(); });
});
await new Promise((r) => srv.listen(9911, "127.0.0.1", r));

const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: "http://127.0.0.1:9911/push/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
const device = "dev_" + crypto.randomBytes(12).toString("base64url");
const key = crypto.randomBytes(32).toString("base64url");
const post = async (op, body = {}, k = key, d = device) => {
  const r = await fetch(`${BASE}/api/push/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: d, key: k, ...body }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decrypt = (b) => JSON.parse(ece.decrypt(b, { version: "aes128gcm", privateKey: ua, authSecret: sub.keys.auth }).toString("utf8"));
function checkVapid(h) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.authorization || "");
  if (!m) return "no vapid header";
  const [head, claims, sig] = m[1].split(".");
  if (m[2] !== keys.pub) return "wrong k";
  const pub = Buffer.from(keys.pub, "base64url");
  const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
  const good = crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key: crypto.createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
  const c = JSON.parse(Buffer.from(claims, "base64url").toString());
  if (!good) return "bad signature";
  if (c.aud !== "http://127.0.0.1:9911") return "bad aud " + c.aud;
  if (c.exp * 1000 < Date.now() || c.exp * 1000 > Date.now() + 3600e3) return "bad exp";
  if (!c.sub) return "no sub";
  return "ok";
}

try {
  const k = await (await fetch(`${BASE}/api/push/key`)).json();
  ok(k.key === keys.pub && k.ready === true, "/api/push/key gives the public key and ready");
  const home = await fetch(`${BASE}/today`);
  ok(home.status === 200 && (await home.text()).includes("<div id=\"root\""), "other paths still open the app");

  ok((await post("schedule", { items: [] })).status === 404, "schedule before subscribe → not set up");
  ok((await post("subscribe", { sub: { ...sub, endpoint: "https://evil.example.com/x" } })).status === 400, "a non-push address is refused");
  ok((await post("subscribe", { sub })).status === 200, "subscribe");
  ok((await post("status", {}, crypto.randomBytes(32).toString("base64url"))).status === 403, "another key can't use this phone's helper");
  ok((await post("subscribe", { sub }, "short")).status === 400, "a bad key shape is refused");

  // test push now
  const t0 = Date.now();
  const tr = await post("test");
  ok(tr.status === 200 && tr.body.ok, "test push sent");
  await sleep(300);
  const m1 = got.shift();
  ok(m1 && m1.path === "/push/abc", "test push arrived");
  if (m1) {
    ok(m1.headers["content-encoding"] === "aes128gcm" && m1.headers.ttl && m1.headers.urgency === "high", "push headers");
    ok(checkVapid(m1.headers) === "ok", "VAPID signature checks out: " + checkVapid(m1.headers));
    const msg = decrypt(m1.body);
    ok(msg.title === "Nest" && msg.body === "Buzzing works.", "test push decrypts (http_ece)");
  }

  // scheduled push lands on time
  const at = Date.now() + 3000;
  const s1 = await post("schedule", { items: [{ id: "rest", at, title: "Rest done — go", body: "Next set.", tag: "rest", ttl: 60 }] });
  ok(s1.status === 200 && s1.body.count === 1 && s1.body.next === at, "schedule rest");
  await sleep(4500);
  const m2 = got.shift();
  ok(!!m2, "rest buzz arrived");
  if (m2) {
    const late = m2.t - at;
    ok(late >= -50 && late < 1200, `rest buzz on time (${late} ms late)`);
    const msg = decrypt(m2.body);
    ok(msg.title === "Rest done — go" && msg.tag === "rest", "rest buzz content");
  }

  // re-schedule the same id moves it; cancel stops it
  await post("schedule", { items: [{ id: "rest", at: Date.now() + 2000, title: "Rest done — go" }] });
  await post("schedule", { items: [{ id: "rest", at: Date.now() + 2500, title: "Rest done — go (moved)" }] });
  const st = await post("status");
  ok(st.body.count === 1, "same id replaces, not duplicates");
  await sleep(3200);
  const m3 = got.shift();
  ok(m3 && decrypt(m3.body).title === "Rest done — go (moved)" && got.length === 0, "moved buzz arrives once");

  await post("schedule", { items: [{ id: "rest", at: Date.now() + 1500, title: "Should not arrive" }] });
  const c = await post("cancel", { ids: ["rest"] });
  ok(c.body.count === 0, "cancel");
  await sleep(2200);
  ok(got.length === 0, "cancelled buzz never arrives");

  // replace by prefix (a week of shutdown reminders)
  const day = 864e5;
  await post("schedule", { replace: "shutdown:", items: [1, 2, 3].map((n) => ({ id: `shutdown:${n}`, at: Date.now() + n * day, title: "Shutdown" })) });
  const r2 = await post("schedule", { replace: "shutdown:", items: [4, 5].map((n) => ({ id: `shutdown:${n}`, at: Date.now() + n * day, title: "Shutdown" })) });
  ok(r2.body.count === 2, "replace clears the old week");
  const bad = await post("schedule", { items: [{ id: "far", at: Date.now() + 30 * day, title: "x" }, { id: "past", at: Date.now() - 10 * 60e3, title: "x" }, { id: "", at: Date.now() + 5000, title: "x" }] });
  ok(bad.body.count === 2, "far-future, long-past and blank items are ignored");

  // a dead address (410) is dropped
  await post("cancel", { prefix: "shutdown:" });
  mode = 410;
  await post("schedule", { items: [{ id: "x", at: Date.now() + 1000, title: "x" }] });
  await sleep(1800);
  got.length = 0;
  const st2 = await post("status");
  ok(st2.body.subscribed === false && st2.body.count === 0, "410 from the push service drops the address");
  mode = 201;

  ok((await post("off")).status === 200, "off");
  ok((await post("status")).status === 404, "after off, nothing is left");
  // after off, the device can set up again (any key)
  ok((await post("subscribe", { sub }, crypto.randomBytes(32).toString("base64url"))).status === 200, "set up again after off");
} catch (e) {
  fail++; console.log("✗ crashed:", e);
}
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
