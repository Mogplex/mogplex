-- Roster agents become runnable outside Flows. An agent can be shared with a
-- team, carries attached skills and rules that materialize into the sandbox,
-- and is recorded on the runs that used it. All access goes through the
-- service role: the app resolves ownership or team membership before reads.

alter table public.agents
  add column if not exists team_id uuid
  references public.teams(id) on delete set null;

create index if not exists idx_agents_team
  on public.agents (team_id)
  where team_id is not null;

-- Slugs identify agents in Slack and MCP. Personal slugs stay unique per user;
-- shared slugs must also be unique within the team they are shared with.
create unique index if not exists idx_agents_team_slug
  on public.agents (team_id, slug)
  where team_id is not null and slug is not null;

create table if not exists public.agent_skill_links (
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (agent_id, skill_id)
);

create index if not exists idx_agent_skill_links_skill
  on public.agent_skill_links (skill_id);

alter table public.agent_skill_links enable row level security;
-- Fresh databases may lack the Supabase-style roles; grants only apply
-- where they exist. Access goes through the service role either way.
do $$
begin
  if exists (select 1 from pg_roles where rolname in ('anon', 'authenticated')) then
    execute 'revoke all on table public.agent_skill_links from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.agent_skill_links to service_role';
  end if;
end
$$;

create table if not exists public.agent_rule_links (
  agent_id uuid not null references public.agents(id) on delete cascade,
  rule_id uuid not null references public.agent_rules(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (agent_id, rule_id)
);

create index if not exists idx_agent_rule_links_rule
  on public.agent_rule_links (rule_id);

alter table public.agent_rule_links enable row level security;
-- Fresh databases may lack the Supabase-style roles; grants only apply
-- where they exist. Access goes through the service role either way.
do $$
begin
  if exists (select 1 from pg_roles where rolname in ('anon', 'authenticated')) then
    execute 'revoke all on table public.agent_rule_links from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.agent_rule_links to service_role';
  end if;
end
$$;

-- A run remembers which roster agent shaped it so the roster can show usage.
-- Deleting the agent keeps the run history; the reference just clears.
alter table public.external_agent_runs
  add column if not exists agent_id uuid
  references public.agents(id) on delete set null;

create index if not exists idx_external_agent_runs_agent
  on public.external_agent_runs (agent_id, created_at desc)
  where agent_id is not null;

-- Slack channels can pin a roster agent next to the harness choice.
alter table public.slack_harness_preferences
  add column if not exists agent_id uuid
  references public.agents(id) on delete set null;
