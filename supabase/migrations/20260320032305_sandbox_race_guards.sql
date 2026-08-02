ALTER TABLE public.sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_health_status_check;

ALTER TABLE public.sandboxes
  ADD CONSTRAINT sandboxes_health_status_check
    CHECK (health_status IN (
      'unknown',
      'starting',
      'ready',
      'running',
      'stopped',
      'error',
      'not_available',
      'idle_warning'
    ));

UPDATE public.sandboxes
SET health_status = CASE
  WHEN health_status = 'ready' THEN 'running'
  WHEN health_status IS NULL OR health_status = '' OR health_status = 'unknown' THEN CASE
    WHEN status IN ('creating', 'installing') THEN 'starting'
    WHEN status = 'running' THEN 'running'
    WHEN status = 'error' THEN 'error'
    ELSE 'stopped'
  END
  ELSE health_status
END
WHERE health_status IS NULL
   OR health_status = ''
   OR health_status IN ('ready', 'unknown');

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, repo_id
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'installing' THEN 1
          WHEN 'creating' THEN 2
          ELSE 3
        END,
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.sandboxes
  WHERE repo_id IS NOT NULL
    AND status IN ('creating', 'installing', 'running')
)
UPDATE public.sandboxes AS sandboxes
SET
  status = 'stopped',
  health_status = 'stopped',
  error = COALESCE(
    sandboxes.error,
    'Superseded by active sandbox uniqueness migration'
  )
FROM ranked
WHERE sandboxes.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sandboxes_one_active_per_repo_user_idx
  ON public.sandboxes (user_id, repo_id)
  WHERE repo_id IS NOT NULL
    AND status IN ('creating', 'installing', 'running');
