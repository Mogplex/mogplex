-- Durable progress snapshot. Delivery workers read the latest run state, never
-- trust an old queued progress payload, and cannot revive a terminal segment.
ALTER TABLE public.external_agent_runs
  ADD COLUMN IF NOT EXISTS slack_progress JSONB,
  ADD COLUMN IF NOT EXISTS slack_progress_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slack_progress_delivered_key TEXT,
  ADD COLUMN IF NOT EXISTS slack_progress_delivered_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.publish_slack_run_progress(
  p_run_id UUID, p_user_id UUID, p_ai_call_id UUID, p_progress JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE published_revision BIGINT;
BEGIN
  IF jsonb_typeof(p_progress) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Progress must be an object' USING ERRCODE = '22023';
  END IF;
  UPDATE public.external_agent_runs
     SET slack_progress = p_progress,
         slack_progress_revision = slack_progress_revision + 1
   WHERE id = p_run_id AND user_id = p_user_id AND ai_call_id = p_ai_call_id
     AND status IN ('pending', 'streaming')
  RETURNING slack_progress_revision INTO published_revision;
  RETURN published_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_slack_run_progress(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_slack_run_progress(UUID, UUID, UUID, JSONB) TO service_role;
