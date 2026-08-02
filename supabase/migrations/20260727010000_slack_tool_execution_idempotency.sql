-- A Trigger retry must not repeat an external write that an agent already
-- attempted for the same Slack event. Each tool occurrence is reserved before
-- execution and its result is replayed on retry.
CREATE TABLE IF NOT EXISTS public.slack_tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  tool_name text NOT NULL,
  input_hash text NOT NULL CHECK (char_length(input_hash) = 64),
  occurrence integer NOT NULL CHECK (occurrence > 0),
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed')),
  output jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, scope_key, tool_name, input_hash, occurrence)
);

CREATE INDEX IF NOT EXISTS slack_tool_executions_started_idx
  ON public.slack_tool_executions (started_at);

ALTER TABLE public.slack_tool_executions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.slack_tool_executions FROM anon, authenticated;
GRANT ALL ON TABLE public.slack_tool_executions TO service_role;

COMMENT ON TABLE public.slack_tool_executions IS
  'Service-role-only at-most-once ledger for mutating agent tools invoked from Slack events.';
