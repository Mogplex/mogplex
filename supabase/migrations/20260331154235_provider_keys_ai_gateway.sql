ALTER TABLE public.provider_keys
  DROP CONSTRAINT IF EXISTS provider_keys_provider_check;

ALTER TABLE public.provider_keys
  ADD CONSTRAINT provider_keys_provider_check
  CHECK (provider IN ('ai_gateway', 'anthropic', 'openai'));
