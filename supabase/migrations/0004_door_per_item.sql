-- Bird Nest 0004: Claude's door skips a bad item instead of failing the whole batch.
-- Before: one event with a date Postgres couldn't read (or a bad id) threw away every other item in that call.
-- Now: each item is tried on its own; bad ones are counted as "skipped". Same function, same answers otherwise.
-- Safe to run more than once.

create or replace function public.nest_gateway(token text, action text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, nest_private, extensions as $$
declare
  uid uuid;
  tz text;
  today text;
  tomorrow text;
  out jsonb;
  it jsonb;
  n_in int := 0;
  n_skip int := 0;
  ids jsonb := '[]'::jsonb;
  new_id uuid;
  kinds text[] := array['hello','day_plan','task','calendar_book','workout_swap','makeup','grocery',
                        'ramble_split','recap','rollover','weekly_review'];
begin
  select g.user_id into uid from nest_private.gateway g
   where g.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'bad token, or Nest not connected yet (sign in on the phone)');
  end if;
  update nest_private.gateway set last_used_at = now() where user_id = uid;

  tz := coalesce((select s.tz from public.settings s where s.user_id = uid), 'America/Los_Angeles');
  today := to_char(now() at time zone tz, 'YYYY-MM-DD');
  tomorrow := to_char((now() at time zone tz) + interval '1 day', 'YYYY-MM-DD');
  args := coalesce(args, '{}'::jsonb);

  if action = 'snapshot' then
    out := jsonb_build_object(
      'ok', true, 'today', today, 'tomorrow', tomorrow, 'tz', tz,
      'now_local', to_char(now() at time zone tz, 'YYYY-MM-DD HH24:MI'),
      'synced_at', (select max(r.updated_at) from nest_rows r where r.user_id = uid),
      'days', coalesce((select jsonb_agg(r.data) from nest_rows r
                         where r.user_id = uid and r.tbl = 'days' and r.day in (today, tomorrow) and r.deleted_at is null), '[]'),
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', b.id, 'day', b.day, 'start', b.data->>'start', 'end', b.data->>'end',
                 'kind', b.data->>'kind', 'icon', b.data->>'icon', 'title', b.data->>'title',
                 'status', b.data->>'status', 'source_type', b.data->>'source_type', 'source_id', b.data->>'source_id',
                 'steps', coalesce((select jsonb_agg(jsonb_build_object('n', s.data->'n', 'label', s.data->>'label',
                                                                         'value', s.data->>'value', 'done', s.data->>'done_at' is not null)
                                                     order by (s.data->>'n')::int)
                                      from nest_rows s
                                     where s.user_id = uid and s.tbl = 'steps' and s.data->>'block_id' = b.id
                                       and s.deleted_at is null and s.data->>'deleted_at' is null), '[]'))
               order by b.day, b.data->>'start')
          from nest_rows b
         where b.user_id = uid and b.tbl = 'blocks' and b.day in (today, tomorrow)
           and b.deleted_at is null and b.data->>'deleted_at' is null), '[]'),
      'tasks_open', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.data->>'title', 'when', t.data->>'when', 'due', t.data->>'due',
                 'tod', t.data->>'tod', 'time', t.data->>'time', 'est', t.data->'est', 'energy', t.data->>'energy',
                 'important', t.data->'important', 'someday', t.data->'someday', 'areaId', t.data->>'areaId',
                 'projectId', t.data->>'projectId', 'contexts', t.data->'contexts', 'reschedules', t.data->'reschedules',
                 'waiting', t.data->'waiting', 'grocery', t.data->'grocery' is not null and t.data->>'grocery' <> 'null',
                 'checklist', (select jsonb_agg(c->>'text') from jsonb_array_elements(coalesce(t.data->'checklist', '[]')) c)))
          from (select * from nest_rows x
                 where x.user_id = uid and x.tbl = 'tasks' and x.deleted_at is null and x.data->>'status' = 'open'
                 order by x.data->>'when' nulls last limit 250) t), '[]'),
      'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.data->>'name', 'listMode', a.data->>'listMode'))
                           from nest_rows a where a.user_id = uid and a.tbl = 'areas' and a.deleted_at is null
                            and coalesce(a.data->>'archived', 'false') <> 'true'), '[]'),
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.data->>'name', 'areaId', p.data->>'areaId',
                                                                 'deadline', p.data->>'deadline'))
                              from nest_rows p where p.user_id = uid and p.tbl = 'projects' and p.deleted_at is null
                               and p.data->>'status' = 'active'), '[]'),
      'body', (select r.data from nest_rows r where r.user_id = uid and r.tbl = 'derived' and r.id = 'body_plan'),
      'prefs', (select r.data from nest_rows r where r.user_id = uid and r.tbl = 'derived' and r.id = 'prefs'),
      'calendar', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'start', c.start_time, 'end', c.end_time,
                                                                 'title', c.title, 'all_day', c.all_day) order by c.day, c.start_time)
                              from calendar_cache c where c.user_id = uid and c.day >= today
                               and c.day <= to_char((now() at time zone tz) + interval '2 day', 'YYYY-MM-DD')), '[]'),
      'proposals_pending', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'reason', p.reason,
                                                                          'dedupe_key', p.dedupe_key, 'day_key', p.day_key))
                                       from proposals p where p.user_id = uid and p.status in ('pending','approved')
                                        and p.deleted_at is null), '[]'),
      'decided_today', coalesce((select jsonb_agg(jsonb_build_object('kind', p.kind, 'dedupe_key', p.dedupe_key, 'status', p.status))
                                   from proposals p where p.user_id = uid and p.day_key = today
                                    and p.status in ('declined','applied','failed')), '[]'),
      'mail_recent', coalesce((select jsonb_agg(jsonb_build_object('subject', m.subject, 'ask', m.ask, 'link', m.link))
                                 from mail_items m where m.user_id = uid and m.created_at > now() - interval '3 days'), '[]')
    );
    return out;

  elsif action = 'propose' then
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) loop
      if not (it->>'kind' = any(kinds)) then n_skip := n_skip + 1; continue; end if;
      -- One per kind + key per day: a declined one never comes back the same day.
      if exists (select 1 from proposals p where p.user_id = uid and p.kind = it->>'kind'
                   and p.day_key = coalesce(it->>'day', today)
                   and coalesce(p.dedupe_key, '') = coalesce(it->>'dedupe_key', '')
                   and p.deleted_at is null) then
        n_skip := n_skip + 1; continue;
      end if;
      begin -- one bad item (a date that won't parse) is skipped; the rest still go in
        insert into proposals (user_id, kind, payload, reason, needs_google, day_key, dedupe_key, expires_at, created_by)
        values (uid, it->>'kind', coalesce(it->'payload', '{}'::jsonb), left(it->>'reason', 200),
                coalesce((it->>'needs_google')::boolean, it->>'kind' = 'calendar_book'),
                coalesce(it->>'day', today), it->>'dedupe_key', (it->>'expires_at')::timestamptz, 'claude-task')
        returning id into new_id;
        ids := ids || to_jsonb(new_id); n_in := n_in + 1;
      exception when others then n_skip := n_skip + 1;
      end;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', n_in, 'skipped', n_skip, 'ids', ids);

  elsif action = 'cache_calendar' then
    delete from calendar_cache c where c.user_id = uid
      and c.day >= coalesce(args->>'from', today) and c.day <= coalesce(args->>'to', tomorrow);
    for it in select * from jsonb_array_elements(coalesce(args->'events', '[]'::jsonb)) limit 400 loop
      begin
        insert into calendar_cache (user_id, google_id, day, start_time, end_time, title, all_day, calendar)
        values (uid, coalesce(it->>'google_id', md5(it::text)), it->>'day', it->>'start', it->>'end',
                left(coalesce(it->>'title', '(busy)'), 160), coalesce((it->>'all_day')::boolean, false), left(it->>'calendar', 80))
        on conflict (user_id, google_id, day) do update
          set start_time = excluded.start_time, end_time = excluded.end_time, title = excluded.title,
              all_day = excluded.all_day, calendar = excluded.calendar, updated_at = now();
        n_in := n_in + 1;
      exception when others then n_skip := n_skip + 1;
      end;
    end loop;
    return jsonb_build_object('ok', true, 'cached', n_in, 'skipped', n_skip);

  elsif action = 'add_mail' then
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) limit 50 loop
      if coalesce(it->>'link', '') = '' then n_skip := n_skip + 1; continue; end if;
      begin
        insert into mail_items (user_id, received, sender, subject, ask, due, link)
        values (uid, (it->>'received')::timestamptz, left(it->>'from', 120), left(it->>'subject', 200),
                left(it->>'ask', 80), left(it->>'due', 20), left(it->>'link', 500))
        on conflict (user_id, link) do nothing;
        if found then n_in := n_in + 1; else n_skip := n_skip + 1; end if;
      exception when others then n_skip := n_skip + 1;
      end;
    end loop;
    return jsonb_build_object('ok', true, 'added', n_in, 'skipped', n_skip);

  elsif action = 'approved' then
    return jsonb_build_object('ok', true, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'payload', p.payload, 'reason', p.reason) order by p.created_at)
        from proposals p where p.user_id = uid and p.status = 'approved' and p.needs_google and p.deleted_at is null), '[]'));

  elsif action = 'mark' then
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) loop
      if it->>'status' not in ('applied','failed') then n_skip := n_skip + 1; continue; end if;
      begin
        update proposals p set status = it->>'status', note = left(it->>'note', 200)
         where p.user_id = uid and p.id = (it->>'id')::uuid and p.status = 'approved';
        if found then n_in := n_in + 1; else n_skip := n_skip + 1; end if;
      exception when others then n_skip := n_skip + 1;
      end;
    end loop;
    return jsonb_build_object('ok', true, 'marked', n_in, 'skipped', n_skip);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action: ' || coalesce(action, ''),
                            'actions', jsonb_build_array('snapshot','propose','cache_calendar','add_mail','approved','mark'));
end $$;
revoke all on function public.nest_gateway(text, text, jsonb) from public;
grant execute on function public.nest_gateway(text, text, jsonb) to anon, authenticated;
