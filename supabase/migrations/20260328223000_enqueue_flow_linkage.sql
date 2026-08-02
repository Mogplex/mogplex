CREATE OR REPLACE FUNCTION public.enqueue_automation_job_run(
  p_user_id UUID,
  p_assignment_id UUID DEFAULT NULL,
  p_trigger_id UUID DEFAULT NULL,
  p_retry_of_job_run_id UUID DEFAULT NULL,
  p_flow_id UUID DEFAULT NULL,
  p_flow_version_id UUID DEFAULT NULL,
  p_repo_id UUID DEFAULT NULL,
  p_installation_id BIGINT DEFAULT NULL,
  p_source_kind TEXT DEFAULT 'assignment',
  p_source_type TEXT DEFAULT 'unknown',
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_duplicate_sensitive BOOLEAN DEFAULT FALSE,
  p_max_active_per_repo INT DEFAULT 25,
  p_max_active_per_installation INT DEFAULT 100
)
RETURNS TABLE (
  job_run_id UUID,
  outcome TEXT,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_run_id UUID;
  v_repo_active INT := 0;
  v_installation_active INT := 0;
  v_duplicate_exists BOOLEAN := FALSE;
BEGIN
  IF p_source_kind NOT IN ('assignment', 'trigger', 'manual_retry') THEN
    RAISE EXCEPTION 'Invalid source_kind: %', p_source_kind;
  END IF;

  IF p_repo_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('enqueue_repo:' || p_repo_id::text));
  END IF;

  IF p_installation_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('enqueue_installation:' || p_installation_id::text));
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT jr.id
    INTO v_job_run_id
    FROM public.job_runs jr
    WHERE jr.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_job_run_id IS NOT NULL THEN
      INSERT INTO public.automation_dispatch_events (
        user_id, job_run_id, assignment_id, trigger_id, repo_id, installation_id,
        source_kind, source_type, event_kind, outcome, reason, metadata
      ) VALUES (
        p_user_id, v_job_run_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
        p_source_kind, p_source_type, 'enqueue', 'suppressed', 'IDEMPOTENT_DUPLICATE', COALESCE(p_metadata, '{}'::jsonb)
      );

      RETURN QUERY SELECT v_job_run_id, 'suppressed'::TEXT, 'IDEMPOTENT_DUPLICATE'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF p_duplicate_sensitive THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.job_runs jr
      LEFT JOIN public.assignments a
        ON a.id = jr.assignment_id
      LEFT JOIN public.repos r
        ON r.id = a.repo_id
      WHERE jr.status IN ('pending', 'running')
        AND (
          (p_assignment_id IS NOT NULL AND jr.assignment_id = p_assignment_id)
          OR (p_trigger_id IS NOT NULL AND jr.trigger_id = p_trigger_id)
        )
        AND COALESCE(NULLIF(jr.metadata->>'source_type', ''), '') = p_source_type
        AND (
          p_repo_id IS NULL
          OR COALESCE(r.id, NULLIF(jr.metadata->>'repo_id', '')::UUID) IS NOT DISTINCT FROM p_repo_id
        )
    ) INTO v_duplicate_exists;

    IF v_duplicate_exists THEN
      INSERT INTO public.automation_dispatch_events (
        user_id, assignment_id, trigger_id, repo_id, installation_id,
        source_kind, source_type, event_kind, outcome, reason, metadata
      ) VALUES (
        p_user_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
        p_source_kind, p_source_type, 'enqueue', 'suppressed', 'ACTIVE_DUPLICATE', COALESCE(p_metadata, '{}'::jsonb)
      );

      RETURN QUERY SELECT NULL::UUID, 'suppressed'::TEXT, 'ACTIVE_DUPLICATE'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF p_repo_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_repo_active
    FROM public.job_runs jr
    LEFT JOIN public.assignments a
      ON a.id = jr.assignment_id
    LEFT JOIN public.repos r
      ON r.id = a.repo_id
    WHERE jr.status IN ('pending', 'running')
      AND COALESCE(r.id, NULLIF(jr.metadata->>'repo_id', '')::UUID) = p_repo_id;

    IF v_repo_active >= p_max_active_per_repo THEN
      INSERT INTO public.automation_dispatch_events (
        user_id, assignment_id, trigger_id, repo_id, installation_id,
        source_kind, source_type, event_kind, outcome, reason, metadata
      ) VALUES (
        p_user_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
        p_source_kind, p_source_type, 'enqueue', 'suppressed', 'REPO_PENDING_LIMIT', COALESCE(p_metadata, '{}'::jsonb)
      );

      RETURN QUERY SELECT NULL::UUID, 'suppressed'::TEXT, 'REPO_PENDING_LIMIT'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF p_installation_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_installation_active
    FROM public.job_runs jr
    LEFT JOIN public.assignments a
      ON a.id = jr.assignment_id
    LEFT JOIN public.repos r
      ON r.id = a.repo_id
    LEFT JOIN public.triggers t
      ON t.id = jr.trigger_id
    WHERE jr.status IN ('pending', 'running')
      AND COALESCE(
        t.installation_id::BIGINT,
        r.github_installation_id::BIGINT,
        NULLIF(jr.metadata->>'installation_id', '')::BIGINT
      ) = p_installation_id;

    IF v_installation_active >= p_max_active_per_installation THEN
      INSERT INTO public.automation_dispatch_events (
        user_id, assignment_id, trigger_id, repo_id, installation_id,
        source_kind, source_type, event_kind, outcome, reason, metadata
      ) VALUES (
        p_user_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
        p_source_kind, p_source_type, 'enqueue', 'suppressed', 'INSTALLATION_PENDING_LIMIT', COALESCE(p_metadata, '{}'::jsonb)
      );

      RETURN QUERY SELECT NULL::UUID, 'suppressed'::TEXT, 'INSTALLATION_PENDING_LIMIT'::TEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.job_runs (
    assignment_id,
    trigger_id,
    retry_of_job_run_id,
    flow_id,
    flow_version_id,
    status,
    metadata,
    idempotency_key
  ) VALUES (
    p_assignment_id,
    p_trigger_id,
    p_retry_of_job_run_id,
    p_flow_id,
    p_flow_version_id,
    'pending',
    COALESCE(p_metadata, '{}'::jsonb),
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_job_run_id;

  IF v_job_run_id IS NULL THEN
    SELECT jr.id
    INTO v_job_run_id
    FROM public.job_runs jr
    WHERE jr.idempotency_key = p_idempotency_key
    LIMIT 1;

    INSERT INTO public.automation_dispatch_events (
      user_id, job_run_id, assignment_id, trigger_id, repo_id, installation_id,
      source_kind, source_type, event_kind, outcome, reason, metadata
    ) VALUES (
      p_user_id, v_job_run_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
      p_source_kind, p_source_type, 'enqueue', 'suppressed', 'IDEMPOTENT_DUPLICATE', COALESCE(p_metadata, '{}'::jsonb)
    );

    RETURN QUERY SELECT v_job_run_id, 'suppressed'::TEXT, 'IDEMPOTENT_DUPLICATE'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.automation_dispatch_events (
    user_id, job_run_id, assignment_id, trigger_id, repo_id, installation_id,
    source_kind, source_type, event_kind, outcome, metadata
  ) VALUES (
    p_user_id, v_job_run_id, p_assignment_id, p_trigger_id, p_repo_id, p_installation_id,
    p_source_kind, p_source_type, 'enqueue', 'queued', COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY SELECT v_job_run_id, 'queued'::TEXT, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_job_run(
  UUID,
  UUID,
  UUID,
  UUID,
  UUID,
  UUID,
  UUID,
  BIGINT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  BOOLEAN,
  INT,
  INT
) FROM PUBLIC;
