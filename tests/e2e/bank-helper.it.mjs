// Integration test for the bank part of the Nest helper (worker/bank.ts) under `wrangler dev`.
// Not part of `npm test` (needs wrangler). A fake Plaid + fake Supabase auth listen on 127.0.0.1:9922.
// To run (W = a scratch folder with wrangler installed):
//   W/node_modules/.bin/wrangler dev -c <config like wrangler.jsonc, with run_worker_first ["/api/*", "/__scheduled"]> --port 8788 --test-scheduled \
//     --var PLAID_DEV_BASE:http://127.0.0.1:9922 --var SUPABASE_URL:http://127.0.0.1:9922 --var SUPABASE_KEY:pub \
//     --var PLAID_CLIENT_ID:cid --var PLAID_SANDBOX_SECRET:sb-secret --var PLAID_SECRET:prod-secret
//   BASE=http://127.0.0.1:8788 node tests/e2e/bank-helper.it.mjs
import http from "node:http";

const BASE = process.env.BASE || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✓", m); } else { fail++; console.log("✗", m); } };

const ME = "good-token-anthony-0123456789abcdef", STRANGER = "other-token-stranger-0123456789abcd";
const calls = [];
let syncMode = "normal", mutateOnce = true, exchanges = 0;
const acct = [
  { account_id: "acc_chk", name: "Joint Checking", mask: "0707", type: "depository", subtype: "checking", balances: { current: 1523.11, available: 1490.02 } },
  { account_id: "acc_visa", name: "Visa Platinum", mask: "4410", type: "credit", subtype: "credit card", balances: { current: 812.4, available: null } },
];
const t = (id, amount, date, extra = {}) => ({ transaction_id: id, account_id: "acc_chk", amount, date, name: "NAME " + id, merchant_name: "Shop " + id, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" }, ...extra });

function plaid(path, body) {
  if (path === "/link/token/create") return [200, { link_token: `link-${body.secret === "prod-secret" ? "production" : "sandbox"}-${calls.length}` }];
  if (path === "/item/public_token/exchange") { exchanges++; return [200, { access_token: `access-x-${exchanges}`, item_id: `item${exchanges}` }]; }
  if (path === "/transactions/refresh" || path === "/item/remove") return [200, {}];
  if (path === "/transactions/sync") {
    if (syncMode === "login") return [400, { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details of this item have changed" }];
    const c = body.cursor || "";
    if (body.access_token !== "access-x-1") return [200, { added: [], modified: [], removed: [], next_cursor: "z", has_more: false, accounts: [] }];
    if (c === "") return [200, { added: [t("t1", 12.5, "2026-10-27"), t("t2", -1976.52, "2026-10-16", { name: "PAYROLL", merchant_name: null, personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" } })], modified: [], removed: [], next_cursor: "c1", has_more: true, accounts: acct }];
    if (c === "c1") {
      if (mutateOnce) { mutateOnce = false; return [400, { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "try again" }]; }
      return [200, { added: [t("t3", 48.21, "2026-10-28", { pending: true })], modified: [], removed: [], next_cursor: "c2", has_more: false, accounts: acct, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" }];
    }
    if (c === "c2") return [200, { added: [t("t4", 48.21, "2026-10-29", { pending_transaction_id: "t3" })], modified: [t("t1", 13.75, "2026-10-27")], removed: [{ transaction_id: "t3" }], next_cursor: "c3", has_more: false, accounts: acct }];
    return [200, { added: [], modified: [], removed: [], next_cursor: c, has_more: false, accounts: acct }];
  }
  return [404, { error_code: "NOT_FOUND" }];
}

const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (x) => chunks.push(x));
  req.on("end", () => {
    const send = (s, v) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (req.url === "/auth/v1/user") {
      const a = req.headers.authorization || "";
      if (req.headers.apikey !== "pub") return send(401, {});
      if (a === "Bearer " + ME) return send(200, { id: "u-anthony", email: "a@x" });
      if (a === "Bearer " + STRANGER) return send(200, { id: "u-stranger", email: "s@x" });
      return send(401, { msg: "bad jwt" });
    }
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    calls.push({ path: req.url, body });
    if (body.client_id !== "cid" || !["sb-secret", "prod-secret"].includes(body.secret)) return send(400, { error_code: "INVALID_API_KEYS" });
    const [s, v] = plaid(req.url, body);
    send(s, v);
  });
});
await new Promise((r) => srv.listen(9922, "127.0.0.1", r));

const seenBodies = [];
const call = async (op, body = {}, token = ME) => {
  const r = await fetch(`${BASE}/api/bank/${op}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  seenBodies.push(text);
  return { status: r.status, body: JSON.parse(text || "null") };
};
const last = (path) => [...calls].reverse().find((c) => c.path === path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let r = await call("status", {}, null);
  ok(r.status === 401 && r.body.why === "SIGN_IN", "no session → 401");
  r = await call("status", {}, "not-a-real-token-xxxxxxxxxxxxxxxx");
  ok(r.status === 401, "a token Supabase doesn't know → 401");
  r = await call("status");
  ok(r.status === 200 && r.body.keys_sandbox === true && r.body.keys_production === true && r.body.items.length === 0 && r.body.count === 0, "status: keys there, nothing linked yet");
  r = await call("status", {}, STRANGER);
  ok(r.status === 403 && r.body.why === "NOT_YOURS", "another account is turned away (first account owns the bank)");
  r = await (await fetch(`${BASE}/api/bank/status`)).json().catch(() => null);
  ok(r && r.error === "POST only", "GET → POST only");

  r = await call("link", { env: "sandbox" });
  const lt = last("/link/token/create");
  ok(r.status === 200 && /^link-sandbox-/.test(r.body.link_token), "practice link token");
  ok(lt.body.secret === "sb-secret" && lt.body.products?.[0] === "transactions" && lt.body.transactions?.days_requested === 730 && lt.body.user?.client_user_id === "nest-owner" && !lt.body.access_token, "asks Plaid for transactions, 2 years back, with the sandbox key");

  r = await call("exchange", { env: "sandbox", public_token: "nope", institution: { id: "ins_1", name: "First Platypus Bank" } });
  ok(r.status === 400 && r.body.why === "BAD_TOKEN", "a junk public token is refused");
  r = await call("exchange", { env: "sandbox", public_token: "public-sandbox-abc-123", institution: { id: "ins_1", name: "First Platypus Bank" } });
  ok(r.status === 200 && r.body.items.length === 1 && r.body.items[0].inst_name === "First Platypus Bank" && r.body.items[0].status === "ok", "exchange: one practice link, status ok");
  ok(r.body.count === 3 && r.body.newest === "2026-10-28", "first pull: 3 transactions across 2 pages (and a restart after Plaid said the data moved)");
  ok(r.body.accounts.length === 2 && r.body.accounts.find((a) => a.mask === "0707")?.current === 1523.11, "accounts and balances saved");
  ok(r.body.prod_used === 0, "a practice link doesn't use one of the 10");
  ok(calls.filter((c) => c.path === "/transactions/sync" && c.body.cursor === "c1").length === 2, "the page that failed mid-way was fetched again");

  r = await call("changes", { since: 0 });
  const rows = r.body.rows;
  const t1 = rows.find((x) => x.id === "t1"), t2 = rows.find((x) => x.id === "t2"), t3 = rows.find((x) => x.id === "t3");
  ok(rows.length === 3 && t1.amount === -12.5 && t2.amount === 1976.52, "sign flipped: spending negative, payroll positive");
  ok(t1.merchant === "Shop t1" && t1.hint === "FOOD_AND_DRINK_GROCERIES" && t3.pending === 1 && t2.merchant === "", "merchant, category hint and pending kept");
  const seq1 = r.body.seq;
  ok(seq1 >= 3 && r.body.more === false, "changes: sequence number to ask from next time");
  r = await call("changes", { since: seq1 });
  ok(r.body.rows.length === 0 && r.body.seq === seq1, "nothing new since then");

  r = await call("pull");
  ok(!!last("/transactions/refresh") && r.body.count === 3, "pull now: asks Plaid to check the bank, then syncs");
  r = await call("changes", { since: seq1 });
  const ch = Object.fromEntries(r.body.rows.map((x) => [x.id, x]));
  ok(ch.t1?.amount === -13.75 && ch.t3?.removed === 1 && ch.t4?.amount === -48.21 && ch.t4.pending === 0 && ch.t4.pending_id === "t3", "changes: edited, removed (pending → posted) and new rows");

  syncMode = "login";
  r = await call("pull");
  ok(r.body.items[0].status === "login" && r.body.items[0].error === "ITEM_LOGIN_REQUIRED", "bank wants a fresh sign-in → status login");
  r = await call("link", { item_id: "item1" });
  const up = last("/link/token/create");
  ok(r.status === 200 && up.body.access_token === "access-x-1" && !up.body.products, "reconnect uses update mode (same link, not a new one)");
  syncMode = "normal";
  r = await call("relinked", { item_id: "item1" });
  ok(r.body.items[0].status === "ok", "after signing in again: back to ok");

  r = await call("link", { env: "production" });
  ok(r.status === 200 && last("/link/token/create").body.secret === "prod-secret" && r.body.prod_used === 0, "real link token uses the production key");
  for (let i = 0; i < 10; i++) await call("exchange", { env: "production", public_token: `public-production-p${i}`, institution: { id: "ins_iccu", name: "ICCU" } });
  r = await call("status");
  ok(r.body.prod_used === 10, "each real link is counted");
  r = await call("link", { env: "production" });
  ok(r.status === 409 && r.body.why === "LINK_LIMIT", "the 11th real link is refused before Plaid is asked");
  r = await call("remove", { item_id: "item2" });
  ok(r.status === 409 && r.body.why === "REAL_LINK", "a real link can't be removed from the app");
  r = await call("remove", { item_id: "item1" });
  ok(r.status === 200 && !r.body.items.find((i) => i.item_id === "item1") && r.body.count === 0, "the practice link can be removed");
  r = await call("changes", { since: 0 });
  ok(r.body.rows.filter((x) => x.item_id === "item1").every((x) => x.removed === 1), "its transactions come down as removed");

  const before = (await call("status")).body.last_run;
  await sleep(1100);
  // wrangler dev --test-scheduled runs the cron handler on /__scheduled (the test config sends that path to the Worker)
  const sch = await fetch(`${BASE}/__scheduled?cron=23+*/3+*+*+*`);
  await sleep(1500);
  const after = (await call("status")).body.last_run;
  ok(sch.ok && after > before, "the 3-hourly cron pulls");

  ok(seenBodies.every((b) => !b.includes("access-")), "the bank key never leaves the helper");
} catch (e) {
  fail++; console.log("✗ crashed:", e);
} finally {
  srv.close();
  console.log(`\nBank helper: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
