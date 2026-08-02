-- Seed Claude Sonnet 5 (released 2026-07-01) into the ai_models catalog so it
-- appears immediately even before the next AI Gateway sync runs.
--
-- Pricing is the introductory rate ($2/$10 per MTok, through 2026-08-31;
-- sticker is $3/$15). The sync cron overwrites pricing with the live gateway
-- values on its next run, so no follow-up migration is needed when the intro
-- ends. Note the Anthropic newest-version policy interaction: Sonnet 4.6
-- ($3/$15) stays visible while Sonnet 5 is on intro pricing; once the gateway
-- reports both at $3/$15, the sync cron hides Sonnet 4.6 automatically.
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
  'anthropic/claude-sonnet-5',
  'anthropic',
  'Claude Sonnet 5',
  1000000,
  ARRAY['tool-use', 'reasoning', 'vision', 'file-input', 'explicit-caching'],
  0.000002,
  0.00001,
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
