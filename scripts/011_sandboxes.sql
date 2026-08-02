-- Add Vercel team/project to profiles for sandbox billing
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vercel_team_id TEXT;

-- Sandboxes table
CREATE TABLE IF NOT EXISTS sandboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  status TEXT DEFAULT 'creating' CHECK (status IN ('creating', 'installing', 'running', 'stopped', 'error')),
  preview_url TEXT,
  snapshot_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_user_id ON sandboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_sandboxes_repo_id ON sandboxes(repo_id);

-- RLS
ALTER TABLE sandboxes ENABLE ROW LEVEL SECURITY;
