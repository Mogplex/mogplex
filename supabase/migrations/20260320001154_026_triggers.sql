CREATE TABLE IF NOT EXISTS public.triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN (
    'mention',
    'pr_opened',
    'issue_opened',
    'pr_comment',
    'issue_comment',
    'push',
    'ci_failure'
  )),
  is_default BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triggers_installation_event
  ON triggers(installation_id, event) WHERE enabled = true;

ALTER TABLE triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own triggers"
  ON triggers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);;
