-- 022: Add missing indexes on FK and frequently-queried columns
-- These columns appear in WHERE/JOIN clauses but lack indexes,
-- causing sequential scans as data grows.

-- FK columns queried without indexes
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_repo_id ON assignments(repo_id);
CREATE INDEX IF NOT EXISTS idx_assignments_agent_id ON assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_assignment_id ON job_runs(assignment_id);
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_rules_user_id ON agent_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_commands_user_id ON custom_commands(user_id);

-- Conversations ordered by updated_at — composite covers the common query
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON conversations(user_id, updated_at DESC);

-- Override tables queried by user_id or repo_id
CREATE INDEX IF NOT EXISTS idx_user_model_prefs_user
  ON user_model_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_repo_model_overrides_repo
  ON repo_model_overrides(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_rule_overrides_repo
  ON repo_rule_overrides(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_skill_overrides_repo
  ON repo_skill_overrides(repo_id);
