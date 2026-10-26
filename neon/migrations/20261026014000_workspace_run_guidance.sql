-- Live guidance for native runs that did not start from a Slack thread (API,
-- MCP, Control). Expand only: the Slack columns become optional for rows the
-- workspace writes, and Slack rows, RPCs and the settle trigger are unchanged.
ALTER TABLE public.slack_run_guidance
  ALTER COLUMN slack_team_id DROP NOT NULL,
  ALTER COLUMN slack_user_id DROP NOT NULL,
  ALTER COLUMN channel_id DROP NOT NULL,
  ALTER COLUMN thread_ts DROP NOT NULL;

-- Slack rows keep UNIQUE (slack_team_id, event_id). NULL team ids never
-- conflict there, so workspace retries dedupe per run instead.
CREATE UNIQUE INDEX IF NOT EXISTS slack_run_guidance_workspace_event_key
  ON public.slack_run_guidance(run_id, event_id)
  WHERE slack_team_id IS NULL;

CREATE OR REPLACE FUNCTION public.submit_run_guidance(
  p_run_id UUID, p_user_id UUID, p_ai_call_id UUID, p_event_id TEXT, p_body TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  selected_run public.external_agent_runs%ROWTYPE;
  guidance public.slack_run_guidance%ROWTYPE;
BEGIN
  SELECT * INTO selected_run FROM public.external_agent_runs
    WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR selected_run.harness IS DISTINCT FROM 'mogplex'
  THEN RETURN NULL; END IF;

  SELECT * INTO guidance FROM public.slack_run_guidance
    WHERE run_id = p_run_id AND user_id = p_user_id
      AND event_id = p_event_id AND slack_team_id IS NULL;
  IF FOUND THEN RETURN jsonb_build_object('id', guidance.id, 'status', guidance.status); END IF;
  IF selected_run.ai_call_id IS DISTINCT FROM p_ai_call_id THEN RETURN NULL; END IF;
  IF coalesce(btrim(p_event_id), '') = '' OR coalesce(btrim(p_body), '') = ''
  THEN RAISE EXCEPTION 'Invalid guidance' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.slack_run_guidance (
    run_id, user_id, ai_call_id, event_id, message_ts, body, status
  ) VALUES (
    p_run_id, p_user_id, p_ai_call_id, p_event_id, p_event_id, p_body,
    CASE WHEN selected_run.status IN ('pending', 'streaming') THEN 'received' ELSE 'not_applied' END
  ) ON CONFLICT (run_id, event_id) WHERE slack_team_id IS NULL DO NOTHING
  RETURNING * INTO guidance;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.external_agent_runs SET slack_progress_revision = slack_progress_revision + 1
    WHERE id = p_run_id AND user_id = p_user_id;
  RETURN jsonb_build_object('id', guidance.id, 'status', guidance.status);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_run_guidance(UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_run_guidance(UUID,UUID,UUID,TEXT,TEXT) TO service_role;
-- Native Neon installations do not have the legacy browser roles.
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.submit_run_guidance(UUID,UUID,UUID,TEXT,TEXT) FROM %I', client_role);
    END IF;
  END LOOP;
END;
$$;
