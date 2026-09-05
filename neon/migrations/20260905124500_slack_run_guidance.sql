-- Inbox for authenticated replies to an exact Slack run thread. No network work
-- occurs while holding the run lock; accept, step receipt and terminal settlement
-- serialize against that same row so an update cannot be silently lost.
CREATE TABLE IF NOT EXISTS public.slack_run_guidance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.external_agent_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ai_call_id UUID NOT NULL REFERENCES public.ai_calls(id) ON DELETE CASCADE,
  slack_team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  event_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments JSONB,
  status TEXT NOT NULL CHECK (status IN ('received', 'delivered', 'not_applied')),
  delivered_step INTEGER CHECK (delivered_step >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slack_team_id, event_id)
);
CREATE INDEX IF NOT EXISTS slack_run_guidance_owner_run_idx
  ON public.slack_run_guidance(user_id, run_id, ai_call_id, status, created_at, id);
ALTER TABLE public.slack_run_guidance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slack_run_guidance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_run_guidance TO service_role;
DROP POLICY IF EXISTS slack_run_guidance_service ON public.slack_run_guidance;
CREATE POLICY slack_run_guidance_service ON public.slack_run_guidance
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.submit_slack_run_guidance(
  p_run_id UUID, p_user_id UUID, p_ai_call_id UUID,
  p_team_id TEXT, p_channel_id TEXT, p_thread_ts TEXT, p_slack_user_id TEXT,
  p_event_id TEXT, p_message_ts TEXT, p_body TEXT, p_attachments JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  selected_run public.external_agent_runs%ROWTYPE;
  guidance public.slack_run_guidance%ROWTYPE;
BEGIN
  SELECT * INTO selected_run FROM public.external_agent_runs
    WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND
     OR selected_run.harness IS DISTINCT FROM 'mogplex'
     OR selected_run.metadata->>'slack_guidance_enabled' IS DISTINCT FROM 'true'
     OR selected_run.metadata->>'slack_user_id' IS DISTINCT FROM p_slack_user_id
     OR selected_run.metadata->'slackRunControls'->>'teamId' IS DISTINCT FROM p_team_id
     OR selected_run.metadata->'slackRunControls'->>'channelId' IS DISTINCT FROM p_channel_id
     OR coalesce(selected_run.metadata->>'slack_thread_ts',
                 selected_run.metadata->'slackRunControls'->>'messageTs') IS DISTINCT FROM p_thread_ts
  THEN RETURN NULL; END IF;

  SELECT * INTO guidance FROM public.slack_run_guidance
    WHERE slack_team_id = p_team_id AND event_id = p_event_id
      AND run_id = p_run_id AND user_id = p_user_id;
  IF FOUND THEN RETURN jsonb_build_object('id', guidance.id, 'status', guidance.status); END IF;
  IF selected_run.ai_call_id IS DISTINCT FROM p_ai_call_id THEN RETURN NULL; END IF;
  IF coalesce(btrim(p_event_id), '') = '' OR coalesce(btrim(p_message_ts), '') = ''
     OR (coalesce(btrim(p_body), '') = '' AND p_attachments IS NULL)
     OR (p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) IS DISTINCT FROM 'object')
     OR (p_attachments IS NOT NULL AND p_attachments->>'teamId' IS DISTINCT FROM p_team_id)
  THEN RAISE EXCEPTION 'Invalid guidance' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.slack_run_guidance (
    run_id, user_id, ai_call_id, slack_team_id, slack_user_id, channel_id,
    thread_ts, event_id, message_ts, body, attachments, status
  ) VALUES (
    p_run_id, p_user_id, p_ai_call_id, p_team_id, p_slack_user_id, p_channel_id,
    p_thread_ts, p_event_id, p_message_ts, coalesce(p_body, ''), p_attachments,
    CASE WHEN selected_run.status IN ('pending', 'streaming') THEN 'received' ELSE 'not_applied' END
  ) ON CONFLICT (slack_team_id, event_id) DO NOTHING RETURNING * INTO guidance;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.external_agent_runs SET slack_progress_revision = slack_progress_revision + 1
    WHERE id = p_run_id AND user_id = p_user_id;
  RETURN jsonb_build_object('id', guidance.id, 'status', guidance.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.deliver_slack_run_guidance(
  p_run_id UUID, p_user_id UUID, p_ai_call_id UUID, p_guidance_ids UUID[], p_step INTEGER
) RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE selected_run public.external_agent_runs%ROWTYPE; delivered_count INTEGER;
BEGIN
  SELECT * INTO selected_run FROM public.external_agent_runs
    WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR selected_run.ai_call_id IS DISTINCT FROM p_ai_call_id
     OR selected_run.status NOT IN ('pending', 'streaming')
  THEN RETURN 0; END IF;
  UPDATE public.slack_run_guidance SET status = 'delivered', delivered_step = p_step, updated_at = now()
    WHERE run_id = p_run_id AND user_id = p_user_id AND ai_call_id = p_ai_call_id
      AND id = ANY(p_guidance_ids) AND status = 'received';
  GET DIAGNOSTICS delivered_count = ROW_COUNT;
  IF delivered_count > 0 THEN
    UPDATE public.external_agent_runs SET slack_progress_revision = slack_progress_revision + 1
      WHERE id = p_run_id AND user_id = p_user_id;
  END IF;
  RETURN delivered_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_slack_run_guidance()
-- Trigger-only privilege bridge: existing owner-authorized run updates must not
-- require direct access to the private inbox. It touches only OLD's run/owner/
-- segment, cannot be invoked as an RPC, and has no caller-controlled SQL.
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE settled_count INTEGER;
BEGIN
  IF NEW.ai_call_id IS DISTINCT FROM OLD.ai_call_id THEN
    NEW.slack_progress := NULL;
    NEW.slack_progress_revision := NEW.slack_progress_revision + 1;
  END IF;
  IF NEW.status NOT IN ('pending', 'streaming') OR NEW.ai_call_id IS DISTINCT FROM OLD.ai_call_id THEN
    UPDATE public.slack_run_guidance SET status = 'not_applied', updated_at = now()
      WHERE run_id = OLD.id AND user_id = OLD.user_id AND ai_call_id = OLD.ai_call_id AND status = 'received';
    GET DIAGNOSTICS settled_count = ROW_COUNT;
    IF settled_count > 0 THEN NEW.slack_progress_revision := NEW.slack_progress_revision + 1; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS settle_slack_run_guidance ON public.external_agent_runs;
CREATE TRIGGER settle_slack_run_guidance BEFORE UPDATE OF status, ai_call_id ON public.external_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.settle_slack_run_guidance();

REVOKE ALL ON FUNCTION public.submit_slack_run_guidance(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deliver_slack_run_guidance(UUID,UUID,UUID,UUID[],INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_slack_run_guidance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_slack_run_guidance(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.deliver_slack_run_guidance(UUID,UUID,UUID,UUID[],INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_slack_run_guidance() TO service_role;
