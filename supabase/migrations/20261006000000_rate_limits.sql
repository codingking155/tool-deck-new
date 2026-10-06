-- Cross-instance rate limiting for public Edge Functions (breach-check).
-- Callers pass an opaque key (a hash, never a raw IP). Only the service role
-- can call the function; the table itself is unreachable from the client.

create table if not exists public.rate_limits (
  key      text primary key,
  count    integer     not null default 0,
  reset_at timestamptz not null
);

alter table public.rate_limits enable row level security;  -- no policies: no direct access
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rate_limits;
  t timestamptz := now();
begin
  if p_key is null or length(p_key) > 200 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.rate_limits as rl (key, count, reset_at)
  values (p_key, 1, t + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count    = case when rl.reset_at <= t then 1 else rl.count + 1 end,
    reset_at = case when rl.reset_at <= t then t + make_interval(secs => p_window_seconds) else rl.reset_at end
  returning * into r;

  -- opportunistic cleanup of long-expired keys
  if random() < 0.02 then
    delete from public.rate_limits where reset_at < t - interval '1 day';
  end if;

  allowed := r.count <= p_max;
  retry_after := greatest(0, ceil(extract(epoch from (r.reset_at - t)))::integer);
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
