DROP INDEX IF EXISTS public.sandboxes_active_repo_branch_user_idx;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, repo_id, working_branch
      ORDER BY created_at DESC, id DESC
    ) AS row_number
  FROM public.sandboxes
  WHERE repo_id IS NOT NULL
    AND working_branch IS NOT NULL
    AND status IN ('creating', 'installing', 'running')
)
UPDATE public.sandboxes AS sandboxes
SET
  status = 'stopped',
  health_status = 'stopped'
FROM ranked
WHERE sandboxes.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sandboxes_one_active_branch_per_repo_user_idx
  ON public.sandboxes (user_id, repo_id, working_branch)
  WHERE repo_id IS NOT NULL
    AND working_branch IS NOT NULL
    AND status IN ('creating', 'installing', 'running');
