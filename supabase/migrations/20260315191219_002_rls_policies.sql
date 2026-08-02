
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssh_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandboxes ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Repos
CREATE POLICY "repos_select" ON repos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "repos_insert" ON repos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "repos_update" ON repos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "repos_delete" ON repos FOR DELETE USING (auth.uid() = user_id);

-- Agents
CREATE POLICY "agents_select" ON agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "agents_insert" ON agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agents_update" ON agents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "agents_delete" ON agents FOR DELETE USING (auth.uid() = user_id);

-- Assignments (via repo ownership)
CREATE POLICY "assignments_select" ON assignments FOR SELECT USING (
  repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid())
);
CREATE POLICY "assignments_insert" ON assignments FOR INSERT WITH CHECK (
  repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid())
);
CREATE POLICY "assignments_update" ON assignments FOR UPDATE USING (
  repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid())
);
CREATE POLICY "assignments_delete" ON assignments FOR DELETE USING (
  repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid())
);

-- Job runs
CREATE POLICY "job_runs_select" ON job_runs FOR SELECT USING (
  assignment_id IN (
    SELECT a.id FROM assignments a JOIN repos r ON a.repo_id = r.id WHERE r.user_id = auth.uid()
  )
);
CREATE POLICY "job_runs_insert" ON job_runs FOR INSERT WITH CHECK (
  assignment_id IN (
    SELECT a.id FROM assignments a JOIN repos r ON a.repo_id = r.id WHERE r.user_id = auth.uid()
  )
);

-- Tool calls
CREATE POLICY "tool_calls_select" ON tool_calls FOR SELECT USING (
  job_run_id IN (
    SELECT jr.id FROM job_runs jr JOIN assignments a ON jr.assignment_id = a.id JOIN repos r ON a.repo_id = r.id WHERE r.user_id = auth.uid()
  )
);

-- Custom commands
CREATE POLICY "custom_commands_select" ON custom_commands FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "custom_commands_insert" ON custom_commands FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "custom_commands_delete" ON custom_commands FOR DELETE USING (auth.uid() = user_id);

-- SSH connections
CREATE POLICY "ssh_select_own" ON ssh_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ssh_insert_own" ON ssh_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ssh_update_own" ON ssh_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ssh_delete_own" ON ssh_connections FOR DELETE USING (auth.uid() = user_id);

-- Agent rules & skills
CREATE POLICY "rules_own" ON agent_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "skills_own" ON agent_skills FOR ALL USING (auth.uid() = user_id);

-- AI Models (public read, service role write)
CREATE POLICY "Anyone can read ai_models" ON ai_models FOR SELECT USING (true);
CREATE POLICY "Service role can manage ai_models" ON ai_models FOR ALL USING (auth.role() = 'service_role');

-- Conversations
CREATE POLICY "conversations_select" ON conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "conversations_insert" ON conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conversations_update" ON conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "conversations_delete" ON conversations FOR DELETE USING (auth.uid() = user_id);

-- Skills
CREATE POLICY "skills_select" ON skills FOR SELECT USING (auth.uid() = user_id OR is_public = true);
CREATE POLICY "skills_insert" ON skills FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skills_update" ON skills FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "skills_delete" ON skills FOR DELETE USING (auth.uid() = user_id);

-- Sandboxes
CREATE POLICY "sandboxes_own" ON sandboxes FOR ALL USING (auth.uid() = user_id);
;
