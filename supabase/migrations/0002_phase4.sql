-- Bird Nest · Phase 4 · the Claude loop
-- Run once in the Supabase SQL editor, after 0001. Safe to run again.
--
-- What it adds:
--   nest_rows       a copy of everything on the phone (the phone stays the main copy)
--   calendar_cache  Google Calendar events Claude copies in, read-only for the app
--   mail_items      mail Claude flagged: a summary line and a link, never the body
--   nest_gateway()  the one narrow door for Claude's scheduled tasks (token checked inside)

create extension if not exists pgcrypto with schema extensions;

-- ---------- the copy of the phone ----------
create table if not exists public.nest_rows (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tbl         text not null,                 -- the phone's table: blocks, steps, tasks, fit, derived…
  id          text not null,                 -- that row's key on the phone
  data        jsonb not null,
  day         text,                          -- YYYY-MM-DD when the row belongs to a day
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (user_id, tbl, id)
);
create index if not exists nest_rows_day on public.nest_rows (user_id, tbl, day);
alter table public.nest_rows enable row level security;
drop policy if exists "nest_rows: own" on public.nest_rows;
create policy "nest_rows: own" on public.nest_rows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- calendar, copied in by Claude ----------
create table if not exists public.calendar_cache (
  user_id     uuid not null references auth.users(id) on delete cascade,
  google_id   text not null,
  day         text not null,
  start_time  text,                          -- HH:MM local, null for all-day
  end_time    text,
  title       text not null check (length(title) <= 160),
  all_day     boolean not null default false,
  calendar    text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, google_id, day)
);
alter table public.calendar_cache enable row level security;
drop policy if exists "calendar: read own" on public.calendar_cache;
create policy "calendar: read own" on public.calendar_cache for select using (user_id = auth.uid());

-- ---------- mail Claude flagged (never the body) ----------
create table if not exists public.mail_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  received     timestamptz,
  sender       text check (length(sender) <= 120),
  subject      text check (length(subject) <= 200),
  ask          text check (length(ask) <= 80),
  due          text,
  link         text not null check (length(link) <= 500),
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (user_id, link)
);
alter table public.mail_items enable row level security;
drop policy if exists "mail: read own" on public.mail_items;
create policy "mail: read own" on public.mail_items for select using (user_id = auth.uid());
drop policy if exists "mail: dismiss own" on public.mail_items;
create policy "mail: dismiss own" on public.mail_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- proposals: one per kind+key per day ----------
alter table public.proposals add column if not exists day_key text;
alter table public.proposals add column if not exists dedupe_key text;
create index if not exists proposals_dedupe on public.proposals (user_id, kind, day_key, dedupe_key);

-- The app may approve, decline, reset, and mark its own (non-Google) proposals applied.
create or replace function public.proposals_guard() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    if new.kind is distinct from old.kind
       or new.payload is distinct from old.payload
       or new.user_id is distinct from old.user_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Only status can change from the app';
    end if;
    if new.status not in ('pending','approved','declined')
       and not (new.status = 'applied' and not old.needs_google) then
      raise exception 'The app can only approve, decline or reset';
    end if;
  end if;
  return new;
end $$;

-- ---------- the gateway token (only its hash is stored) ----------
create schema if not exists nest_private;
revoke all on schema nest_private from public;
create table if not exists nest_private.gateway (
  token_hash   text primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
-- Locked: no policies, so the app and browsers can't read it. Only the door function (owner) can.
alter table nest_private.gateway enable row level security;

-- After Anthony signs in on the phone, the app calls this once to tie the token to him.
create or replace function public.nest_claim_gateway() returns boolean
language plpgsql security definer set search_path = public, nest_private as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from nest_private.gateway where user_id = auth.uid()) then return true; end if;
  update nest_private.gateway set user_id = auth.uid() where user_id is null;
  return found;
end $$;
revoke all on function public.nest_claim_gateway() from public;
grant execute on function public.nest_claim_gateway() to authenticated;

-- ---------- the door ----------
-- POST /rest/v1/rpc/nest_gateway  {"token":"…","action":"snapshot","args":{…}}
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
      insert into proposals (user_id, kind, payload, reason, needs_google, day_key, dedupe_key, expires_at, created_by)
      values (uid, it->>'kind', coalesce(it->'payload', '{}'::jsonb), left(it->>'reason', 200),
              coalesce((it->>'needs_google')::boolean, it->>'kind' = 'calendar_book'),
              coalesce(it->>'day', today), it->>'dedupe_key', (it->>'expires_at')::timestamptz, 'claude-task')
      returning id into new_id;
      ids := ids || to_jsonb(new_id); n_in := n_in + 1;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', n_in, 'skipped', n_skip, 'ids', ids);

  elsif action = 'cache_calendar' then
    delete from calendar_cache c where c.user_id = uid
      and c.day >= coalesce(args->>'from', today) and c.day <= coalesce(args->>'to', tomorrow);
    for it in select * from jsonb_array_elements(coalesce(args->'events', '[]'::jsonb)) limit 400 loop
      insert into calendar_cache (user_id, google_id, day, start_time, end_time, title, all_day, calendar)
      values (uid, coalesce(it->>'google_id', md5(it::text)), it->>'day', it->>'start', it->>'end',
              left(coalesce(it->>'title', '(busy)'), 160), coalesce((it->>'all_day')::boolean, false), left(it->>'calendar', 80))
      on conflict (user_id, google_id, day) do update
        set start_time = excluded.start_time, end_time = excluded.end_time, title = excluded.title,
            all_day = excluded.all_day, calendar = excluded.calendar, updated_at = now();
      n_in := n_in + 1;
    end loop;
    return jsonb_build_object('ok', true, 'cached', n_in);

  elsif action = 'add_mail' then
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) limit 50 loop
      if coalesce(it->>'link', '') = '' then n_skip := n_skip + 1; continue; end if;
      insert into mail_items (user_id, received, sender, subject, ask, due, link)
      values (uid, (it->>'received')::timestamptz, left(it->>'from', 120), left(it->>'subject', 200),
              left(it->>'ask', 80), left(it->>'due', 20), left(it->>'link', 500))
      on conflict (user_id, link) do nothing;
      if found then n_in := n_in + 1; else n_skip := n_skip + 1; end if;
    end loop;
    return jsonb_build_object('ok', true, 'added', n_in, 'skipped', n_skip);

  elsif action = 'approved' then
    return jsonb_build_object('ok', true, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'payload', p.payload, 'reason', p.reason) order by p.created_at)
        from proposals p where p.user_id = uid and p.status = 'approved' and p.needs_google and p.deleted_at is null), '[]'));

  elsif action = 'mark' then
    for it in select * from jsonb_array_elements(coalesce(args->'items', '[]'::jsonb)) loop
      if it->>'status' not in ('applied','failed') then n_skip := n_skip + 1; continue; end if;
      update proposals p set status = it->>'status', note = left(it->>'note', 200)
       where p.user_id = uid and p.id = (it->>'id')::uuid and p.status = 'approved';
      if found then n_in := n_in + 1; else n_skip := n_skip + 1; end if;
    end loop;
    return jsonb_build_object('ok', true, 'marked', n_in, 'skipped', n_skip);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action: ' || coalesce(action, ''),
                            'actions', jsonb_build_array('snapshot','propose','cache_calendar','add_mail','approved','mark'));
end $$;
revoke all on function public.nest_gateway(text, text, jsonb) from public;
grant execute on function public.nest_gateway(text, text, jsonb) to anon, authenticated;
