
-- Profiles (standalone, no auth.users FK for Vercel OAuth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  github_username TEXT,
  github_token TEXT,
  vercel_id TEXT UNIQUE,
  username TEXT,
  name TEXT,
  avatar_url TEXT,
  vercel_token TEXT,
  email TEXT,
  vercel_team_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_vercel_id ON profiles(vercel_id);

-- Repositories
CREATE TABLE IF NOT EXISTS repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  github_id BIGINT UNIQUE,
  full_name TEXT NOT NULL,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent configurations
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT DEFAULT 'minimax/minimax-m2.5',
  system_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('pr_review', 'cron_refactor')),
  cron_schedule TEXT,
  skill_id TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Job runs
CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'running', 'success', 'failed')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  input_tokens INT,
  output_tokens INT,
  duration_ms INT,
  error TEXT,
  metadata JSONB
);

-- Tool calls
CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_run_id UUID REFERENCES job_runs(id) ON DELETE CASCADE,
  tool_name TEXT,
  input JSONB,
  output JSONB,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Custom commands
CREATE TABLE IF NOT EXISTS custom_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SSH connections
CREATE TABLE IF NOT EXISTS ssh_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent rules
CREATE TABLE IF NOT EXISTS agent_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'rules',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent skills
CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'skills',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI Models
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  context_length INTEGER,
  capabilities TEXT[] DEFAULT '{}',
  pricing_input NUMERIC,
  pricing_output NUMERIC,
  is_available BOOLEAN DEFAULT true,
  is_recommended BOOLEAN DEFAULT false,
  recommendation_bucket TEXT CHECK (recommendation_bucket IN ('open', 'frontier')),
  recommendation_rank INTEGER,
  recommendation_reason TEXT,
  recommended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_available ON ai_models(is_available);
CREATE INDEX IF NOT EXISTS idx_ai_models_recommended ON ai_models(is_recommended);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT 'minimax/minimax-m2.5',
  mode TEXT NOT NULL DEFAULT 'AUTO',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  local_msgs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

-- Skills
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'runbook' CHECK (type IN ('runbook', 'tool', 'prompt', 'workflow')),
  content TEXT NOT NULL,
  model TEXT DEFAULT 'minimax/minimax-m2.5',
  is_public BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(type);
CREATE INDEX IF NOT EXISTS idx_skills_public ON skills(is_public) WHERE is_public = true;

-- Sandboxes
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
;
