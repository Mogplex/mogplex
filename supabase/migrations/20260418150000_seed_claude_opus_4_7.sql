-- Seed Claude Opus 4.7 into the ai_models catalog so existing databases
-- surface the model in the UI even before the next AI Gateway sync runs.
INSERT INTO ai_models (id, provider, name, context_length, is_available)
VALUES (
  'anthropic/claude-opus-4.7',
  'anthropic',
  'claude-opus-4.7',
  1000000,
  true
)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  name = EXCLUDED.name,
  context_length = EXCLUDED.context_length,
  is_available = EXCLUDED.is_available;
