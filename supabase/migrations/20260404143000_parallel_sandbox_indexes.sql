DROP INDEX IF EXISTS public.sandboxes_one_active_per_repo_user_idx;

CREATE INDEX IF NOT EXISTS sandboxes_active_repo_branch_user_idx
  ON public.sandboxes (user_id, repo_id, working_branch, created_at DESC)
  WHERE repo_id IS NOT NULL
    AND status IN ('creating', 'installing', 'running');
