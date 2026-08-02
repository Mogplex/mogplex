-- Anthropic newest-version policy: when an Anthropic model has the same
-- pricing as a newer version in the same Claude family, only the newest
-- version is offered. Applied to the current catalog:
--   * Opus 4.5 / 4.6 / 4.7 share Opus 4.8's $5/$25 pricing  -> keep 4.8 only
--   * Sonnet 4.5 / Claude 3.7 Sonnet share Sonnet 4.6's $3/$15 -> keep 4.6 only
-- Go-forward enforcement lives in the sync cron
-- (lib/models/anthropic-version-policy.ts); this migration cleans up rows
-- that already exist. The sync cron re-upserts availability for models the
-- gateway still serves but never clears is_hidden, so the hide is durable
-- (same pattern as 20260622155000_hide_suspended_fable_model). Rows are kept
-- for saved references and historical cost attribution.

-- 1) Seed Claude Opus 4.8 so it appears immediately even before the next
--    AI Gateway sync runs.
INSERT INTO public.ai_models (
  id,
  provider,
  name,
  context_length,
  capabilities,
  pricing_input,
  pricing_output,
  is_available,
  is_hidden
)
VALUES (
  'anthropic/claude-opus-4.8',
  'anthropic',
  'Claude Opus 4.8',
  1000000,
  ARRAY['tool-use', 'reasoning', 'vision', 'file-input', 'explicit-caching', 'web-search'],
  0.000005,
  0.000025,
  true,
  false
)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  name = EXCLUDED.name,
  context_length = EXCLUDED.context_length,
  capabilities = EXCLUDED.capabilities,
  pricing_input = EXCLUDED.pricing_input,
  pricing_output = EXCLUDED.pricing_output,
  is_available = EXCLUDED.is_available,
  is_hidden = EXCLUDED.is_hidden,
  updated_at = NOW();

-- 2) Hide the superseded versions.
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
WHERE
  (
    id LIKE 'anthropic/claude-opus-%'
    AND id <> 'anthropic/claude-opus-4.8'
  )
  OR id IN (
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-3.7-sonnet'
  );
