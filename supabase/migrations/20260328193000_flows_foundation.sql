create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  installation_id bigint not null,
  name text not null,
  description text,
  notes text,
  source_kind text not null default 'github' check (source_kind in ('github')),
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  draft_graph jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  published_version_id uuid,
  legacy_trigger_id uuid references public.triggers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_flows_legacy_trigger_id
  on public.flows (legacy_trigger_id)
  where legacy_trigger_id is not null;

create index if not exists idx_flows_user_created
  on public.flows (user_id, created_at desc);

create index if not exists idx_flows_installation_status
  on public.flows (installation_id, status);

create table if not exists public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  version_number integer not null,
  graph jsonb not null,
  created_at timestamptz not null default now(),
  unique (flow_id, version_number)
);

create index if not exists idx_flow_versions_flow_created
  on public.flow_versions (flow_id, created_at desc);

alter table public.flows
  add constraint flows_published_version_id_fkey
  foreign key (published_version_id)
  references public.flow_versions(id)
  on delete set null;

create table if not exists public.flow_node_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  flow_version_id uuid references public.flow_versions(id) on delete set null,
  node_id text not null,
  node_type text not null check (node_type in ('start', 'agent', 'end')),
  node_label text,
  status text not null check (status in ('pending', 'running', 'success', 'failed', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  error text,
  output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_flow_node_runs_job
  on public.flow_node_runs (job_run_id, created_at asc);

create index if not exists idx_flow_node_runs_flow
  on public.flow_node_runs (flow_id, created_at desc);

alter table public.triggers
  add column if not exists flow_id uuid references public.flows(id) on delete set null;

alter table public.triggers
  add column if not exists flow_version_id uuid references public.flow_versions(id) on delete set null;

create index if not exists idx_triggers_flow_id
  on public.triggers (flow_id)
  where flow_id is not null;

alter table public.job_runs
  add column if not exists flow_id uuid references public.flows(id) on delete set null;

alter table public.job_runs
  add column if not exists flow_version_id uuid references public.flow_versions(id) on delete set null;

create index if not exists idx_job_runs_flow_id
  on public.job_runs (flow_id, created_at desc)
  where flow_id is not null;

alter table public.flows enable row level security;
alter table public.flow_versions enable row level security;
alter table public.flow_node_runs enable row level security;

drop policy if exists "Users can manage own flows" on public.flows;
create policy "Users can manage own flows"
  on public.flows for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

drop policy if exists "Users can view own flow versions" on public.flow_versions;
create policy "Users can view own flow versions"
  on public.flow_versions for select
  using (
    exists (
      select 1
      from public.flows f
      where f.id = flow_versions.flow_id
        and f.user_id = public.current_profile_id()
    )
  );

drop policy if exists "Users can insert own flow versions" on public.flow_versions;
create policy "Users can insert own flow versions"
  on public.flow_versions for insert
  with check (
    exists (
      select 1
      from public.flows f
      where f.id = flow_versions.flow_id
        and f.user_id = public.current_profile_id()
    )
  );

drop policy if exists "Users can view own flow node runs" on public.flow_node_runs;
create policy "Users can view own flow node runs"
  on public.flow_node_runs for select
  using (user_id = public.current_profile_id());

drop policy if exists "Users can insert own flow node runs" on public.flow_node_runs;
create policy "Users can insert own flow node runs"
  on public.flow_node_runs for insert
  with check (user_id = public.current_profile_id());

drop policy if exists "Users can update own flow node runs" on public.flow_node_runs;
create policy "Users can update own flow node runs"
  on public.flow_node_runs for update
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

with missing_flows as (
  insert into public.flows (
    user_id,
    installation_id,
    name,
    description,
    notes,
    source_kind,
    status,
    draft_graph,
    legacy_trigger_id,
    created_at,
    updated_at
  )
  select
    t.user_id,
    t.installation_id,
    coalesce(a.name, 'Agent') || ' · ' ||
      case t.event
        when 'mention' then '@mention'
        when 'pr_opened' then 'PR opened'
        when 'issue_opened' then 'Issue opened'
        when 'pr_comment' then 'PR comment'
        when 'issue_comment' then 'Issue comment'
        when 'push' then 'Push'
        when 'ci_failure' then 'CI failure'
        else t.event
      end,
    'Migrated from Trigger',
    null,
    'github',
    case when t.enabled then 'active' else 'inactive' end,
    jsonb_build_object(
      'nodes', jsonb_build_array(
        jsonb_build_object(
          'id', 'start',
          'type', 'start',
          'position', jsonb_build_object('x', 80, 'y', 140),
          'data', jsonb_build_object(
            'label',
            case t.event
              when 'mention' then '@mention'
              when 'pr_opened' then 'PR opened'
              when 'issue_opened' then 'Issue opened'
              when 'pr_comment' then 'PR comment'
              when 'issue_comment' then 'Issue comment'
              when 'push' then 'Push'
              when 'ci_failure' then 'CI failure'
              else t.event
            end,
            'event', t.event,
            'isDefault', t.is_default
          )
        ),
        jsonb_build_object(
          'id', 'agent-1',
          'type', 'agent',
          'position', jsonb_build_object('x', 360, 'y', 140),
          'data', jsonb_build_object(
            'label', coalesce(a.name, 'Agent'),
            'agentId', t.agent_id
          )
        ),
        jsonb_build_object(
          'id', 'end',
          'type', 'end',
          'position', jsonb_build_object('x', 640, 'y', 140),
          'data', jsonb_build_object('label', 'Done')
        )
      ),
      'edges', jsonb_build_array(
        jsonb_build_object('id', 'start-agent-1', 'source', 'start', 'target', 'agent-1'),
        jsonb_build_object('id', 'agent-1-end', 'source', 'agent-1', 'target', 'end')
      ),
      'viewport', jsonb_build_object('x', 0, 'y', 0, 'zoom', 1)
    ),
    t.id,
    t.created_at,
    now()
  from public.triggers t
  left join public.agents a on a.id = t.agent_id
  where not exists (
    select 1 from public.flows f where f.legacy_trigger_id = t.id
  )
  returning id, legacy_trigger_id, draft_graph, created_at
),
inserted_versions as (
  insert into public.flow_versions (flow_id, version_number, graph, created_at)
  select
    mf.id,
    1,
    mf.draft_graph,
    mf.created_at
  from missing_flows mf
  returning id, flow_id
)
update public.flows f
set published_version_id = iv.id
from inserted_versions iv
where f.id = iv.flow_id
  and f.published_version_id is null;

update public.triggers t
set
  flow_id = f.id,
  flow_version_id = f.published_version_id
from public.flows f
where f.legacy_trigger_id = t.id
  and (t.flow_id is distinct from f.id or t.flow_version_id is distinct from f.published_version_id);

update public.job_runs jr
set
  flow_id = t.flow_id,
  flow_version_id = t.flow_version_id
from public.triggers t
where jr.trigger_id = t.id
  and (jr.flow_id is null or jr.flow_version_id is null);
