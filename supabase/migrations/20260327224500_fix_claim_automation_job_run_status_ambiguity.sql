CREATE OR REPLACE FUNCTION public.claim_automation_job_run(
  p_job_run_id UUID,
  p_repo_id UUID DEFAULT NULL,
  p_installation_id BIGINT DEFAULT NULL,
  p_claimed_at TIMESTAMPTZ DEFAULT now(),
  p_max_running_per_repo INT DEFAULT 2,
  p_max_running_per_installation INT DEFAULT 8
)
RETURNS TABLE (
  claimed BOOLEAN,
  status TEXT,
  reason TEXT,
  started_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_repo_running INT := 0;
  v_installation_running INT := 0;
BEGIN
  IF p_repo_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('job_repo:' || p_repo_id::text));
  END IF;

  IF p_installation_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('job_installation:' || p_installation_id::text));
  END IF;

  SELECT jr.status
  INTO v_status
  FROM public.job_runs jr
  WHERE jr.id = p_job_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, 'JOB_NOT_FOUND'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT false, v_status, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_repo_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_repo_running
    FROM public.job_runs jr
    LEFT JOIN public.assignments a
      ON a.id = jr.assignment_id
    LEFT JOIN public.repos r
      ON r.id = a.repo_id
    LEFT JOIN public.triggers t
      ON t.id = jr.trigger_id
    WHERE jr.status = 'running'
      AND jr.id <> p_job_run_id
      AND COALESCE(r.id, NULLIF(jr.metadata->>'repo_id', '')::UUID) = p_repo_id;

    IF v_repo_running >= p_max_running_per_repo THEN
      RETURN QUERY SELECT false, 'pending'::TEXT, 'REPO_CONCURRENCY_LIMIT'::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  IF p_installation_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_installation_running
    FROM public.job_runs jr
    LEFT JOIN public.assignments a
      ON a.id = jr.assignment_id
    LEFT JOIN public.repos r
      ON r.id = a.repo_id
    LEFT JOIN public.triggers t
      ON t.id = jr.trigger_id
    WHERE jr.status = 'running'
      AND jr.id <> p_job_run_id
      AND COALESCE(
        t.installation_id::BIGINT,
        r.github_installation_id::BIGINT,
        NULLIF(jr.metadata->>'installation_id', '')::BIGINT
      ) = p_installation_id;

    IF v_installation_running >= p_max_running_per_installation THEN
      RETURN QUERY SELECT false, 'pending'::TEXT, 'INSTALLATION_CONCURRENCY_LIMIT'::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  UPDATE public.job_runs AS jr
  SET
    status = 'running',
    started_at = p_claimed_at,
    completed_at = NULL,
    duration_ms = NULL,
    input_tokens = NULL,
    output_tokens = NULL,
    error = NULL
  WHERE jr.id = p_job_run_id
    AND jr.status = 'pending';

  RETURN QUERY SELECT true, 'running'::TEXT, NULL::TEXT, p_claimed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_job_run(UUID, UUID, BIGINT, TIMESTAMPTZ, INT, INT) FROM PUBLIC;
