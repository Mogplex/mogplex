-- Orchestration persistence: DB backing for lib/orchestrations (runs, specs,
-- tasks, merge events, timeline events) — the control-plane "missions"
-- surface. Statuses and transition legality live in TypeScript
-- (lib/orchestrations/status.ts, state-machine.ts); the CHECK constraints
-- here pin the allowed vocabularies and the transition RPCs guarantee
-- atomicity (compare-and-swap), not legality.
--
-- Convention (billing_foundation): no FKs to pre-cutover mirrored tables
-- (profiles, repos, sandboxes, agents) so this migration applies cleanly to
-- fresh environments built from neon/migrations alone. FKs exist only among
-- the orchestration tables themselves.

create table if not exists public.orchestration_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  repo_id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  status text not null default 'drafting_master_spec'
    check (status in (
      'drafting_master_spec', 'awaiting_master_approval',
      'generating_sub_specs', 'awaiting_task_approval',
      'launching_sandboxes', 'running_tasks', 'integrating',
      'conflict_resolution', 'validating', 'ready_for_pr', 'pr_open',
      'completed', 'failed', 'cancelled'
    )),
  request text not null,
  base_branch text not null,
  root_directory text,
  spec_branch text not null,
  integration_branch text not null,
  approval_mode text not null default 'manual'
    check (approval_mode in ('manual', 'auto_dispatch', 'trusted_autopilot')),
  master_spec_path text,
  master_spec_blob_sha text,
  planner_sandbox_id uuid,
  integration_sandbox_id uuid,
  github_pr_number integer,
  github_pr_url text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orchestration_runs_repo_slug_key unique (repo_id, slug)
);

create index orchestration_runs_user_active_idx
  on public.orchestration_runs (user_id, updated_at desc)
  where status not in ('completed', 'cancelled');

create index orchestration_runs_user_created_idx
  on public.orchestration_runs (user_id, created_at desc);

alter table public.orchestration_runs enable row level security;

create table if not exists public.orchestration_specs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.orchestration_runs(id)
    on delete cascade,
  kind text not null check (kind in ('master', 'task', 'integration')),
  order_index integer,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  title text not null,
  -- Deliberately open-ended (matches OrchestrationSpecDTO.status): new spec
  -- statuses must not require a coordinated migration.
  status text not null default 'draft',
  file_path text not null,
  blob_sha text,
  branch_name text,
  owned_paths text[] not null default '{}',
  blocked_paths text[] not null default '{}',
  depends_on text[] not null default '{}',
  acceptance_criteria text[] not null default '{}',
  validation_commands text[] not null default '{}',
  prompt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint orchestration_specs_run_slug_key unique (run_id, slug)
);

create index orchestration_specs_run_idx
  on public.orchestration_specs (run_id, kind, order_index);

alter table public.orchestration_specs enable row level security;

create table if not exists public.orchestration_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.orchestration_runs(id)
    on delete cascade,
  spec_id uuid not null references public.orchestration_specs(id)
    on delete cascade,
  repo_id uuid not null,
  agent_id uuid,
  harness text not null check (harness in ('codex', 'claude-code')),
  sandbox_id uuid,
  branch_name text not null,
  base_branch text not null,
  root_directory text,
  status text not null default 'planned'
    check (status in (
      'planned', 'queued', 'launching_sandbox', 'running', 'needs_user',
      'pushed', 'merge_ready', 'merged', 'conflict', 'failed', 'cancelled'
    )),
  latest_commit_sha text,
  pushed_at timestamptz,
  validation_status text,
  validation_summary text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orchestration_tasks_run_idx
  on public.orchestration_tasks (run_id, created_at);

create index orchestration_tasks_active_idx
  on public.orchestration_tasks (run_id, status)
  where status not in ('merged', 'cancelled');

alter table public.orchestration_tasks enable row level security;

create table if not exists public.orchestration_merge_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.orchestration_runs(id)
    on delete cascade,
  task_id uuid references public.orchestration_tasks(id) on delete cascade,
  source_branch text,
  target_branch text not null,
  status text not null
    check (status in ('started', 'merged', 'conflict', 'resolved', 'failed')),
  commit_sha text,
  conflict_files text[] not null default '{}',
  log text,
  created_at timestamptz not null default now()
);

create index orchestration_merge_events_run_idx
  on public.orchestration_merge_events (run_id, created_at desc);

alter table public.orchestration_merge_events enable row level security;

create table if not exists public.orchestration_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.orchestration_runs(id)
    on delete cascade,
  task_id uuid references public.orchestration_tasks(id) on delete cascade,
  repo_id uuid,
  sandbox_id uuid,
  type text not null,
  level text not null default 'info'
    check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  branch_name text,
  commit_sha text,
  ai_call_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index orchestration_events_run_created_idx
  on public.orchestration_events (run_id, created_at desc);

alter table public.orchestration_events enable row level security;

create or replace function public.orchestration_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orchestration_runs_updated_at
  before update on public.orchestration_runs
  for each row execute function public.orchestration_set_updated_at();

create trigger orchestration_tasks_updated_at
  before update on public.orchestration_tasks
  for each row execute function public.orchestration_set_updated_at();

-- Compare-and-swap status transitions. Legality is validated by the caller
-- (assertRunTransition / assertTaskTransition); these guarantee that exactly
-- one writer wins when two race the same from-status, and that a stale
-- writer observes `false` instead of clobbering.

create or replace function public.transition_orchestration_run(
  p_run_id uuid,
  p_from_status text,
  p_to_status text,
  p_error text default null,
  p_metadata_patch jsonb default null
) returns boolean
language plpgsql
as $$
declare
  v_current text;
begin
  select status into v_current
  from public.orchestration_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'orchestration_run % not found', p_run_id;
  end if;

  if v_current <> p_from_status then
    return false;
  end if;

  update public.orchestration_runs
  set status = p_to_status,
      error = case when p_to_status in ('failed', 'cancelled')
        then coalesce(p_error, error) else p_error end,
      metadata = case when p_metadata_patch is not null
        then metadata || p_metadata_patch else metadata end
  where id = p_run_id;

  return true;
end;
$$;

create or replace function public.transition_orchestration_task(
  p_task_id uuid,
  p_from_status text,
  p_to_status text,
  p_error text default null,
  p_metadata_patch jsonb default null
) returns boolean
language plpgsql
as $$
declare
  v_current text;
begin
  select status into v_current
  from public.orchestration_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'orchestration_task % not found', p_task_id;
  end if;

  if v_current <> p_from_status then
    return false;
  end if;

  update public.orchestration_tasks
  set status = p_to_status,
      error = case when p_to_status in ('failed', 'conflict', 'needs_user')
        then coalesce(p_error, error) else p_error end,
      metadata = case when p_metadata_patch is not null
        then metadata || p_metadata_patch else metadata end,
      pushed_at = case when p_to_status = 'pushed'
        then coalesce(pushed_at, now()) else pushed_at end
  where id = p_task_id;

  return true;
end;
$$;

revoke all on function public.transition_orchestration_run(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_orchestration_run(uuid, text, text, text, jsonb)
  to service_role;

revoke all on function public.transition_orchestration_task(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_orchestration_task(uuid, text, text, text, jsonb)
  to service_role;
