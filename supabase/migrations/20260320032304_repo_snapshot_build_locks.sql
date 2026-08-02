ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS snapshot_build_token TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_build_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_repos_snapshot_build_token
  ON public.repos (snapshot_build_token)
  WHERE snapshot_build_token IS NOT NULL;
