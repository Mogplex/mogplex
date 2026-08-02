-- Add project-level scoping to connections
ALTER TABLE connections
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
  ADD COLUMN repo_id UUID REFERENCES repos(id) ON DELETE CASCADE;

ALTER TABLE connections
  ADD CONSTRAINT connections_scope_repo_check
  CHECK (scope = 'global' OR repo_id IS NOT NULL);

CREATE INDEX idx_connections_repo ON connections(repo_id) WHERE repo_id IS NOT NULL;

-- Override table for excluding global connections from specific repos
CREATE TABLE repo_connection_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  excluded BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, connection_id)
);

ALTER TABLE repo_connection_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repo_connection_overrides_owner" ON repo_connection_overrides FOR ALL
  USING (EXISTS (SELECT 1 FROM repos r WHERE r.id = repo_id AND r.user_id = auth.uid()));
CREATE INDEX idx_repo_conn_overrides_repo ON repo_connection_overrides(repo_id);
