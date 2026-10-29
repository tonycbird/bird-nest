-- Bird Nest 0005 · Money summary (Phase 6).
-- Claude reads Bird Budgeting (read-only) and works out a small summary: left to spend, the next payday,
-- bills before it, how many transactions still need a category. Only that summary is stored here —
-- never transactions or payees. The phone reads it; Claude writes it through this one narrow door,
-- with the same token as nest_gateway (checked by its hash).
-- Paste this whole file into Supabase → SQL editor → Run. Safe to run more than once.

create table if not exists public.money_summary (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.money_summary enable row level security;
drop policy if exists "money: read own" on public.money_summary;
create policy "money: read own" on public.money_summary for select using (user_id = auth.uid());

create or replace function public.nest_money(token text, action text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, nest_private, extensions as $$
declare
  uid uuid;
  s jsonb;
begin
  select g.user_id into uid from nest_private.gateway g
   where g.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'bad token, or Nest not connected yet');
  end if;
  args := coalesce(args, '{}'::jsonb);

  if action = 'put' then
    -- args: {"summary": {...}} from claude/tools/money.mjs
    s := args->'summary';
    if s is null or jsonb_typeof(s) <> 'object' or s->>'v' is null or s->>'month' is null then
      return jsonb_build_object('ok', false, 'error', 'summary missing or not from money.mjs');
    end if;
    if length(s::text) > 20000 then
      return jsonb_build_object('ok', false, 'error', 'summary too big');
    end if;
    insert into public.money_summary (user_id, data, updated_at) values (uid, s, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now();
    return jsonb_build_object('ok', true);

  elsif action = 'get' then
    return jsonb_build_object('ok', true,
      'summary', (select m.data from public.money_summary m where m.user_id = uid),
      'updated_at', (select m.updated_at from public.money_summary m where m.user_id = uid));
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action: ' || coalesce(action, ''), 'actions', jsonb_build_array('put', 'get'));
end $$;
revoke all on function public.nest_money(text, text, jsonb) from public;
grant execute on function public.nest_money(text, text, jsonb) to anon, authenticated;
grant select on public.money_summary to authenticated;
