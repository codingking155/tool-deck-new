-- Target Price Alerts — schema, constraints, RLS. (Beta)
-- Apply with: supabase db push   (or run this file against your Postgres)

create extension if not exists "pgcrypto";      -- gen_random_uuid, digest()

do $$ begin
  create type alert_status as enum ('active','triggered','paused','cancelled','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.price_alerts (
  id                  uuid primary key default gen_random_uuid(),
  product_id          text        not null,
  product_name        text,
  product_image       text,
  product_url         text,
  user_id             uuid        references auth.users(id) on delete cascade,   -- null for guests
  email               text,
  phone               text,                                                      -- E.164, e.g. +919876543210
  target_price        numeric(12,2) not null check (target_price > 0),
  currency            text        not null default 'INR',
  original_price      numeric(12,2),
  email_enabled       boolean     not null default false,
  whatsapp_enabled    boolean     not null default false,
  consent_at          timestamptz not null,
  status              alert_status not null default 'active',
  notification_status jsonb       not null default '{"email":"pending","whatsapp":"pending"}'::jsonb,
  attempts            int         not null default 0,
  last_error          text,
  triggered_at        timestamptz,
  last_checked_at     timestamptz,
  next_check_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Guest management uses a STATELESS HMAC token (alertId + HMAC(alertId, secret)).
  -- Nothing secret is stored here; the monitor and API regenerate/verify it from
  -- ALERT_TOKEN_SECRET, so there's no manage_token column to leak.

  constraint price_alerts_channel_chk  check (email_enabled or whatsapp_enabled),
  constraint price_alerts_contact_chk  check (email is not null or phone is not null)
);

-- Prevent duplicate ACTIVE alerts for the same product + customer contact + identical target.
create unique index if not exists price_alerts_dedupe_active
  on public.price_alerts (
    product_id,
    coalesce(user_id::text, ''),
    coalesce(lower(email), ''),
    coalesce(phone, ''),
    target_price
  )
  where status = 'active';

create index if not exists price_alerts_due_idx    on public.price_alerts (next_check_at) where status = 'active';
create index if not exists price_alerts_user_idx   on public.price_alerts (user_id);

-- updated_at maintenance
create or replace function public.tg_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists price_alerts_set_updated_at on public.price_alerts;
create trigger price_alerts_set_updated_at
  before update on public.price_alerts
  for each row execute function public.tg_set_updated_at();

-- Delivery audit (retry history / per-channel status)
create table if not exists public.price_alert_deliveries (
  id          uuid primary key default gen_random_uuid(),
  alert_id    uuid not null references public.price_alerts(id) on delete cascade,
  channel     text not null check (channel in ('email','whatsapp')),
  status      text not null check (status in ('sent','failed','skipped')),
  provider    text,
  provider_id text,
  error       text,
  attempt     int  not null default 1,
  created_at  timestamptz not null default now()
);
create index if not exists price_alert_deliveries_alert_idx on public.price_alert_deliveries (alert_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Signed-in customers may manage ONLY their own rows via PostgREST.
-- Guest flows never touch the table directly; they go through Edge Functions
-- that use the service-role key and verify the management token.
alter table public.price_alerts          enable row level security;
alter table public.price_alert_deliveries enable row level security;

drop policy if exists "own alerts - select" on public.price_alerts;
drop policy if exists "own alerts - insert" on public.price_alerts;
drop policy if exists "own alerts - update" on public.price_alerts;
drop policy if exists "own alerts - delete" on public.price_alerts;

create policy "own alerts - select" on public.price_alerts
  for select to authenticated using (user_id = auth.uid());
create policy "own alerts - insert" on public.price_alerts
  for insert to authenticated with check (user_id = auth.uid());
create policy "own alerts - update" on public.price_alerts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own alerts - delete" on public.price_alerts
  for delete to authenticated using (user_id = auth.uid());

-- Deliveries: readable by the owner of the parent alert; writes only via service role.
drop policy if exists "own deliveries - select" on public.price_alert_deliveries;
create policy "own deliveries - select" on public.price_alert_deliveries
  for select to authenticated using (
    exists (select 1 from public.price_alerts a where a.id = alert_id and a.user_id = auth.uid())
  );

-- ── Atomic batch claim for the price-check job ───────────────────────────────
-- Claims up to p_batch due alerts, skipping rows already locked by a concurrent
-- job run, and leases them (pushes next_check_at forward) so two overlapping
-- runs never process the same alert. This is the idempotency/locking mechanism.
create or replace function public.claim_due_alerts(p_batch int default 100)
returns setof public.price_alerts
language sql
as $$
  update public.price_alerts a
     set next_check_at = now() + interval '10 minutes'   -- lease; the job rewrites this
   where a.id in (
     select id from public.price_alerts
      where status = 'active' and next_check_at <= now()
      order by next_check_at
      for update skip locked
      limit greatest(1, p_batch)
   )
  returning a.*;
$$;

revoke all on function public.claim_due_alerts(int) from public;
grant execute on function public.claim_due_alerts(int) to service_role;
