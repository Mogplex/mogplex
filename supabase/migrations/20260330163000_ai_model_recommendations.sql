ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommendation_bucket TEXT,
  ADD COLUMN IF NOT EXISTS recommendation_rank INTEGER,
  ADD COLUMN IF NOT EXISTS recommendation_reason TEXT,
  ADD COLUMN IF NOT EXISTS recommended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_models_recommendation_bucket_check'
  ) THEN
    ALTER TABLE ai_models
      ADD CONSTRAINT ai_models_recommendation_bucket_check
      CHECK (recommendation_bucket IN ('open', 'frontier'));
  END IF;
END $$;

UPDATE ai_models
SET
  is_recommended = COALESCE(is_recommended, false),
  recommendation_bucket = NULL,
  recommendation_rank = NULL,
  recommendation_reason = NULL,
  recommended_at = NULL
WHERE true;

CREATE INDEX IF NOT EXISTS idx_ai_models_recommended ON ai_models(is_recommended);
