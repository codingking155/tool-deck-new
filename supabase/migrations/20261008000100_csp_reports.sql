-- CSP violation reports (csp-report Edge Function), aggregated per day so the table stays small:
-- one row per (day, directive, blocked, page, source, disposition) with a hit count.
-- Values are already reduced by shared/cspReport (origins and path prefixes only, no query strings).
-- Only the service role writes; read it in the SQL editor:
--   select * from public.csp_violations order by day desc, hits desc;

create table if not exists public.csp_violations (
  day         date        not null default current_date,
  directive   text        not null,
  blocked     text        not null,
  page        text        not null,
  source      text        not null,
  disposition text        not null,
  hits        integer     not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (day, directive, blocked, page, source, disposition)
);

alter table public.csp_violations enable row level security;  -- no policies: no direct access
revoke all on public.csp_violations from anon, authenticated;

-- Adds a batch of normalized reports. New combinations stop being recorded once a day already has
-- 2000 rows (existing ones still count up), so a flood of made-up origins can't grow the table.
create or replace function public.csp_report_add(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
  today_rows integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid csp report batch';
  end if;
  select count(*) into today_rows from public.csp_violations where day = current_date;
  for r in select * from jsonb_array_elements(p_rows) loop
    if today_rows >= 2000 then
      update public.csp_violations set hits = hits + 1, last_seen = now()
       where day = current_date and directive = left(r->>'directive', 60) and blocked = left(r->>'blocked', 200)
         and page = left(r->>'page', 60) and source = left(r->>'source', 200) and disposition = left(r->>'disposition', 10);
    else
      insert into public.csp_violations as v (directive, blocked, page, source, disposition)
      values (left(coalesce(r->>'directive', ''), 60), left(coalesce(r->>'blocked', ''), 200), left(coalesce(r->>'page', ''), 60),
              left(coalesce(r->>'source', ''), 200), left(coalesce(r->>'disposition', ''), 10))
      on conflict (day, directive, blocked, page, source, disposition)
      do update set hits = v.hits + 1, last_seen = now();
      if found then today_rows := today_rows + 1; end if; -- over-counts updates; only makes the cap stricter
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.csp_report_add(jsonb) from public, anon, authenticated;
grant execute on function public.csp_report_add(jsonb) to service_role;

-- Keep 90 days. pg_cron is enabled by 20260719000100.
select cron.unschedule(jobid) from cron.job where jobname = 'csp-violations-sweep';
select cron.schedule('csp-violations-sweep', '41 3 * * *', $$delete from public.csp_violations where day < current_date - 90$$);
