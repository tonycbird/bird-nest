-- Bird Nest · Testing mode reports.
-- The phone saves each report as a row in nest_rows (tbl = 'reports'), like everything else it syncs.
-- This adds one narrow door so Claude's sessions can read open reports and mark them fixed,
-- using the same token as nest_gateway (checked by its hash, never stored in plain text).
-- Paste this whole file into Supabase → SQL editor → Run.

create or replace function public.nest_reports(token text, action text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, nest_private, extensions as $$
declare
  uid uuid;
  it jsonb;
  n int := 0;
  want text;
begin
  select g.user_id into uid from nest_private.gateway g
   where g.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'bad token, or Nest not connected yet');
  end if;
  args := coalesce(args, '{}'::jsonb);

  if action = 'list' then
    -- args: {"status":"open"|"fixed"|"later"|"all", "full": true to include the screen HTML and photo, "id": one report}
    want := coalesce(args->>'status', 'open');
    return jsonb_build_object('ok', true, 'items', coalesce((
      select jsonb_agg(case when coalesce((args->>'full')::boolean, false) then r.data
                            else (r.data - 'dom' - 'frame_dom' - 'photo')
                                 || jsonb_build_object('has_photo', r.data->>'photo' is not null, 'has_dom', r.data->>'dom' is not null) end
                       order by r.data->>'created_at')
        from nest_rows r
       where r.user_id = uid and r.tbl = 'reports' and r.deleted_at is null and r.data->>'deleted_at' is null
         and (want = 'all' or coalesce(r.data->>'status', 'open') = want)
         and (args->>'id' is null or r.id = args->>'id')), '[]'::jsonb));

  elsif action = 'mark' then
    -- args: {"items":[{"id","status":"fixed"|"later"|"open","note":"what changed"}]}
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) limit 100 loop
      if coalesce(it->>'status', '') not in ('open', 'fixed', 'later') then continue; end if;
      update nest_rows r
         set data = r.data || jsonb_build_object('status', it->>'status', 'fix_note', left(it->>'note', 300),
                                                  'fixed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
             updated_at = now()
       where r.user_id = uid and r.tbl = 'reports' and r.id = it->>'id';
      if found then n := n + 1; end if;
    end loop;
    return jsonb_build_object('ok', true, 'marked', n);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action: ' || coalesce(action, ''), 'actions', jsonb_build_array('list', 'mark'));
end $$;
revoke all on function public.nest_reports(text, text, jsonb) from public;
grant execute on function public.nest_reports(text, text, jsonb) to anon, authenticated;
