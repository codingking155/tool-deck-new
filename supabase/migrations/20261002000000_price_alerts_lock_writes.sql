-- Alerts are created and changed only through the price-alerts Edge Function,
-- which fills product name, link, image, currency and "was" price from
-- tracked_products and validates the contact details. The old insert/update
-- policies let a signed-in user write those columns directly through
-- PostgREST (e.g. a fake product link or "was" price emailed to any address),
-- so direct writes are removed. Owners keep read and delete access.

drop policy if exists "own alerts - insert" on public.price_alerts;
drop policy if exists "own alerts - update" on public.price_alerts;

revoke insert, update on public.price_alerts from anon, authenticated;
revoke insert, update, delete on public.price_alert_deliveries from anon, authenticated;
revoke insert, update, delete on public.tracked_products from anon, authenticated;
revoke insert, update, delete on public.price_observations from anon, authenticated;
