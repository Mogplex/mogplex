ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS start_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_start_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_start_error TEXT,
  ADD COLUMN IF NOT EXISTS last_start_source TEXT CHECK (last_start_source IN ('webhook', 'cron', 'repair', 'manual_retry')),
  ADD COLUMN IF NOT EXISTS retry_of_job_run_id UUID REFERENCES public.job_runs(id) ON DELETE SET NULL;

UPDATE public.job_runs
SET created_at = COALESCE(created_at, started_at, now())
WHERE created_at IS NULL;

ALTER TABLE public.job_runs
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN started_at DROP DEFAULT;

UPDATE public.job_runs
SET started_at = NULL
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_runs_retry_of_job_run_id
  ON public.job_runs (retry_of_job_run_id)
  WHERE retry_of_job_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_runs_created_at
  ON public.job_runs (created_at DESC);
