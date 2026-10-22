-- Testing-mode reports door. Run after supabase-stub.sql, 0001, 0002, phase4.test.sql's setup, and 0003.
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false), set_config('request.jwt.claim.role', 'authenticated', false);
insert into public.nest_rows (tbl, id, data) values
 ('reports', 'r1', '{"id":"r1","kind":"design","text":"Pill too dark","status":"open","created_at":"2026-10-21T10:00:00Z","dom":"<div>big</div>","photo":"data:image/jpeg;base64,xx","deleted_at":null}'),
 ('reports', 'r2', '{"id":"r2","kind":"stuck","text":"No way out","status":"fixed","created_at":"2026-10-21T11:00:00Z","dom":null,"photo":null,"deleted_at":null}');
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
do $$ begin assert (public.nest_reports('wrong', 'list')->>'ok')::boolean = false, 'bad token'; end $$;
do $$ declare s jsonb := public.nest_reports('test-token', 'list'); begin
  assert (s->>'ok')::boolean, 'list ok';
  assert jsonb_array_length(s->'items') = 1, 'only open reports by default';
  assert s->'items'->0->>'dom' is null and (s->'items'->0->>'has_dom')::boolean, 'screen HTML left out unless asked';
end $$;
do $$ begin assert (public.nest_reports('test-token', 'list', '{"status":"all","full":true}')->'items'->0->>'dom') = '<div>big</div>', 'full list has the screen'; end $$;
do $$ begin assert (public.nest_reports('test-token', 'mark', '{"items":[{"id":"r1","status":"fixed","note":"Lighter pill"}]}')->>'marked')::int = 1, 'mark'; end $$;
do $$ begin assert jsonb_array_length(public.nest_reports('test-token', 'list')->'items') = 0, 'nothing open after the fix'; end $$;
reset role;
do $$ begin assert (select data->>'fix_note' from public.nest_rows where id = 'r1') = 'Lighter pill', 'note saved on the row'; end $$;
select 'reports tests passed';
