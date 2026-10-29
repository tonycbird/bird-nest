-- Money summary door. Run after supabase-stub.sql, 0001, 0002, phase4.test.sql's setup, 0003, 0004 and 0005.
\set ON_ERROR_STOP 1
set role anon;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
do $$ begin assert (public.nest_money('wrong', 'put', '{"summary":{"v":1,"month":"2026-10"}}')->>'ok')::boolean = false, 'bad token'; end $$;
do $$ begin assert (public.nest_money('test-token', 'put', '{"summary":"nope"}')->>'ok')::boolean = false, 'not an object'; end $$;
do $$ begin assert (public.nest_money('test-token', 'put', '{"summary":{"month":"2026-10"}}')->>'ok')::boolean = false, 'needs v'; end $$;
do $$ begin assert (public.nest_money('test-token', 'put', '{"summary":{"v":1,"month":"2026-10","left":{"total":1682.25},"groceries":{"left":347.64}}}')->>'ok')::boolean, 'put'; end $$;
do $$ begin assert (public.nest_money('test-token', 'put', '{"summary":{"v":1,"month":"2026-10","left":{"total":1500},"groceries":{"left":300}}}')->>'ok')::boolean, 'put again replaces'; end $$;
do $$ declare g jsonb := public.nest_money('test-token', 'get'); begin
  assert (g->'summary'->'left'->>'total')::numeric = 1500, 'get returns the latest';
end $$;
do $$ begin assert (public.nest_money('test-token', 'nope')->>'ok')::boolean = false, 'unknown action'; end $$;
-- anon reading the table directly sees nothing (row level security)
do $$ begin assert (select count(*) from public.money_summary) = 0, 'anon sees no rows'; end $$;
reset role;
-- the phone (signed in) reads only its own row
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false), set_config('request.jwt.claim.role', 'authenticated', false);
do $$ begin assert (select count(*) from public.money_summary) = 1, 'owner sees the summary'; end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin assert (select count(*) from public.money_summary) = 0, 'someone else sees nothing'; end $$;
reset role;
do $$ begin assert (select count(*) from public.money_summary) = 1, 'one row per person'; end $$;
select 'money tests passed';
