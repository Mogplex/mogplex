
-- Rules: repos can exclude global rules or add repo-specific ones
CREATE TABLE repo_rule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE NOT NULL,
  rule_id UUID REFERENCES agent_rules(id) ON DELETE CASCADE,
  excluded BOOLEAN DEFAULT false NOT NULL,
  name TEXT,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE repo_rule_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_via_repo" ON repo_rule_overrides
  FOR ALL USING (repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid()));

-- Skills: repos can exclude global skills or add repo-specific ones
CREATE TABLE repo_skill_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE NOT NULL,
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  excluded BOOLEAN DEFAULT false NOT NULL,
  name TEXT,
  description TEXT,
  type TEXT,
  content TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE repo_skill_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_via_repo" ON repo_skill_overrides
  FOR ALL USING (repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid()));

-- Model overrides: repos can restrict models to a subset
CREATE TABLE repo_model_overrides (
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE NOT NULL,
  model_id TEXT REFERENCES ai_models(id) ON DELETE CASCADE NOT NULL,
  excluded BOOLEAN DEFAULT false NOT NULL,
  PRIMARY KEY (repo_id, model_id)
);

ALTER TABLE repo_model_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_via_repo" ON repo_model_overrides
  FOR ALL USING (repo_id IN (SELECT id FROM repos WHERE user_id = auth.uid()));
;
