-- First-class Git worktrees for orchestration. A worktree is a checkout inside
-- a sandbox, not the sandbox itself. Its row survives sandbox pause/stop and is
-- retired only by explicit archive/prune operations.

alter table public.orchestration_runs
  add constraint orchestration_runs_identity_key unique (id, user_id, repo_id);

alter table public.orchestration_tasks
  add constraint orchestration_tasks_identity_key unique (id, run_id, repo_id);

create table if not exists public.orchestration_worktrees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id uuid not null,
  task_id uuid not null,
  repo_id uuid not null,
  sandbox_id uuid not null,
  agent_id uuid,
  branch_name text not null,
  base_branch text not null,
  checkout_path text not null,
  status text not null default 'creating'
    check (status in ('creating', 'active', 'archived', 'pruned', 'error')),
  latest_commit_sha text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  pruned_at timestamptz,
  constraint orchestration_worktrees_run_owner_repo_fk
    foreign key (run_id, user_id, repo_id)
    references public.orchestration_runs (id, user_id, repo_id)
    on delete cascade,
  constraint orchestration_worktrees_task_run_repo_fk
    foreign key (task_id, run_id, repo_id)
    references public.orchestration_tasks (id, run_id, repo_id)
    on delete cascade,
  constraint orchestration_worktrees_managed_path_check
    check (
      checkout_path like '/%/.worktrees/' || id::text
      and position('/../' in checkout_path) = 0
    ),
  constraint orchestration_worktrees_archive_timestamp_check
    check (status <> 'archived' or archived_at is not null),
  constraint orchestration_worktrees_prune_timestamp_check
    check (status <> 'pruned' or pruned_at is not null),
  constraint orchestration_worktrees_link_identity_key
    unique (id, task_id, run_id, repo_id),
  constraint orchestration_worktrees_worker_identity_key
    unique (id, user_id, repo_id, sandbox_id)
);

create unique index orchestration_worktrees_task_live_idx
  on public.orchestration_worktrees (task_id)
  where status <> 'pruned';

create unique index orchestration_worktrees_checkout_live_idx
  on public.orchestration_worktrees (sandbox_id, checkout_path)
  where status <> 'pruned';

create unique index orchestration_worktrees_branch_live_idx
  on public.orchestration_worktrees (sandbox_id, branch_name)
  where status <> 'pruned';

create index orchestration_worktrees_run_status_idx
  on public.orchestration_worktrees (run_id, status, created_at);

alter table public.orchestration_worktrees enable row level security;
revoke all on public.orchestration_worktrees from public, anon, authenticated;

create trigger orchestration_worktrees_updated_at
  before update on public.orchestration_worktrees
  for each row execute function public.orchestration_set_updated_at();

alter table public.orchestration_tasks
  add column if not exists worktree_id uuid;

alter table public.orchestration_tasks
  add constraint orchestration_tasks_worktree_identity_fk
  foreign key (worktree_id, id, run_id, repo_id)
  references public.orchestration_worktrees (id, task_id, run_id, repo_id);

alter table public.control_sessions
  add column if not exists orchestration_run_id uuid;

alter table public.control_sessions
  add constraint control_sessions_orchestration_run_owner_repo_fk
  foreign key (orchestration_run_id, user_id, repo_id)
  references public.orchestration_runs (id, user_id, repo_id)
  on delete set null (orchestration_run_id);

create index control_sessions_orchestration_run_idx
  on public.control_sessions (orchestration_run_id)
  where orchestration_run_id is not null;

alter table public.external_agent_runs
  add column if not exists worktree_id uuid;

alter table public.external_agent_runs
  add constraint external_agent_runs_worktree_identity_fk
  foreign key (worktree_id, user_id, repo_id, sandbox_record_id)
  references public.orchestration_worktrees (id, user_id, repo_id, sandbox_id)
  on delete set null (worktree_id);

alter table public.external_agent_runs
  add constraint external_agent_runs_worktree_sandbox_required_check
  check (worktree_id is null or sandbox_record_id is not null);

create index external_agent_runs_worktree_idx
  on public.external_agent_runs (worktree_id)
  where worktree_id is not null;

-- Keep each lifecycle transition and its task binding in one transaction.
-- The service role is the only caller; browser roles have no table access.
create or replace function public.activate_orchestration_worktree(
  p_worktree_id uuid,
  p_user_id uuid,
  p_checkout_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worktree public.orchestration_worktrees;
begin
  update public.orchestration_worktrees
  set checkout_path = p_checkout_path,
      status = 'active',
      error = null
  where id = p_worktree_id
    and user_id = p_user_id
    and status in ('creating', 'error')
  returning * into v_worktree;

  if not found then
    raise exception 'worktree is not available for activation';
  end if;

  update public.orchestration_tasks
  set worktree_id = v_worktree.id,
      sandbox_id = v_worktree.sandbox_id,
      root_directory = v_worktree.checkout_path
  where id = v_worktree.task_id
    and run_id = v_worktree.run_id
    and repo_id = v_worktree.repo_id;

  if not found then
    raise exception 'worktree task is not available for binding';
  end if;

  return to_jsonb(v_worktree);
end;
$$;

create or replace function public.prune_orchestration_worktree(
  p_worktree_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worktree public.orchestration_worktrees;
begin
  update public.orchestration_worktrees
  set status = 'pruned',
      pruned_at = now()
  where id = p_worktree_id
    and user_id = p_user_id
    and status = 'archived'
  returning * into v_worktree;

  if not found then
    raise exception 'archived worktree not found';
  end if;

  update public.orchestration_tasks
  set worktree_id = null,
      root_directory = null
  where id = v_worktree.task_id
    and worktree_id = v_worktree.id;

  return to_jsonb(v_worktree);
end;
$$;

create or replace function public.bind_orchestration_worktree_agent(
  p_worktree_id uuid,
  p_user_id uuid,
  p_agent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worktree public.orchestration_worktrees;
begin
  update public.orchestration_worktrees
  set agent_id = p_agent_id
  where id = p_worktree_id
    and user_id = p_user_id
    and status = 'active'
  returning * into v_worktree;

  if not found then
    raise exception 'active worktree not found';
  end if;

  update public.orchestration_tasks
  set agent_id = p_agent_id
  where id = v_worktree.task_id
    and run_id = v_worktree.run_id
    and repo_id = v_worktree.repo_id;

  if not found then
    raise exception 'worktree task is not available for agent binding';
  end if;

  return to_jsonb(v_worktree);
end;
$$;

-- A plan is one logical write: never leave a mission with only some specs or
-- tasks when one insert fails.
create or replace function public.create_orchestration_plan(
  p_run_id uuid,
  p_user_id uuid,
  p_objective text,
  p_context text,
  p_constraints text[],
  p_tasks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.orchestration_runs;
  v_task jsonb;
  v_spec_id uuid;
  v_task_row public.orchestration_tasks;
  v_tasks jsonb := '[]'::jsonb;
begin
  select * into v_run
  from public.orchestration_runs
  where id = p_run_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'mission not found';
  end if;
  if exists (select 1 from public.orchestration_specs where run_id = p_run_id) then
    raise exception 'mission plan already exists';
  end if;

  insert into public.orchestration_specs
    (run_id, kind, slug, title, file_path, acceptance_criteria, prompt)
  values
    (v_run.id, 'master', 'master', v_run.title,
     'specs/' || v_run.slug || '/MASTER.md', coalesce(p_constraints, '{}'),
     concat_ws(E'\n\n', p_objective, nullif(p_context, '')));

  for v_task in select value from jsonb_array_elements(p_tasks)
  loop
    insert into public.orchestration_specs
      (run_id, kind, order_index, slug, title, file_path, branch_name,
       owned_paths, blocked_paths, depends_on, acceptance_criteria,
       validation_commands, prompt)
    values
      (v_run.id, 'task', (v_task->>'orderIndex')::integer,
       v_task->>'slug', v_task->>'title', v_task->>'filePath',
       v_task->>'branchName',
       array(select jsonb_array_elements_text(v_task->'ownedPaths')),
       array(select jsonb_array_elements_text(v_task->'blockedPaths')),
       array(select jsonb_array_elements_text(v_task->'dependsOn')),
       array(select jsonb_array_elements_text(v_task->'acceptanceCriteria')),
       array(select jsonb_array_elements_text(v_task->'validationCommands')),
       v_task->>'prompt')
    returning id into v_spec_id;

    insert into public.orchestration_tasks
      (run_id, spec_id, repo_id, harness, branch_name, base_branch)
    values
      (v_run.id, v_spec_id, v_run.repo_id, v_task->>'harness',
       v_task->>'branchName', v_run.base_branch)
    returning * into v_task_row;

    v_tasks := v_tasks || jsonb_build_array(to_jsonb(v_task_row));
  end loop;

  insert into public.orchestration_events
    (run_id, repo_id, type, message, metadata)
  values
    (v_run.id, v_run.repo_id, 'mission_planned',
     'Mission planned with ' || jsonb_array_length(v_tasks) ||
       case when jsonb_array_length(v_tasks) = 1 then ' task' else ' tasks' end,
     jsonb_build_object(
       'taskIds',
       (select coalesce(jsonb_agg(task->>'id'), '[]'::jsonb)
        from jsonb_array_elements(v_tasks) task)
     ));

  return v_tasks;
end;
$$;

revoke all on function public.activate_orchestration_worktree(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.prune_orchestration_worktree(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.bind_orchestration_worktree_agent(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_orchestration_plan(uuid, uuid, text, text, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.activate_orchestration_worktree(uuid, uuid, text)
  to service_role;
grant execute on function public.prune_orchestration_worktree(uuid, uuid)
  to service_role;
grant execute on function public.bind_orchestration_worktree_agent(uuid, uuid, uuid)
  to service_role;
grant execute on function public.create_orchestration_plan(uuid, uuid, text, text, text[], jsonb)
  to service_role;
