-- Indexes for query paths that had none.

-- "My alerts" lists filter by user_id and sort by created_at desc (price-alerts GET).
-- The composite index serves both filter and sort, replacing the user_id-only one.
create index if not exists price_alerts_user_created_idx
  on public.price_alerts (user_id, created_at desc);
drop index if exists public.price_alerts_user_idx;

-- price_alerts.tracked_product_id is a FK with ON DELETE SET NULL; the existing index is
-- partial (active only), so deleting a tracked product scanned every non-active alert.
-- A full index covers the FK and the cron's "active alerts for these products" lookup.
create index if not exists price_alerts_tracked_product_idx
  on public.price_alerts (tracked_product_id);
drop index if exists public.price_alerts_product_idx;

-- rate_limit_hit() periodically deletes expired keys by reset_at.
create index if not exists rate_limits_reset_at_idx on public.rate_limits (reset_at);
