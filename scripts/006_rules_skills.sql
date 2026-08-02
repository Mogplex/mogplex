CREATE TABLE IF NOT EXISTS agent_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'rules',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'skills',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agent_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules_own" ON agent_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "skills_own" ON agent_skills FOR ALL USING (auth.uid() = user_id);
