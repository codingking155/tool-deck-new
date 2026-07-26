-- Schedule the price-check job every 5 minutes via pg_cron + pg_net.
-- Requires the `pg_cron` and `pg_net` extensions (available on Supabase).
-- Set the two settings below first (Dashboard → Database → or run the ALTER lines),
-- then this schedule will POST to the Edge Function on a timer.
--
--   select set_config('app.functions_url', 'https://<project-ref>.functions.supabase.co', false);
--   select set_config('app.cron_secret',   '<CRON_SECRET>', false);
--
-- For persistence across sessions, prefer Vault or store them in a private table.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove a previous schedule with the same name if present.
select cron.unschedule(jobid) from cron.job where jobname = 'price-alerts-check';

select cron.schedule(
  'price-alerts-check',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.functions_url', true) || '/check-price-alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', current_setting('app.cron_secret', true)
               ),
    body    := jsonb_build_object('batch', 100)
  );
  $$
);
