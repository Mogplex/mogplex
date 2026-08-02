-- Aggregate RPCs for the observability stats and agent roster summary routes.
--
-- Why RPCs: PostgREST aggregate functions are disabled on this project
-- (select("cost_usd.sum()") returns PGRST123), so both routes previously
-- pulled up to 10,000 raw rows and aggregated in JS. That undercounts as soon
-- as a window holds more rows than the cap (see sum_ai_call_costs for the
-- same rationale). These functions aggregate in Postgres with no row cap and
-- collapse the stats route's row-set queries into one round trip.
--
-- agent_roster_summary also fixes a schema mismatch: the route filtered
-- job_runs by user_id/agent_id, but job_runs has neither column — the query
-- 500ed and the roster pane's health badges silently rendered empty. Agent
-- and user attribution actually flow through assignments (repo -> user,
-- agent_id) and triggers (user_id, agent_id); ai_calls attach via job_run_id.

CREATE OR REPLACE FUNCTION public.observability_stats_snapshot(
  p_user_id uuid,
  p_calls_from timestamptz,
  p_calls_to timestamptz,
  p_today_start timestamptz,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_now timestamptz,
  p_reconciliation_stale_before timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH call_rows AS (
  SELECT
    -- Mirrors readObservedTokenTotal in the stats route: prefer the token
    -- breakdown when any component is present, else fall back to the total.
    CASE WHEN input_tokens IS NOT NULL
           OR output_tokens IS NOT NULL
           OR cache_read_input_tokens IS NOT NULL
           OR cache_creation_input_tokens IS NOT NULL
      THEN COALESCE(input_tokens, 0)
           + COALESCE(cache_read_input_tokens, 0)
           + COALESCE(cache_creation_input_tokens, 0)
           + COALESCE(output_tokens, 0)
      ELSE COALESCE(total_tokens, 0)
    END AS observed_tokens,
    duration_ms,
    status,
    model,
    type,
    cost_usd
  FROM ai_calls
  WHERE user_id = p_user_id
    AND (p_calls_from IS NULL OR started_at >= p_calls_from)
    AND (p_calls_to IS NULL OR started_at <= p_calls_to)
),
call_totals AS (
  SELECT
    COUNT(*)::bigint AS total_calls,
    COALESCE(SUM(observed_tokens), 0)::bigint AS total_tokens,
    COUNT(*) FILTER (WHERE status = 'success')::bigint AS success_calls,
    AVG(duration_ms) AS avg_duration_ms,
    COALESCE(SUM(cost_usd) FILTER (WHERE cost_usd IS NOT NULL), 0) AS known_cost_usd
  FROM call_rows
),
by_model AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('model', model, 'count', cnt, 'tokens', tokens)
      ORDER BY cnt DESC
    ),
    '[]'::jsonb
  ) AS v
  FROM (
    SELECT model, COUNT(*)::bigint AS cnt,
           COALESCE(SUM(observed_tokens), 0)::bigint AS tokens
    FROM call_rows
    GROUP BY model
  ) grouped
),
by_type AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('type', type, 'count', cnt)
      ORDER BY cnt DESC
    ),
    '[]'::jsonb
  ) AS v
  FROM (
    SELECT type, COUNT(*)::bigint AS cnt
    FROM call_rows
    GROUP BY type
  ) grouped
),
today AS (
  SELECT
    COUNT(*)::bigint AS calls,
    COALESCE(SUM(
      CASE WHEN input_tokens IS NOT NULL
             OR output_tokens IS NOT NULL
             OR cache_read_input_tokens IS NOT NULL
             OR cache_creation_input_tokens IS NOT NULL
        THEN COALESCE(input_tokens, 0)
             + COALESCE(cache_read_input_tokens, 0)
             + COALESCE(cache_creation_input_tokens, 0)
             + COALESCE(output_tokens, 0)
        ELSE COALESCE(total_tokens, 0)
      END
    ), 0)::bigint AS tokens,
    COALESCE(SUM(cost_usd) FILTER (WHERE cost_usd IS NOT NULL), 0) AS known_cost_usd
  FROM ai_calls
  WHERE user_id = p_user_id
    AND started_at >= p_today_start
),
sandbox AS (
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE status = 'running')::bigint AS active,
    -- Only the slice of each sandbox's lifetime that overlaps the selected
    -- window counts, so long-lived sandboxes don't dominate narrow ranges.
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(
        CASE WHEN status = 'running' THEN p_now
             ELSE COALESCE(last_active_at, created_at)
        END,
        COALESCE(p_window_end, p_now)
      )
      - GREATEST(created_at, p_window_start)
    )) * 1000)), 0)::bigint AS window_time_ms
  FROM sandboxes
  WHERE user_id = p_user_id
),
dispatch AS (
  SELECT
    COUNT(*) FILTER (WHERE outcome = 'suppressed')::bigint AS suppressed,
    COUNT(*) FILTER (WHERE outcome = 'deferred')::bigint AS deferred,
    COUNT(*) FILTER (WHERE outcome = 'start_failed')::bigint AS start_failed
  FROM automation_dispatch_events
  WHERE user_id = p_user_id
    AND created_at >= p_window_start
    AND (p_window_end IS NULL OR created_at <= p_window_end)
),
limit_rows AS (
  SELECT decision, route_key
  FROM limit_events
  WHERE user_id = p_user_id
    AND created_at >= p_window_start
    AND (p_window_end IS NULL OR created_at <= p_window_end)
),
limit_totals AS (
  SELECT
    COUNT(*) FILTER (WHERE decision = 'allowed')::bigint AS allowed,
    COUNT(*) FILTER (WHERE decision = 'denied')::bigint AS denied
  FROM limit_rows
),
limits_by_route AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('route_key', route_key, 'allowed', allowed, 'denied', denied)
      ORDER BY allowed + denied DESC
    ),
    '[]'::jsonb
  ) AS v
  FROM (
    SELECT route_key,
           COUNT(*) FILTER (WHERE decision = 'allowed')::bigint AS allowed,
           COUNT(*) FILTER (WHERE decision = 'denied')::bigint AS denied
    FROM limit_rows
    GROUP BY route_key
  ) grouped
),
reconciliation AS (
  -- completed_at IS NULL keeps in-flight calls in the pending count;
  -- NULL < timestamp would otherwise silently drop them.
  SELECT COUNT(*)::bigint AS pending
  FROM ai_calls
  WHERE user_id = p_user_id
    AND gateway_generation_id IS NOT NULL
    AND cost_source IS DISTINCT FROM 'gateway'
    AND (completed_at < p_reconciliation_stale_before OR completed_at IS NULL)
)
SELECT jsonb_build_object(
  'calls', jsonb_build_object(
    'total', call_totals.total_calls,
    'total_tokens', call_totals.total_tokens,
    'success', call_totals.success_calls,
    'avg_duration_ms', call_totals.avg_duration_ms,
    'known_cost_usd', call_totals.known_cost_usd,
    'by_model', by_model.v,
    'by_type', by_type.v
  ),
  'today', jsonb_build_object(
    'calls', today.calls,
    'tokens', today.tokens,
    'known_cost_usd', today.known_cost_usd
  ),
  'sandboxes', jsonb_build_object(
    'total', sandbox.total,
    'active', sandbox.active,
    'window_time_ms', sandbox.window_time_ms
  ),
  'dispatch', jsonb_build_object(
    'suppressed', dispatch.suppressed,
    'deferred', dispatch.deferred,
    'start_failed', dispatch.start_failed
  ),
  'limits', jsonb_build_object(
    'allowed', limit_totals.allowed,
    'denied', limit_totals.denied,
    'by_route', limits_by_route.v
  ),
  'reconciliation_pending', reconciliation.pending
)
FROM call_totals, by_model, by_type, today, sandbox, dispatch,
     limit_totals, limits_by_route, reconciliation;
$$;

REVOKE EXECUTE ON FUNCTION public.observability_stats_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observability_stats_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.agent_roster_summary(
  p_user_id uuid,
  p_since timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH run_agents AS (
  SELECT jr.status,
         COALESCE(a.agent_id, t.agent_id) AS agent_id
  FROM job_runs jr
  LEFT JOIN assignments a ON a.id = jr.assignment_id
  LEFT JOIN repos ar ON ar.id = a.repo_id
  LEFT JOIN triggers t ON t.id = jr.trigger_id
  WHERE jr.created_at >= p_since
    AND COALESCE(ar.user_id, t.user_id) = p_user_id
    AND COALESCE(a.agent_id, t.agent_id) IS NOT NULL
),
runs AS (
  SELECT agent_id,
         COUNT(*)::bigint AS runs,
         COUNT(*) FILTER (WHERE status = 'success')::bigint AS succeeded,
         COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
         COUNT(*) FILTER (WHERE status = 'suppressed')::bigint AS suppressed
  FROM run_agents
  GROUP BY agent_id
),
tokens AS (
  SELECT COALESCE(a.agent_id, t.agent_id) AS agent_id,
         COALESCE(SUM(c.total_tokens), 0)::bigint AS tokens
  FROM ai_calls c
  JOIN job_runs jr ON jr.id = c.job_run_id
  LEFT JOIN assignments a ON a.id = jr.assignment_id
  LEFT JOIN triggers t ON t.id = jr.trigger_id
  WHERE c.user_id = p_user_id
    AND c.started_at >= p_since
    AND COALESCE(a.agent_id, t.agent_id) IS NOT NULL
  GROUP BY 1
)
SELECT COALESCE(
  jsonb_object_agg(
    agent_id::text,
    jsonb_build_object(
      'agentId', agent_id::text,
      'runs24h', COALESCE(r.runs, 0),
      'succeeded', COALESCE(r.succeeded, 0),
      'failed', COALESCE(r.failed, 0),
      'suppressed', COALESCE(r.suppressed, 0),
      'tokens24h', COALESCE(tk.tokens, 0)
    )
  ),
  '{}'::jsonb
)
FROM runs r
FULL OUTER JOIN tokens tk USING (agent_id);
$$;

REVOKE EXECUTE ON FUNCTION public.agent_roster_summary(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_roster_summary(uuid, timestamptz) TO service_role;
