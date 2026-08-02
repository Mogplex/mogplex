ALTER TABLE public.limit_events
  ADD COLUMN IF NOT EXISTS claim_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_limit_events_claim_id
  ON public.limit_events (claim_id)
  WHERE claim_id IS NOT NULL;

ALTER TABLE public.ai_calls
  ADD COLUMN IF NOT EXISTS limit_claim_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_calls_limit_claim_id
  ON public.ai_calls (limit_claim_id)
  WHERE limit_claim_id IS NOT NULL;

ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS limit_claim_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sandboxes_limit_claim_id
  ON public.sandboxes (limit_claim_id)
  WHERE limit_claim_id IS NOT NULL;

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
  p_claim_ttl_seconds INT DEFAULT 300
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
  v_active_chats INT := 0;
  v_provisional_chats INT := 0;
  v_hourly_starts INT := 0;
  v_daily_starts INT := 0;
  v_hourly_oldest TIMESTAMPTZ := NULL;
  v_daily_oldest TIMESTAMPTZ := NULL;
  v_retry_after_seconds INT := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('limit:chat:' || p_user_id::text));

  SELECT COUNT(*)
  INTO v_active_chats
  FROM public.ai_calls ac
  WHERE ac.user_id = p_user_id
    AND ac.type = 'chat'
    AND ac.status IN ('pending', 'streaming');

  SELECT COUNT(*)
  INTO v_provisional_chats
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'chat'
    AND le.decision = 'allowed'
    AND le.claim_id IS NOT NULL
    AND le.created_at >= p_now - make_interval(secs => p_claim_ttl_seconds)
    AND NOT EXISTS (
      SELECT 1
      FROM public.ai_calls ac
      WHERE ac.limit_claim_id = le.claim_id
    );

  IF v_active_chats + v_provisional_chats >= p_concurrent_limit THEN
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
      'concurrent_chat_runs_exceeded',
      'concurrent_chat_runs',
      0,
      p_concurrent_limit,
      GREATEST(p_concurrent_limit - (v_active_chats + v_provisional_chats), 0),
      p_concurrency_retry_after_seconds,
      jsonb_build_object(
        'active_chats', v_active_chats,
        'provisional_chats', v_provisional_chats
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'chat_rate_limited'::TEXT,
      'Too many active chat runs'::TEXT,
      'concurrent_chat_runs_exceeded'::TEXT,
      p_concurrency_retry_after_seconds,
      'concurrent_chat_runs'::TEXT,
      p_concurrent_limit,
      0;
    RETURN;
  END IF;

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
      jsonb_build_object(
        'active_chats', v_active_chats,
        'provisional_chats', v_provisional_chats,
        'hourly_starts', v_hourly_starts
      )
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
      jsonb_build_object(
        'active_chats', v_active_chats,
        'provisional_chats', v_provisional_chats,
        'daily_starts', v_daily_starts
      )
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
      'active_chats', v_active_chats,
      'provisional_chats', v_provisional_chats,
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

REVOKE ALL ON FUNCTION public.claim_chat_limit_admission(UUID, UUID, UUID, TIMESTAMPTZ, UUID, INT, INT, INT, INT, INT, INT, INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_sandbox_boot_limit_admission(
  p_user_id UUID,
  p_repo_id UUID,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_claim_id UUID DEFAULT gen_random_uuid(),
  p_active_limit INT DEFAULT 2,
  p_hourly_limit INT DEFAULT 5,
  p_daily_limit INT DEFAULT 20,
  p_hourly_window_seconds INT DEFAULT 3600,
  p_daily_window_seconds INT DEFAULT 86400,
  p_concurrency_retry_after_seconds INT DEFAULT 15,
  p_claim_ttl_seconds INT DEFAULT 300
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
  v_active_sandboxes INT := 0;
  v_provisional_boots INT := 0;
  v_hourly_boots INT := 0;
  v_daily_boots INT := 0;
  v_hourly_oldest TIMESTAMPTZ := NULL;
  v_daily_oldest TIMESTAMPTZ := NULL;
  v_retry_after_seconds INT := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('limit:sandbox_boot:' || p_user_id::text));

  SELECT COUNT(*)
  INTO v_active_sandboxes
  FROM public.sandboxes s
  WHERE s.user_id = p_user_id
    AND s.status IN ('creating', 'installing', 'running');

  SELECT COUNT(*)
  INTO v_provisional_boots
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'sandbox_boot'
    AND le.decision = 'allowed'
    AND le.claim_id IS NOT NULL
    AND le.created_at >= p_now - make_interval(secs => p_claim_ttl_seconds)
    AND NOT EXISTS (
      SELECT 1
      FROM public.sandboxes s
      WHERE s.limit_claim_id = le.claim_id
    );

  IF v_active_sandboxes + v_provisional_boots >= p_active_limit THEN
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
      'sandbox_boot',
      p_repo_id::TEXT,
      p_repo_id,
      'denied',
      'active_sandbox_limit_exceeded',
      'active_sandboxes',
      0,
      p_active_limit,
      GREATEST(p_active_limit - (v_active_sandboxes + v_provisional_boots), 0),
      p_concurrency_retry_after_seconds,
      jsonb_build_object(
        'active_sandboxes', v_active_sandboxes,
        'provisional_boots', v_provisional_boots
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'sandbox_boot_rate_limited'::TEXT,
      'Too many active sandboxes'::TEXT,
      'active_sandbox_limit_exceeded'::TEXT,
      p_concurrency_retry_after_seconds,
      'active_sandboxes'::TEXT,
      p_active_limit,
      0;
    RETURN;
  END IF;

  SELECT COUNT(*), MIN(le.created_at)
  INTO v_hourly_boots, v_hourly_oldest
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'sandbox_boot'
    AND le.decision = 'allowed'
    AND le.created_at >= p_now - make_interval(secs => p_hourly_window_seconds);

  IF v_hourly_boots >= p_hourly_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_hourly_oldest + make_interval(secs => p_hourly_window_seconds)) - p_now)))::INT
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
      'sandbox_boot',
      p_repo_id::TEXT,
      p_repo_id,
      'denied',
      'sandbox_boot_hourly_rate_exceeded',
      'sandbox_boots_per_hour',
      p_hourly_window_seconds,
      p_hourly_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object(
        'active_sandboxes', v_active_sandboxes,
        'provisional_boots', v_provisional_boots,
        'hourly_boots', v_hourly_boots
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'sandbox_boot_rate_limited'::TEXT,
      'Sandbox boot rate limit exceeded'::TEXT,
      'sandbox_boot_hourly_rate_exceeded'::TEXT,
      v_retry_after_seconds,
      'sandbox_boots_per_hour'::TEXT,
      p_hourly_limit,
      p_hourly_window_seconds;
    RETURN;
  END IF;

  SELECT COUNT(*), MIN(le.created_at)
  INTO v_daily_boots, v_daily_oldest
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'sandbox_boot'
    AND le.decision = 'allowed'
    AND le.created_at >= p_now - make_interval(secs => p_daily_window_seconds);

  IF v_daily_boots >= p_daily_limit THEN
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_daily_oldest + make_interval(secs => p_daily_window_seconds)) - p_now)))::INT
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
      'sandbox_boot',
      p_repo_id::TEXT,
      p_repo_id,
      'denied',
      'sandbox_boot_daily_quota_exceeded',
      'sandbox_boots_per_day',
      p_daily_window_seconds,
      p_daily_limit,
      0,
      v_retry_after_seconds,
      jsonb_build_object(
        'active_sandboxes', v_active_sandboxes,
        'provisional_boots', v_provisional_boots,
        'daily_boots', v_daily_boots
      )
    );

    RETURN QUERY SELECT
      FALSE,
      NULL::UUID,
      'sandbox_boot_rate_limited'::TEXT,
      'Daily sandbox boot quota exceeded'::TEXT,
      'sandbox_boot_daily_quota_exceeded'::TEXT,
      v_retry_after_seconds,
      'sandbox_boots_per_day'::TEXT,
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
    'sandbox_boot',
    v_claim_id,
    p_repo_id::TEXT,
    p_repo_id,
    'allowed',
    jsonb_build_object(
      'active_sandboxes', v_active_sandboxes,
      'provisional_boots', v_provisional_boots,
      'hourly_boots', v_hourly_boots + 1,
      'daily_boots', v_daily_boots + 1
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

REVOKE ALL ON FUNCTION public.claim_sandbox_boot_limit_admission(UUID, UUID, TIMESTAMPTZ, UUID, INT, INT, INT, INT, INT, INT, INT) FROM PUBLIC;
