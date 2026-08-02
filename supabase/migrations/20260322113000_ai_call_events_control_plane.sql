ALTER TABLE public.ai_calls
  DROP CONSTRAINT IF EXISTS ai_calls_status_check;

ALTER TABLE public.ai_calls
  ADD CONSTRAINT ai_calls_status_check
  CHECK (status IN ('pending', 'streaming', 'success', 'failed', 'cancelled'));

ALTER TABLE public.ai_calls
  ADD COLUMN IF NOT EXISTS runtime_command_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_calls_conversation_started
  ON public.ai_calls (conversation_id, started_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_runtime_command_id
  ON public.ai_calls (runtime_command_id)
  WHERE runtime_command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_call_id UUID REFERENCES public.ai_calls(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conversation_id TEXT,
  repo_id UUID REFERENCES public.repos(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'started',
      'status_changed',
      'tool_started',
      'tool_finished',
      'cancel_requested',
      'cancelled',
      'finished',
      'failed',
      'log'
    )
  ),
  tool_name TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_call_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_call_events'
      AND policyname = 'owner_access'
  ) THEN
    CREATE POLICY "owner_access" ON public.ai_call_events
      FOR ALL USING (user_id = auth.uid());
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ai_call_events_ai_call_created
  ON public.ai_call_events (ai_call_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_call_events_user_created
  ON public.ai_call_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_events_conversation_created
  ON public.ai_call_events (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;
