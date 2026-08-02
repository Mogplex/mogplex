ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

UPDATE public.ai_models
SET is_hidden = true
WHERE id IN (
  'openai/gpt-5.2-pro',
  'openai/o3-pro',
  'anthropic/claude-3-opus',
  'anthropic/claude-opus-4',
  'anthropic/claude-opus-4.1',
  'openai/o1',
  'openai/gpt-5-pro',
  'openai/o3-deep-research',
  'openai/gpt-4-turbo'
);
