-- Seed Fugu Ultra into the ai_models catalog so it appears immediately even
-- before the next AI Gateway sync runs.
INSERT INTO ai_models (
  id,
  provider,
  name,
  context_length,
  capabilities,
  pricing_input,
  pricing_output,
  pricing_cache_read,
  is_available
)
VALUES (
  'sakana/fugu-ultra',
  'sakana',
  'Fugu Ultra',
  1000000,
  ARRAY['vision', 'tool-use', 'reasoning'],
  0.000005,
  0.00003,
  0.0000005,
  true
)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  name = EXCLUDED.name,
  context_length = EXCLUDED.context_length,
  capabilities = EXCLUDED.capabilities,
  pricing_input = EXCLUDED.pricing_input,
  pricing_output = EXCLUDED.pricing_output,
  pricing_cache_read = EXCLUDED.pricing_cache_read,
  is_available = EXCLUDED.is_available,
  updated_at = NOW();
