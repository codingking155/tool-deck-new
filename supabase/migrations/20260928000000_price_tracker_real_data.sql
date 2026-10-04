-- Price Tracker on real data: products, a price-observation time series, and
-- price_alerts (the existing watchlist/tracker table) linked to real products.
--
-- Additive and safe to re-run. Existing price_alerts rows are kept; see the
-- "legacy alerts" section for what changes for them.

-- ── PRODUCT ─────────────────────────────────────────────────────────────────
-- Identity is marketplace + ASIN, never the pasted URL (affiliate tags,
-- tracking params and mobile hosts all map to the same row).
create table if not exists public.tracked_products (
  id                  uuid primary key default gen_random_uuid(),
  marketplace         text not null,                     -- e.g. 'amazon.in'
  external_id         text not null,                     -- ASIN
  product_key         text generated always as (marketplace || ':' || external_id) stored,
  canonical_url       text not null,
  detail_page_url     text,                              -- provider-issued product link (affiliate-tagged for PA-API)
  title               text,
  image_url           text,
  currency            text,
  -- current state = the latest observation, denormalized for fast reads
  current_price       numeric(12,2),                     -- null while unavailable
  original_price      numeric(12,2),
  availability        text,
  seller              text,
  last_observed_at    timestamptz,                       -- when the current price was last confirmed
  last_checked_at     timestamptz,                       -- last check attempt, successful or not
  last_check_status   text check (last_check_status in ('ok','unavailable','not_found','error')),
  last_error          text,
  history_imported_at timestamptz,                       -- provider history (e.g. Keepa) imported
  last_requested_at   timestamptz not null default now(),-- someone looked at it; keeps it on the schedule
  next_check_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tracked_products_identity unique (marketplace, external_id),
  constraint tracked_products_asin_chk check (external_id ~ '^[0-9A-Z]{10}$')
);
create unique index if not exists tracked_products_key_idx on public.tracked_products (product_key);
create index if not exists tracked_products_due_idx on public.tracked_products (next_check_at);

drop trigger if exists tracked_products_set_updated_at on public.tracked_products;
create trigger tracked_products_set_updated_at
  before update on public.tracked_products
  for each row execute function public.tg_set_updated_at();

-- ── PRICE_OBSERVATION ───────────────────────────────────────────────────────
-- Append-only. Every row is a real reading with the time it was actually taken
-- (or, for imported history, the provider's own timestamp) and its source.
-- price is null when the product was unavailable at that moment.
create table if not exists public.price_observations (
  id              bigint generated always as identity primary key,
  product_id      uuid not null references public.tracked_products(id) on delete cascade,
  price           numeric(12,2) check (price is null or price > 0),
  original_price  numeric(12,2),
  currency        text,
  availability    text,
  seller          text,
  observed_at     timestamptz not null,
  source          text not null,                         -- 'amazon-paapi' | 'keepa-amazon' | 'keepa-new'
  created_at      timestamptz not null default now(),
  constraint price_observations_once unique (product_id, observed_at, source)
);
create index if not exists price_observations_series_idx on public.price_observations (product_id, observed_at desc);

-- ── TRACKER / WATCHLIST ─────────────────────────────────────────────────────
-- price_alerts already holds user_id / target_price / status (enabled), so it
-- stays the watchlist. It now points at the real product it watches.
alter table public.price_alerts
  add column if not exists tracked_product_id uuid references public.tracked_products(id) on delete set null;
create index if not exists price_alerts_product_idx on public.price_alerts (tracked_product_id) where status = 'active';

-- Legacy alerts: before this migration the tracker had no real prices, so any
-- stored "original price" came from the simulated chart. Clear it so no email
-- ever quotes a fake "was" price. Target prices are the customer's own numbers
-- and are kept; the monitor links each legacy alert to its real product (or
-- pauses it with an explanation if its URL isn't a trackable Amazon product).
update public.price_alerts set original_price = null where tracked_product_id is null and original_price is not null;

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Products and observations are read and written only by Edge Functions
-- (service role). No direct client access.
alter table public.tracked_products   enable row level security;
alter table public.price_observations enable row level security;

-- ── Scheduled refresh: atomic batch claim ───────────────────────────────────
-- Claims due products that someone still cares about (viewed in the last
-- 90 days, or watched by an active alert) and leases them so overlapping job
-- runs never check the same product twice. Products Amazon reported as not
-- found stop consuming provider quota unless an alert is still watching them.
create or replace function public.claim_due_products(p_batch int default 50)
returns setof public.tracked_products
language sql
as $$
  update public.tracked_products p
     set next_check_at = now() + interval '15 minutes'
   where p.id in (
     select tp.id from public.tracked_products tp
      where tp.next_check_at <= now()
        and ((tp.last_requested_at > now() - interval '90 days'
              and tp.last_check_status is distinct from 'not_found')
             or exists (select 1 from public.price_alerts a
                         where a.tracked_product_id = tp.id and a.status = 'active'))
      order by tp.next_check_at
      for update skip locked
      limit greatest(1, p_batch)
   )
  returning p.*;
$$;

revoke all on function public.claim_due_products(int) from public;
grant execute on function public.claim_due_products(int) to service_role;
