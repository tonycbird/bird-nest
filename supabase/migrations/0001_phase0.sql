-- Bird Nest · Phase 0
-- Only what Phase 0 needs: settings and proposals. Phase 1 adds days, blocks, steps and audit.
-- Run once in the Supabase SQL editor (nest-dev first, then nest).

create extension if not exists pgcrypto;

-- keeps updated_at honest on every change
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- settings: one row for Anthony ----------
create table if not exists public.settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tz          text not null default 'America/Los_Angeles',
  wake        text not null default '05:00',
  bed         text not null default '22:00',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "settings: own row" on public.settings;
create policy "settings: own row" on public.settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------- proposals: Claude suggests, Anthony decides ----------
create table if not exists public.proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  reason        text,
  status        text not null default 'pending'
                check (status in ('pending','approved','declined','applied','failed')),
  needs_google  boolean not null default false,
  note          text,
  expires_at    timestamptz,
  created_by    text not null default 'claude-task',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists proposals_user_status on public.proposals (user_id, status, created_at desc);
alter table public.proposals enable row level security;

-- Anthony can read his proposals and change their status. He cannot invent them.
-- Inserts come only from the claude-gateway function (service role bypasses RLS).
drop policy if exists "proposals: read own" on public.proposals;
create policy "proposals: read own" on public.proposals
  for select using (user_id = auth.uid());
drop policy if exists "proposals: decide own" on public.proposals;
create policy "proposals: decide own" on public.proposals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The app may only flip status between pending / approved / declined.
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
    if new.status not in ('pending','approved','declined') then
      raise exception 'The app can only approve, decline or reset';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists proposals_guard on public.proposals;
create trigger proposals_guard before update on public.proposals
  for each row execute function public.proposals_guard();
drop trigger if exists proposals_touch on public.proposals;
create trigger proposals_touch before update on public.proposals
  for each row execute function public.touch_updated_at();
