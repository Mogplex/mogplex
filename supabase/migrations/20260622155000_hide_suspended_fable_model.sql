-- Claude Fable 5 access was suspended by Anthropic/Vercel on 2026-06-12.
-- Keep the historical catalog row for saved references, but hide it from the
-- model settings catalog until access is intentionally restored.
UPDATE public.ai_models
SET
  is_available = false,
  is_hidden = true,
  is_recommended = false,
  recommendation_bucket = NULL,
  recommendation_rank = NULL,
  recommendation_reason = NULL,
  recommended_at = NULL,
  updated_at = NOW()
WHERE id = 'anthropic/claude-fable-5';
