-- 0004: a bad item is skipped, the good ones still go in. Run after phase4.test.sql (token claimed).
\set ON_ERROR_STOP 1
set role anon;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
do $$ declare r jsonb; begin
  r := public.nest_gateway('test-token', 'propose', '{"items":[
    {"kind":"hello","day":"2099-02-01","dedupe_key":"ok1","payload":{"line":"hi"}},
    {"kind":"hello","day":"2099-02-01","dedupe_key":"bad","expires_at":"not a date"},
    {"kind":"hello","day":"2099-02-01","dedupe_key":"ok2","payload":{"line":"hi again"}}]}'::jsonb);
  assert (r->>'ok')::boolean, 'propose ok';
  assert (r->>'inserted')::int = 2, 'two good ones in: ' || r::text;
  assert (r->>'skipped')::int = 1, 'one skipped';

  r := public.nest_gateway('test-token', 'cache_calendar', '{"from":"2099-02-01","to":"2099-02-02","events":[
    {"google_id":"e1","day":"2099-02-01","start":"09:00","end":"10:00","title":"Good"},
    {"google_id":"e2","day":"2099-02-01","all_day":"maybe","title":"Bad flag"}]}'::jsonb);
  assert (r->>'cached')::int = 1, 'one event cached: ' || r::text;
  assert (r->>'skipped')::int = 1, 'bad event skipped';

  r := public.nest_gateway('test-token', 'add_mail', '{"items":[
    {"received":"yesterday-ish","from":"x","subject":"bad date","link":"https://mail/1"},
    {"received":"2099-02-01T10:00:00Z","from":"y","subject":"good","link":"https://mail/2"}]}'::jsonb);
  assert (r->>'added')::int = 1, 'one mail added: ' || r::text;

  r := public.nest_gateway('test-token', 'mark', '{"items":[{"id":"not-a-uuid","status":"applied"}]}'::jsonb);
  assert (r->>'ok')::boolean and (r->>'skipped')::int = 1, 'bad id skipped: ' || r::text;
end $$;
reset role;
select 'door-per-item: all passed' as result;
