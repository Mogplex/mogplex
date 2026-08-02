-- Slice 3: Wait vs Await. Persist external-event waits ("await_event" operator)
-- so a paused flow run can be resumed from a matching webhook delivery without
-- losing its place in the graph.

create table if not exists public.flow_waits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  flow_version_id uuid references public.flow_versions(id) on delete set null,
  installation_id bigint,
  repo_id uuid references public.repos(id) on delete set null,
  node_id text not null,
  wait_kind text not null,
  wait_config jsonb not null default '{}'::jsonb,
  resume_token text not null unique,
  status text not null check (status in ('waiting', 'resumed', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  resumed_at timestamptz,
  resume_payload jsonb,
  resume_delivery_id text
);

-- Routing index: webhook handlers look up active waits by user + installation +
-- kind, then narrow by repo/config in app code. Status is included in the index
-- so the common "find waiting waits" lookup can stay index-only.
create index if not exists idx_flow_waits_routing
  on public.flow_waits (user_id, installation_id, wait_kind, status);

create index if not exists idx_flow_waits_job_run
  on public.flow_waits (job_run_id);

create index if not exists idx_flow_waits_repo_status
  on public.flow_waits (repo_id, status)
  where repo_id is not null;

alter table public.flow_waits enable row level security;

drop policy if exists "Users can view own flow waits" on public.flow_waits;
create policy "Users can view own flow waits"
  on public.flow_waits for select
  using (user_id = public.current_profile_id());

-- Inserts/updates happen via the service-role admin client during automation
-- execution; no end-user-facing write policies are needed yet.

-- Widen flow_node_runs.node_type to include the new await_event operator. The
-- previous slice already widened to start/agent/condition/parallel/join/delay/
-- end; we extend that union here.
alter table public.flow_node_runs
  drop constraint if exists flow_node_runs_node_type_check;

alter table public.flow_node_runs
  add constraint flow_node_runs_node_type_check
  check (
    node_type in (
      'start',
      'agent',
      'condition',
      'parallel',
      'join',
      'delay',
      'await_event',
      'end'
    )
  );
