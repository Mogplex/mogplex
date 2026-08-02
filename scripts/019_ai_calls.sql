-- AI calls observability table
CREATE TABLE ai_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chat', 'pr_review', 'cron_refactor', 'agent')),
  model TEXT NOT NULL,
  input_tokens INT,
  output_tokens INT,
  total_tokens INT GENERATED ALWAYS AS (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) STORED,
  duration_ms INT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'success', 'failed')),
  error TEXT,
  conversation_id TEXT,
  job_run_id UUID,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  tool_calls_count INT DEFAULT 0,
  tool_calls JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}'
);

ALTER TABLE ai_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_access" ON ai_calls
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX idx_ai_calls_user_started ON ai_calls (user_id, started_at DESC);
CREATE INDEX idx_ai_calls_type ON ai_calls (type);
CREATE INDEX idx_ai_calls_status ON ai_calls (status);
