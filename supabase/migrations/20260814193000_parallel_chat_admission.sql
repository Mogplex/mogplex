-- Allow independent control chats to run in parallel. Hourly and daily start
-- quotas remain in place, but active chat rows no longer block admission.
--
-- Keep the existing function signature during the schema-first deploy so the
-- currently deployed application can continue passing the legacy liveness
-- argument until the matching application revision is live. The concurrency
-- parameters are intentionally retained as no-ops for the same compatibility.

CREATE OR REPLACE FUNCTION public.claim_chat_limit_admission(
  p_user_id UUID,
  p_repo_id UUID DEFAULT NULL,
  p_sandbox_id UUID DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_claim_id UUID DEFAULT gen_random_uuid(),
  p_concurrent_limit INT DEFAULT 2,
  p_hourly_limit INT DEFAULT 30,
  p_daily_limit INT DEFAULT 150,
  p_hourly_window_seconds INT DEFAULT 3600,
  p_daily_window_seconds INT DEFAULT 86400,
  p_concurrency_retry_after_seconds INT DEFAULT 15,
  p_claim_ttl_seconds INT DEFAULT 300,
  p_stale_threshold_seconds INT DEFAULT 300
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
  v_claim_id UUID := COALESCE(p_claim_id, gen_random_uuid());
  v_hourly_starts INT := 0;
  v_daily_starts INT := 0;
  v_hourly_oldest TIMESTAMPTZ := NULL;
  v_daily_oldest TIMESTAMPTZ := NULL;
  v_retry_after_seconds INT := NULL;
BEGIN
  -- Serialize each user's quota check and claim insertion. This guards the
  -- start-rate quotas without serializing or capping the admitted runs.
  PERFORM pg_advisory_xact_lock(hashtext('limit:chat:' || p_user_id::text));

  SELECT COUNT(*), MIN(le.created_at)
  INTO v_hourly_starts, v_hourly_oldest
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'chat'
    AND le.decision = 'allowed'
    AND le.created_at >= p_now - make_interval(secs => p_hourly_window_seconds);

  IF v_hourly_starts >= p_hourly_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_hourly_oldest + make_interval(secs => p_hourly_window_seconds)) - p_now)))::INT
    );

    INSERT INTO public.limit_events (
      user_id,
      route_key,
      resource_id,
      repo_id,
      sandbox_id,
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
      'chat',
      COALESCE(p_sandbox_id::TEXT, p_repo_id::TEXT),
      p_repo_id,
      p_sandbox_id,
      'denied',
      'chat_hourly_rate_exceeded',
      'chat_starts_per_hour',
      p_hourly_window_seconds,
      p_hourly_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object('hourly_starts', v_hourly_starts)
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'chat_rate_limited'::TEXT,
      'Chat rate limit exceeded'::TEXT,
      'chat_hourly_rate_exceeded'::TEXT,
      v_retry_after_seconds,
      'chat_starts_per_hour'::TEXT,
      p_hourly_limit,
      p_hourly_window_seconds;
    RETURN;
  END IF;

  SELECT COUNT(*), MIN(le.created_at)
  INTO v_daily_starts, v_daily_oldest
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'chat'
    AND le.decision = 'allowed'
    AND le.created_at >= p_now - make_interval(secs => p_daily_window_seconds);

  IF v_daily_starts >= p_daily_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_daily_oldest + make_interval(secs => p_daily_window_seconds)) - p_now)))::INT
    );

    INSERT INTO public.limit_events (
      user_id,
      route_key,
      resource_id,
      repo_id,
      sandbox_id,
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
      'chat',
      COALESCE(p_sandbox_id::TEXT, p_repo_id::TEXT),
      p_repo_id,
      p_sandbox_id,
      'denied',
      'chat_daily_quota_exceeded',
      'chat_starts_per_day',
      p_daily_window_seconds,
      p_daily_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object('daily_starts', v_daily_starts)
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'chat_rate_limited'::TEXT,
      'Daily chat quota exceeded'::TEXT,
      'chat_daily_quota_exceeded'::TEXT,
      v_retry_after_seconds,
      'chat_starts_per_day'::TEXT,
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
    sandbox_id,
    decision,
    metadata
  ) VALUES (
    p_user_id,
    'chat',
    v_claim_id,
    COALESCE(p_sandbox_id::TEXT, p_repo_id::TEXT),
    p_repo_id,
    p_sandbox_id,
    'allowed',
    jsonb_build_object(
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

-- Replacing a SECURITY DEFINER RPC preserves current privileges, but fresh
-- schemas and future restore paths must not inherit PostgreSQL's default
-- PUBLIC execute grant. Keep this service-role-only boundary local to every
-- migration that touches the function.
REVOKE ALL ON FUNCTION public.claim_chat_limit_admission(
  UUID, UUID, UUID, TIMESTAMPTZ, UUID, INT, INT, INT, INT, INT, INT, INT, INT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_limit_admission(
  UUID, UUID, UUID, TIMESTAMPTZ, UUID, INT, INT, INT, INT, INT, INT, INT, INT
) TO service_role;
