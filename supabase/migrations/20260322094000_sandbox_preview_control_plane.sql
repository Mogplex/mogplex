ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS last_preview_http_status INT,
  ADD COLUMN IF NOT EXISTS last_preview_error TEXT,
  ADD COLUMN IF NOT EXISTS last_boot_error TEXT,
  ADD COLUMN IF NOT EXISTS boot_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_boot_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_boot_completed_at TIMESTAMPTZ;

ALTER TABLE public.sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_health_status_check;

ALTER TABLE public.sandboxes
  ADD CONSTRAINT sandboxes_health_status_check
    CHECK (health_status IN (
      'unknown',
      'starting',
      'running',
      'stopped',
      'error',
      'not_available',
      'idle_warning',
      'app_error',
      'unreachable'
    ));

UPDATE public.sandboxes
SET
  boot_attempts = CASE
    WHEN boot_attempts > 0 THEN boot_attempts
    WHEN status IN ('creating', 'installing', 'running', 'error') THEN 1
    ELSE 0
  END,
  last_preview_error = CASE
    WHEN health_status IN ('error', 'app_error', 'unreachable') THEN COALESCE(last_preview_error, error)
    ELSE last_preview_error
  END,
  last_boot_error = CASE
    WHEN status = 'error' THEN COALESCE(last_boot_error, error)
    ELSE last_boot_error
  END
WHERE boot_attempts = 0
   OR (status = 'error' AND last_boot_error IS NULL)
   OR (health_status IN ('error', 'app_error', 'unreachable') AND last_preview_error IS NULL);
