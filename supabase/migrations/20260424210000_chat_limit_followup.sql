-- Follow-up to 20260424200000_chat_limit_stale_threshold.sql addressing PR
-- review (codex P1, mogplex inline comments).
--
-- Two corrections:
--
-- 1. Provisional-claim symmetry (mogplex line 82): the original function
--    filtered active chats by p_stale_threshold_seconds and provisional
--    claims by p_claim_ttl_seconds. The two defaults coincide today (300s),
--    but if a future operator tightens the stale threshold without also
--    tightening the claim TTL, provisional claims older than the new
--    liveness window would still count, recreating the same zombie-style
--    lock-out. Use LEAST() to bind them together.
--
-- 2. Backfill safety (codex P2, mogplex line 308): the prior migration's
--    hygiene UPDATE used the same 5-minute cutoff as the runtime check,
--    which would race with legitimately-streaming chats during migration
--    apply. In production the prior backfill matched zero rows because the
--    affected user was unblocked manually first, so no live data was
--    corrupted. Going forward, leave hygiene to the runtime liveness check
--    (which makes zombies invisible without needing to rewrite their row)
--    and reserve any future cleanup migrations for very conservative
--    cutoffs with row-count visibility.
--
-- Signature is unchanged so this is a pure CREATE OR REPLACE.

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
  v_active_chats INT := 0;
  v_provisional_chats INT := 0;
  v_hourly_starts INT := 0;
  v_daily_starts INT := 0;
  v_hourly_oldest TIMESTAMPTZ := NULL;
  v_daily_oldest TIMESTAMPTZ := NULL;
  v_retry_after_seconds INT := NULL;
  v_provisional_window_seconds INT := LEAST(
    p_claim_ttl_seconds,
    p_stale_threshold_seconds
  );
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('limit:chat:' || p_user_id::text));

  -- Only count chat runs that are still plausibly live. Chat streams are
  -- bounded by the serverless streaming timeout (max ~5 min on Vercel Pro),
  -- so the stale threshold applies uniformly regardless of whether the row
  -- has a conversation_id, runtime_command_id, or sandbox_record_id anchor.
  -- This matches isStaleLiveInteractiveCall in lib/interactive-runs.ts so
  -- the UI presenter and this rate-limit gate agree on what counts as live.
  -- Long-running interactive runs that *can* legitimately exceed the chat
  -- threshold use type='agent' (Trigger.dev jobs), not type='chat'.
  SELECT COUNT(*)
  INTO v_active_chats
  FROM public.ai_calls ac
  WHERE ac.user_id = p_user_id
    AND ac.type = 'chat'
    AND ac.status IN ('pending', 'streaming')
    AND ac.started_at >= p_now - make_interval(secs => p_stale_threshold_seconds);

  -- Provisional window must not exceed the stale threshold; otherwise an
  -- admitted-but-not-yet-started run could outlive its own liveness window
  -- and re-create the zombie lock-out for new chats.
  SELECT COUNT(*)
  INTO v_provisional_chats
  FROM public.limit_events le
  WHERE le.user_id = p_user_id
    AND le.route_key = 'chat'
    AND le.decision = 'allowed'
    AND le.claim_id IS NOT NULL
    AND le.created_at >= p_now - make_interval(secs => v_provisional_window_seconds)
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
        'provisional_chats', v_provisional_chats,
        'stale_threshold_seconds', p_stale_threshold_seconds,
        'provisional_window_seconds', v_provisional_window_seconds
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
