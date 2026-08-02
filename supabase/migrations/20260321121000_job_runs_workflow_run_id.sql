ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_job_runs_workflow_run_id
  ON public.job_runs (workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;
