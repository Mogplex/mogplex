-- AI Models table for storing available models from Vercel AI Gateway
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  context_length INTEGER,
  capabilities TEXT[] DEFAULT '{}',
  pricing_input NUMERIC,
  pricing_output NUMERIC,
  is_available BOOLEAN DEFAULT true,
  is_recommended BOOLEAN DEFAULT false,
  recommendation_bucket TEXT CHECK (recommendation_bucket IN ('open', 'frontier')),
  recommendation_rank INTEGER,
  recommendation_reason TEXT,
  recommended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering by provider
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);

-- Index for filtering available models
CREATE INDEX IF NOT EXISTS idx_ai_models_available ON ai_models(is_available);

-- Index for filtering recommended models
CREATE INDEX IF NOT EXISTS idx_ai_models_recommended ON ai_models(is_recommended);

-- RLS policies
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;

-- Everyone can read models
CREATE POLICY "Anyone can read ai_models"
  ON ai_models FOR SELECT
  USING (true);

-- Only service role can update (edge function uses service role)
CREATE POLICY "Service role can manage ai_models"
  ON ai_models FOR ALL
  USING (auth.role() = 'service_role');
