ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS vercel_team_id TEXT,
  ADD COLUMN IF NOT EXISTS vercel_project_id TEXT,
  ADD COLUMN IF NOT EXISTS sandbox_billing_target TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS env_sync_mode TEXT NOT NULL DEFAULT 'sandbox-only';

ALTER TABLE public.repos
  DROP CONSTRAINT IF EXISTS repos_sandbox_billing_target_check,
  DROP CONSTRAINT IF EXISTS repos_env_sync_mode_check;

ALTER TABLE public.repos
  ADD CONSTRAINT repos_sandbox_billing_target_check
    CHECK (sandbox_billing_target IN ('personal', 'team')),
  ADD CONSTRAINT repos_env_sync_mode_check
    CHECK (env_sync_mode IN ('sandbox-only', 'sandbox-and-preview'));

ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS vercel_team_id TEXT,
  ADD COLUMN IF NOT EXISTS vercel_project_id TEXT,
  ADD COLUMN IF NOT EXISTS sandbox_billing_target TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS install_log TEXT,
  ADD COLUMN IF NOT EXISTS dev_log TEXT,
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminal_cwd TEXT;

ALTER TABLE public.sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_sandbox_billing_target_check,
  DROP CONSTRAINT IF EXISTS sandboxes_health_status_check;

ALTER TABLE public.sandboxes
  ADD CONSTRAINT sandboxes_sandbox_billing_target_check
    CHECK (sandbox_billing_target IN ('personal', 'team')),
  ADD CONSTRAINT sandboxes_health_status_check
    CHECK (health_status IN ('unknown', 'starting', 'ready', 'error'));

UPDATE public.repos
SET
  sandbox_billing_target = COALESCE(NULLIF(sandbox_billing_target, ''), 'personal'),
  env_sync_mode = COALESCE(NULLIF(env_sync_mode, ''), 'sandbox-only')
WHERE sandbox_billing_target IS NULL
   OR sandbox_billing_target = ''
   OR env_sync_mode IS NULL
   OR env_sync_mode = '';

UPDATE public.sandboxes
SET
  sandbox_billing_target = COALESCE(NULLIF(sandbox_billing_target, ''), 'personal'),
  health_status = CASE
    WHEN status = 'running' THEN 'ready'
    WHEN status IN ('creating', 'installing') THEN 'starting'
    WHEN status = 'error' THEN 'error'
    ELSE COALESCE(NULLIF(health_status, ''), 'unknown')
  END
WHERE sandbox_billing_target IS NULL
   OR sandbox_billing_target = ''
   OR health_status IS NULL
   OR health_status = '';

CREATE INDEX IF NOT EXISTS sandboxes_user_repo_status_idx
  ON public.sandboxes (user_id, repo_id, status, created_at DESC);
