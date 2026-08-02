-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_username text,
  github_token text,
  created_at timestamptz default now()
);

-- Repositories
create table if not exists repos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  github_id bigint unique,
  full_name text not null,
  webhook_secret text,
  created_at timestamptz default now()
);

-- Agent configurations
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  name text not null,
  model text default 'minimax/minimax-m2.5',
  system_prompt text,
  created_at timestamptz default now()
);

-- Assignments
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid references repos(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  type text check (type in ('pr_review', 'cron_refactor')),
  cron_schedule text,
  skill_id text,
  enabled boolean default true,
  created_at timestamptz default now()
);

-- Job runs
create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references assignments(id) on delete cascade,
  status text check (status in ('pending', 'running', 'success', 'failed')),
  started_at timestamptz default now(),
  completed_at timestamptz,
  input_tokens int,
  output_tokens int,
  duration_ms int,
  error text,
  metadata jsonb
);

-- Tool calls
create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid references job_runs(id) on delete cascade,
  tool_name text,
  input jsonb,
  output jsonb,
  duration_ms int,
  created_at timestamptz default now()
);
