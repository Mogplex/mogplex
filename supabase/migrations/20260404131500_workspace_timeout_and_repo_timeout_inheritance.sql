ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS sandbox_timeout_ms INTEGER;

UPDATE public.workspaces
SET sandbox_timeout_ms = COALESCE(sandbox_timeout_ms, 600000)
WHERE sandbox_timeout_ms IS NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN sandbox_timeout_ms SET DEFAULT 600000,
  ALTER COLUMN sandbox_timeout_ms SET NOT NULL;

ALTER TABLE public.repos
  ALTER COLUMN sandbox_timeout_ms DROP NOT NULL,
  ALTER COLUMN sandbox_timeout_ms DROP DEFAULT;
