-- Aggregate the observability page's job-run metrics in Postgres.
--
-- The route previously fetched every owned run in 1,000-row OFFSET pages and
-- reduced the rows in TypeScript. Large histories reached ten pages per scope,
-- producing the repeated job_runs queries and pool checkouts reported by
-- Sentry MOGPLEX-D/E. This RPC keeps the response contract exact while doing
-- one bounded database round trip and returning one JSON object.

create or replace function public.observability_job_run_stats(
  p_user_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_now timestamptz,
  p_repairable_before timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with owned_run_ids as materialized (
  select jr.id
  from public.job_runs jr
  join public.assignments a on a.id = jr.assignment_id
  join public.repos r on r.id = a.repo_id
  where r.user_id = p_user_id

  union

  select jr.id
  from public.job_runs jr
  join public.triggers t on t.id = jr.trigger_id
  where t.user_id = p_user_id

  union

  select jr.id
  from public.job_runs jr
  join public.flows f on f.id = jr.flow_id
  where f.user_id = p_user_id
),
scoped_runs as materialized (
  select
    jr.status,
    jr.created_at,
    jr.started_at,
    jr.completed_at,
    jr.last_start_attempt_at,
    jr.last_start_source
  from public.job_runs jr
  join owned_run_ids owned on owned.id = jr.id
),
totals as (
  select
    count(*)::bigint as total,
    count(*) filter (where status = 'running')::bigint as running,
    count(*) filter (where status = 'pending')::bigint as pending,
    count(*) filter (
      where status = 'pending'
        and (
          coalesce(last_start_attempt_at, created_at, started_at) <=
            p_repairable_before
          or coalesce(last_start_attempt_at, created_at, started_at) is null
        )
    )::bigint as repairable_pending,
    count(*) filter (
      where status = 'failed'
        and coalesce(started_at, created_at) >= p_window_start
        and coalesce(started_at, created_at) <= p_window_end
    )::bigint as failed_in_range,
    count(*) filter (
      where last_start_source = 'repair'
        and last_start_attempt_at >= p_window_start
        and last_start_attempt_at <= p_window_end
    )::bigint as repaired_in_range,
    count(*) filter (
      where status in ('success', 'failed')
        and coalesce(completed_at, started_at, created_at) >= p_window_start
        and coalesce(completed_at, started_at, created_at) <= p_window_end
    )::bigint as concluded_in_range,
    count(*) filter (
      where status = 'success'
        and coalesce(completed_at, started_at, created_at) >= p_window_start
        and coalesce(completed_at, started_at, created_at) <= p_window_end
    )::bigint as successful_in_range,
    coalesce(
      round(
        extract(epoch from (
          p_now - min(coalesce(last_start_attempt_at, created_at, started_at))
            filter (where status = 'pending')
        )) * 1000
      ),
      0
    )::bigint as oldest_pending_age_ms
  from scoped_runs
)
select jsonb_build_object(
  'total', total,
  'running', running,
  'pending', pending,
  'repairable_pending', repairable_pending,
  'failed_in_range', failed_in_range,
  'repaired_in_range', repaired_in_range,
  'concluded_in_range', concluded_in_range,
  'successful_in_range', successful_in_range,
  'oldest_pending_age_ms', oldest_pending_age_ms
)
from totals;
$$;

revoke execute on function public.observability_job_run_stats(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.observability_job_run_stats(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;
