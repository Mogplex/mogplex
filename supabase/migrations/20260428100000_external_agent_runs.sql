CREATE TABLE IF NOT EXISTS public.external_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  ai_call_id UUID NOT NULL REFERENCES public.ai_calls(id) ON DELETE CASCADE,
  sandbox_record_id UUID REFERENCES public.sandboxes(id) ON DELETE SET NULL,
  sandbox_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  harness TEXT NOT NULL CHECK (harness IN ('codex', 'claude-code')),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'streaming', 'success', 'failed', 'cancelled')
  ) DEFAULT 'pending',
  prompt TEXT NOT NULL CHECK (char_length(prompt) <= 100000),
  base_branch TEXT NOT NULL,
  working_branch TEXT NOT NULL,
  create_branch BOOLEAN NOT NULL DEFAULT false,
  root_directory TEXT,
  conversation_id TEXT,
  workspace_session_id TEXT,
  mode TEXT,
  runtime_provider TEXT,
  runtime_run_id TEXT,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.external_agent_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.limit_events
  DROP CONSTRAINT IF EXISTS limit_events_route_key_check;

ALTER TABLE public.limit_events
  ADD CONSTRAINT limit_events_route_key_check CHECK (
    route_key IN (
      'chat',
      'external_agent_run',
      'sandbox_boot',
      'snapshot_build',
      'sandbox_exec'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_agent_runs'
      AND policyname = 'owner_select'
  ) THEN
    CREATE POLICY "owner_select" ON public.external_agent_runs
      FOR SELECT USING (user_id = public.current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_agent_runs'
      AND policyname = 'owner_insert'
  ) THEN
    CREATE POLICY "owner_insert" ON public.external_agent_runs
      FOR INSERT WITH CHECK (user_id = public.current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_agent_runs'
      AND policyname = 'owner_update'
  ) THEN
    CREATE POLICY "owner_update" ON public.external_agent_runs
      FOR UPDATE
      USING (user_id = public.current_profile_id())
      WITH CHECK (user_id = public.current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_agent_runs'
      AND policyname = 'owner_delete'
  ) THEN
    CREATE POLICY "owner_delete" ON public.external_agent_runs
      FOR DELETE USING (user_id = public.current_profile_id());
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.external_agent_runs_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_agent_runs_set_updated_at ON public.external_agent_runs;
CREATE TRIGGER external_agent_runs_set_updated_at
  BEFORE UPDATE ON public.external_agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.external_agent_runs_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS external_agent_runs_user_idempotency_key_idx
  ON public.external_agent_runs (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS external_agent_runs_user_created_idx
  ON public.external_agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS external_agent_runs_repo_created_idx
  ON public.external_agent_runs (repo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS external_agent_runs_ai_call_id_idx
  ON public.external_agent_runs (ai_call_id);
