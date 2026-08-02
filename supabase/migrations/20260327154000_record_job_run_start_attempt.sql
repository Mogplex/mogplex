CREATE OR REPLACE FUNCTION public.record_job_run_start_attempt(
  p_job_run_id UUID,
  p_source TEXT,
  p_attempted_at TIMESTAMPTZ DEFAULT now(),
  p_status_hint TEXT DEFAULT NULL
)
RETURNS TABLE (
  found BOOLEAN,
  attempted_at TIMESTAMPTZ,
  status TEXT,
  start_attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.job_runs AS jr
  SET
    start_attempts = COALESCE(jr.start_attempts, 0) + 1,
    last_start_attempt_at = p_attempted_at,
    last_start_source = p_source,
    last_start_error = CASE
      WHEN p_status_hint IS NOT NULL AND p_status_hint <> 'pending' THEN 'Job is ' || p_status_hint
      ELSE NULL
    END
  WHERE jr.id = p_job_run_id
  RETURNING
    TRUE,
    p_attempted_at,
    jr.status,
    jr.start_attempts;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT FALSE, p_attempted_at, NULL::TEXT, NULL::INT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_job_run_start_attempt(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
