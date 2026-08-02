-- Add runtime column to repos and sandboxes tables
-- Supports: node22, node24, python3.13
-- NULL = auto-detect at sandbox creation

ALTER TABLE public.repos ADD COLUMN IF NOT EXISTS runtime TEXT;
ALTER TABLE public.repos ADD CONSTRAINT repos_runtime_check
  CHECK (runtime IS NULL OR runtime IN ('node22','node24','python3.13'));

ALTER TABLE public.sandboxes ADD COLUMN IF NOT EXISTS runtime TEXT;
ALTER TABLE public.sandboxes ADD CONSTRAINT sandboxes_runtime_check
  CHECK (runtime IS NULL OR runtime IN ('node22','node24','python3.13'));
