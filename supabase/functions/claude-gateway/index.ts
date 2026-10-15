// Bird Nest · claude-gateway (Phase 0: snapshot + propose)
// The one narrow door between Claude scheduled tasks and the app's data.
// Secrets (set in Supabase → Edge Functions → Secrets, never in git):
//   NEST_GATEWAY_TOKEN  long random string; the scheduled tasks send it as x-nest-token
//   NEST_USER_ID        Anthony's auth user id (Authentication → Users)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const TOKEN = Deno.env.get("NEST_GATEWAY_TOKEN") ?? "";
const USER_ID = Deno.env.get("NEST_USER_ID") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const KINDS = new Set([
  "hello", "day_plan", "task", "calendar_book", "workout_swap", "makeup",
  "grocery", "ramble_split", "recap", "rollover", "weekly_review",
]);
const ACTIONS = ["snapshot", "propose"]; // Phase 4 adds cache_calendar, add_mail, approved, mark

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Constant-time compare so the token can't be guessed by timing.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function dayKey(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (TOKEN.length < 32 || !USER_ID) return json({ error: "gateway not configured" }, 500);
  if (!same(req.headers.get("x-nest-token") ?? "", TOKEN)) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "body must be JSON" }, 400); }

  if (body.action === "snapshot") {
    const { data: s } = await db.from("settings").select("tz,wake,bed").eq("user_id", USER_ID).maybeSingle();
    const tz = s?.tz ?? "America/Los_Angeles";
    const now = new Date();
    const { data: pending, error } = await db.from("proposals")
      .select("id,kind,payload,reason,created_at")
      .eq("user_id", USER_ID).eq("status", "pending").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(50);
    if (error) return json({ error: error.message }, 500);
    return json({
      today: dayKey(now, tz),
      tomorrow: dayKey(new Date(now.getTime() + 864e5), tz),
      settings: s ?? { tz, wake: "05:00", bed: "22:00" },
      pending,
      phase: 0,
    });
  }

  if (body.action === "propose") {
    const raw = Array.isArray(body.items) ? body.items : [body];
    if (raw.length === 0 || raw.length > 50) return json({ error: "send 1 to 50 items" }, 400);
    const rows = [];
    for (const it of raw as Record<string, unknown>[]) {
      const kind = String(it.kind ?? "");
      if (!KINDS.has(kind)) return json({ error: `unknown kind: ${kind}`, kinds: [...KINDS] }, 400);
      const payload = it.payload && typeof it.payload === "object" && !Array.isArray(it.payload) ? it.payload : {};
      if (JSON.stringify(payload).length > 20_000) return json({ error: "payload too big" }, 400);
      const reason = typeof it.reason === "string" ? it.reason.slice(0, 200) : null;
      rows.push({
        user_id: USER_ID, kind, payload, reason,
        needs_google: Boolean(it.needs_google),
        expires_at: typeof it.expires_at === "string" ? it.expires_at : null,
        created_by: "claude-task",
      });
    }
    const { data, error } = await db.from("proposals").insert(rows).select("id");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, ids: (data ?? []).map((r) => r.id) });
  }

  return json({ error: "unknown action", actions: ACTIONS }, 400);
});
