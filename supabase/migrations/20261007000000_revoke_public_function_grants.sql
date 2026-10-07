-- Tighten grants found by a live audit. `revoke ... from public` (earlier migrations) does not
-- remove Supabase's default per-role grants to anon/authenticated, so revoke from them explicitly.

-- Job-claim functions are only called by check-price-alerts with the service role.
revoke execute on function public.claim_due_alerts(int)   from anon, authenticated;
revoke execute on function public.claim_due_products(int) from anon, authenticated;
-- Trigger function; never meant to be called over RPC.
revoke execute on function public.tg_set_updated_at()     from anon, authenticated;

-- RLS does not govern TRUNCATE; the API never needs TRIGGER/REFERENCES.
revoke truncate, trigger, references on
  public.price_alerts, public.price_alert_deliveries, public.tracked_products, public.price_observations
  from anon, authenticated;

-- Guests have no delete policy; signed-in owners keep "own alerts - delete".
revoke delete on public.price_alerts from anon;
