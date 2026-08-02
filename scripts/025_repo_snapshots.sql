-- Add snapshot tracking to repos for instant sandbox restores
ALTER TABLE repos
  ADD COLUMN IF NOT EXISTS snapshot_id TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_lockfile_hash TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snapshot_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_billing_source TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_billing_team_id TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_billing_project_id TEXT;

DO $$
BEGIN
  ALTER TABLE repos
    ADD CONSTRAINT repos_snapshot_billing_source_check
    CHECK (
      snapshot_billing_source IS NULL
      OR snapshot_billing_source IN ('platform', 'user_vercel_project')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Index for quick lookups of repos that have snapshots
CREATE INDEX IF NOT EXISTS idx_repos_snapshot_id ON repos (snapshot_id) WHERE snapshot_id IS NOT NULL;
