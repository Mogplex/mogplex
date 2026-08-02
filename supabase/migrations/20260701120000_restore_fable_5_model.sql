-- Claude Fable 5 access has been restored (it was suspended by
-- Anthropic/Vercel on 2026-06-12 and hidden in
-- 20260622155000_hide_suspended_fable_model.sql). Re-enable and un-hide the
-- catalog row, upserting it so the model appears immediately even before the
-- next AI Gateway sync runs. The sync cron never clears is_hidden on its own,
-- so the un-hide must happen here.
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
  'anthropic/claude-fable-5',
  'anthropic',
  'Claude Fable 5',
  1000000,
  ARRAY['tool-use', 'reasoning', 'vision', 'file-input', 'explicit-caching', 'web-search'],
  0.00001,
  0.00005,
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
