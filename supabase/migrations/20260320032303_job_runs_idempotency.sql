ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_idempotency_key_idx
  ON public.job_runs (idempotency_key);
