ALTER TABLE public.limit_events
  ADD COLUMN IF NOT EXISTS resource_id TEXT;

CREATE INDEX IF NOT EXISTS idx_limit_events_external_agent_run_resource_created
  ON public.limit_events (user_id, route_key, resource_id, created_at DESC)
  WHERE route_key = 'external_agent_run'
    AND decision = 'allowed'
    AND resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_external_agent_run_limit_admission(
  p_user_id UUID,
  p_api_key_id TEXT,
  p_repo_id UUID DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_claim_id UUID DEFAULT gen_random_uuid(),
  p_minutely_limit INT DEFAULT 10,
  p_hourly_limit INT DEFAULT 30,
  p_daily_limit INT DEFAULT 150,
  p_minutely_window_seconds INT DEFAULT 60,
  p_hourly_window_seconds INT DEFAULT 3600,
  p_daily_window_seconds INT DEFAULT 86400
)
RETURNS TABLE (
  allowed BOOLEAN,
  claim_id UUID,
  code TEXT,
  error TEXT,
  reason TEXT,
  retry_after_seconds INT,
  limit_name TEXT,
  limit_value INT,
  window_seconds INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id UUID := p_claim_id;
  v_effective_now TIMESTAMPTZ := GREATEST(p_now, now());
  v_minutely_starts INT := 0;
  v_hourly_starts INT := 0;
  v_daily_starts INT := 0;
  v_minutely_oldest TIMESTAMPTZ := NULL;
  v_hourly_oldest TIMESTAMPTZ := NULL;
  v_daily_oldest TIMESTAMPTZ := NULL;
  v_retry_after_seconds INT := NULL;
BEGIN
  -- NOTE: hashtext is 32-bit; unrelated user/key pairs can theoretically
  -- share lock contention (~1 in 2^31 per pair), but never corrupt counts.
  -- user_api_keys.id is a UUID, so ':' cannot alias lock-key components.
  PERFORM pg_advisory_xact_lock(
    hashtext('limit:external_agent_run:' || p_user_id::text || ':' || p_api_key_id)
  );

  SELECT
    COUNT(*) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_minutely_window_seconds)
    ),
    MIN(le.created_at) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_minutely_window_seconds)
    ),
    COUNT(*) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_hourly_window_seconds)
    ),
    MIN(le.created_at) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_hourly_window_seconds)
    ),
    COUNT(*) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_daily_window_seconds)
    ),
    MIN(le.created_at) FILTER (
      WHERE le.created_at >= v_effective_now - make_interval(secs => p_daily_window_seconds)
    )
  INTO
    v_minutely_starts,
    v_minutely_oldest,
    v_hourly_starts,
    v_hourly_oldest,
    v_daily_starts,
    v_daily_oldest
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'external_agent_run'
    AND le.resource_id = p_api_key_id
    AND le.decision = 'allowed'
    AND le.created_at <= v_effective_now
    AND le.created_at >= v_effective_now - make_interval(secs => GREATEST(
      p_minutely_window_seconds,
      p_hourly_window_seconds,
      p_daily_window_seconds
    ));

  IF v_minutely_starts >= p_minutely_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_minutely_oldest + make_interval(secs => p_minutely_window_seconds)) - v_effective_now)))::INT
    );

    INSERT INTO public.limit_events (
      user_id,
      route_key,
      resource_id,
      repo_id,
      decision,
      reason,
      limit_name,
      window_seconds,
      limit_value,
      remaining,
      retry_after_seconds,
      metadata
    ) VALUES (
      p_user_id,
      'external_agent_run',
      p_api_key_id,
      p_repo_id,
      'denied',
      'external_agent_run_minutely_rate_exceeded',
      'external_agent_runs_per_minute',
      p_minutely_window_seconds,
      p_minutely_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object(
        'api_key_id', p_api_key_id,
        'minutely_starts', v_minutely_starts
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'external_agent_run_rate_limited'::TEXT,
      'External Mogplex run rate limit exceeded'::TEXT,
      'external_agent_run_minutely_rate_exceeded'::TEXT,
      v_retry_after_seconds,
      'external_agent_runs_per_minute'::TEXT,
      p_minutely_limit,
      p_minutely_window_seconds;
    RETURN;
  END IF;

  IF v_hourly_starts >= p_hourly_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_hourly_oldest + make_interval(secs => p_hourly_window_seconds)) - v_effective_now)))::INT
    );

    INSERT INTO public.limit_events (
      user_id,
      route_key,
      resource_id,
      repo_id,
      decision,
      reason,
      limit_name,
      window_seconds,
      limit_value,
      remaining,
      retry_after_seconds,
      metadata
    ) VALUES (
      p_user_id,
      'external_agent_run',
      p_api_key_id,
      p_repo_id,
      'denied',
      'external_agent_run_hourly_rate_exceeded',
      'external_agent_runs_per_hour',
      p_hourly_window_seconds,
      p_hourly_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object(
        'api_key_id', p_api_key_id,
        'minutely_starts', v_minutely_starts,
        'hourly_starts', v_hourly_starts
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'external_agent_run_rate_limited'::TEXT,
      'External Mogplex run rate limit exceeded'::TEXT,
      'external_agent_run_hourly_rate_exceeded'::TEXT,
      v_retry_after_seconds,
      'external_agent_runs_per_hour'::TEXT,
      p_hourly_limit,
      p_hourly_window_seconds;
    RETURN;
  END IF;

  IF v_daily_starts >= p_daily_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_daily_oldest + make_interval(secs => p_daily_window_seconds)) - v_effective_now)))::INT
    );

    INSERT INTO public.limit_events (
      user_id,
      route_key,
      resource_id,
      repo_id,
      decision,
      reason,
      limit_name,
      window_seconds,
      limit_value,
      remaining,
      retry_after_seconds,
      metadata
    ) VALUES (
      p_user_id,
      'external_agent_run',
      p_api_key_id,
      p_repo_id,
      'denied',
      'external_agent_run_daily_quota_exceeded',
      'external_agent_runs_per_day',
      p_daily_window_seconds,
      p_daily_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object(
        'api_key_id', p_api_key_id,
        'minutely_starts', v_minutely_starts,
        'hourly_starts', v_hourly_starts,
        'daily_starts', v_daily_starts
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'external_agent_run_rate_limited'::TEXT,
      'Daily external Mogplex run quota exceeded'::TEXT,
      'external_agent_run_daily_quota_exceeded'::TEXT,
      v_retry_after_seconds,
      'external_agent_runs_per_day'::TEXT,
      p_daily_limit,
      p_daily_window_seconds;
    RETURN;
  END IF;

  INSERT INTO public.limit_events (
    user_id,
    route_key,
    claim_id,
    resource_id,
    repo_id,
    decision,
    metadata
  ) VALUES (
    p_user_id,
    'external_agent_run',
    v_claim_id,
    p_api_key_id,
    p_repo_id,
    'allowed',
    jsonb_build_object(
      'api_key_id', p_api_key_id,
      'minutely_starts', v_minutely_starts + 1,
      'hourly_starts', v_hourly_starts + 1,
      'daily_starts', v_daily_starts + 1
    )
  );

  RETURN QUERY SELECT
    TRUE,
    v_claim_id,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    NULL::INT,
    NULL::TEXT,
    NULL::INT,
    NULL::INT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_external_agent_run_limit_admission(
  UUID,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID,
  INT,
  INT,
  INT,
  INT,
  INT,
  INT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_external_agent_run_limit_admission(
  UUID,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID,
  INT,
  INT,
  INT,
  INT,
  INT,
  INT
) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_ai_call_metadata(
  p_user_id UUID,
  p_ai_call_id UUID,
  p_metadata_patch JSONB
)
RETURNS SETOF public.ai_calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_calls ac
  SET metadata = COALESCE(ac.metadata, '{}'::jsonb) || COALESCE(p_metadata_patch, '{}'::jsonb)
  WHERE ac.id = p_ai_call_id
    AND ac.user_id = p_user_id
  RETURNING ac.*;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_ai_call_metadata(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_ai_call_metadata(UUID, UUID, JSONB) TO service_role;
