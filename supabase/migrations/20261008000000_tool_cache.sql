-- Cross-instance result cache for public lookup Edge Functions (shopify-check, ssl-check).
-- Keys are opaque hashes; values are the public JSON response. Only the service role
-- touches it, so the table is unreachable from the client.

create table if not exists public.tool_cache (
  key        text primary key,
  body       jsonb       not null,
  expires_at timestamptz not null
);

create index if not exists tool_cache_expires_idx on public.tool_cache (expires_at);

alter table public.tool_cache enable row level security;  -- no policies: no direct access
revoke all on public.tool_cache from anon, authenticated;

-- Hourly sweep of expired rows (reads already ignore them). pg_cron is enabled by 20260719000100.
select cron.unschedule(jobid) from cron.job where jobname = 'tool-cache-sweep';
select cron.schedule('tool-cache-sweep', '17 * * * *', $$delete from public.tool_cache where expires_at < now()$$);
