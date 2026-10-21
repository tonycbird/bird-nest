-- Gateway + RLS tests. Run: psql -v ON_ERROR_STOP=1 -f supabase-stub.sql -f 0001 -f 0002 -f this file
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'anthony@example.com'), ('22222222-2222-2222-2222-222222222222', 'stranger@example.com');
insert into nest_private.gateway (token_hash) values (encode(extensions.digest('test-token', 'sha256'), 'hex'));

-- Before anyone claims the token, the door is shut.
do $$ begin assert (public.nest_gateway('test-token', 'snapshot')->>'ok')::boolean = false, 'unclaimed token must fail'; end $$;

-- Anthony signs in on the phone and claims it.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false), set_config('request.jwt.claim.role', 'authenticated', false);
do $$ begin assert public.nest_claim_gateway(), 'claim'; end $$;
-- The phone copies rows up.
insert into public.nest_rows (tbl, id, data, day) values
 ('blocks', 'b1', '{"id":"b1","day":"2099-01-01","start":"05:00","title":"Legs","kind":"body","status":"open","deleted_at":null}', '2099-01-01'),
 ('tasks', 't1', '{"id":"t1","title":"Call supplier","status":"open","when":null,"checklist":[{"text":"a","done":false}]}', null),
 ('tasks', 't2', '{"id":"t2","title":"Done thing","status":"done"}', null),
 ('derived', 'body_plan', '{"days":[]}', null);
-- A stranger can't claim it and can't see Anthony's rows.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin assert not public.nest_claim_gateway(), 'stranger cannot claim'; end $$;
do $$ begin assert (select count(*) from public.nest_rows) = 0, 'RLS hides other rows'; end $$;
reset role;

-- Claude, with the token, as anon.
set role anon;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
do $$ begin assert (public.nest_gateway('wrong', 'snapshot')->>'ok')::boolean = false, 'bad token'; end $$;
do $$ declare s jsonb := public.nest_gateway('test-token', 'snapshot'); begin
  assert (s->>'ok')::boolean, 'snapshot ok';
  assert jsonb_array_length(s->'tasks_open') = 1, 'only open tasks: ' || (s->'tasks_open')::text;
  assert s->'tasks_open'->0->'checklist' = '["a"]'::jsonb, 'checklist texts';
  assert s->'body' = '{"days":[]}'::jsonb, 'body plan';
end $$;
do $$ declare r jsonb; begin
  r := public.nest_gateway('test-token', 'propose', '{"items":[{"kind":"day_plan","dedupe_key":"plan","payload":{"title":"Plan"},"reason":"why"},{"kind":"bogus"},{"kind":"calendar_book","dedupe_key":"gym","payload":{"title":"Gym"}}]}');
  assert (r->>'inserted')::int = 2 and (r->>'skipped')::int = 1, 'propose: ' || r::text;
  r := public.nest_gateway('test-token', 'propose', '{"items":[{"kind":"day_plan","dedupe_key":"plan","payload":{}}]}');
  assert (r->>'inserted')::int = 0, 'same kind+key same day is skipped';
end $$;
-- Anon can't read tables directly.
do $$ begin assert (select count(*) from public.proposals) = 0, 'anon sees no proposals'; end $$;
reset role;

-- Anthony declines the plan and approves the booking from the phone.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false), set_config('request.jwt.claim.role', 'authenticated', false);
update public.proposals set status = 'declined' where kind = 'day_plan';
update public.proposals set status = 'approved' where kind = 'calendar_book';
do $$ begin
  begin update public.proposals set status = 'applied' where kind = 'calendar_book'; assert false, 'app must not mark a Google one applied';
  exception when raise_exception then null; end;
  begin update public.proposals set payload = '{}' where kind = 'calendar_book'; assert false, 'app must not edit payload';
  exception when raise_exception then null; end;
end $$;
reset role;

set role anon;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
do $$ declare r jsonb; a jsonb; begin
  -- the declined plan does not come back today
  r := public.nest_gateway('test-token', 'propose', '{"items":[{"kind":"day_plan","dedupe_key":"plan","payload":{}}]}');
  assert (r->>'inserted')::int = 0, 'declined stays declined today';
  a := public.nest_gateway('test-token', 'approved');
  assert jsonb_array_length(a->'items') = 1 and a->'items'->0->>'kind' = 'calendar_book', 'approved list: ' || a::text;
  r := public.nest_gateway('test-token', 'mark', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', a->'items'->0->>'id', 'status', 'applied', 'note', 'booked'))));
  assert (r->>'marked')::int = 1, 'mark';
  assert jsonb_array_length(public.nest_gateway('test-token', 'approved')->'items') = 0, 'applied leaves the list';
  -- marking again does nothing (never twice)
  r := public.nest_gateway('test-token', 'mark', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', a->'items'->0->>'id', 'status', 'applied'))));
  assert (r->>'marked')::int = 0, 'mark twice is a no-op';
  r := public.nest_gateway('test-token', 'cache_calendar', '{"from":"2099-01-01","to":"2099-01-02","events":[{"google_id":"g1","day":"2099-01-01","start":"09:00","end":"10:00","title":"Dentist"},{"google_id":"g2","day":"2099-01-02","title":"Trip","all_day":true}]}');
  assert (r->>'cached')::int = 2, 'calendar';
  r := public.nest_gateway('test-token', 'cache_calendar', '{"from":"2099-01-01","to":"2099-01-02","events":[{"google_id":"g1","day":"2099-01-01","start":"09:30","end":"10:00","title":"Dentist"}]}');
  r := public.nest_gateway('test-token', 'add_mail', '{"items":[{"from":"Dave","subject":"Quote?","ask":"Send tile quote","link":"https://mail.google.com/x"},{"from":"x","subject":"no link"}]}');
  assert (r->>'added')::int = 1 and (r->>'skipped')::int = 1, 'mail: ' || r::text;
  r := public.nest_gateway('test-token', 'add_mail', '{"items":[{"from":"Dave","subject":"Quote?","ask":"Send tile quote","link":"https://mail.google.com/x"}]}');
  assert (r->>'added')::int = 0, 'mail once';
  assert (public.nest_gateway('test-token', 'nope')->>'ok')::boolean = false, 'unknown action';
end $$;
reset role;
do $$ begin assert (select count(*) from public.calendar_cache) = 1 and (select start_time from public.calendar_cache) = '09:30', 'calendar replaced for the range'; end $$;

-- The app marks its own non-Google proposal applied.
insert into public.proposals (user_id, kind, payload, status) values ('11111111-1111-1111-1111-111111111111', 'task', '{}', 'approved');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false), set_config('request.jwt.claim.role', 'authenticated', false);
update public.proposals set status = 'applied' where kind = 'task';
reset role;
\echo 'phase4 SQL tests: all passed'
