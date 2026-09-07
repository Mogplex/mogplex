-- Preserve earlier tasks and checkouts when a Control thread receives new work.
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
      error = null,
      archived_at = null
  where id = p_worktree_id
    and user_id = p_user_id
    and (status in ('creating', 'error') or
      (status = 'archived' and checkout_path = p_checkout_path
       and checkout_path not like '/.reserved/%'))
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
  v_spec_row public.orchestration_specs;
  v_created integer := 0;
  v_tasks jsonb := '[]'::jsonb;
  v_plan jsonb := jsonb_build_object('objective', p_objective,
    'context', coalesce(p_context, ''), 'constraints', coalesce(p_constraints, '{}'));
begin
  select * into v_run
  from public.orchestration_runs
  where id = p_run_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'mission not found';
  end if;

  insert into public.orchestration_specs
    (run_id, kind, slug, title, file_path, acceptance_criteria, prompt)
  values
    (v_run.id, 'master', 'master', v_run.title,
     'specs/' || v_run.slug || '/MASTER.md', coalesce(p_constraints, '{}'),
     concat_ws(E'\n\n', p_objective, nullif(p_context, '')))
  on conflict (run_id, slug) do nothing;

  for v_task in select value from jsonb_array_elements(p_tasks)
  loop
    select * into v_spec_row from public.orchestration_specs
    where run_id = p_run_id and slug = v_task->>'slug';
    if found then
      select * into v_task_row from public.orchestration_tasks
      where run_id = p_run_id and spec_id = v_spec_row.id;
      if not found or v_spec_row.kind <> 'task' or
        v_spec_row.title is distinct from v_task->>'title' or
        v_spec_row.prompt is distinct from v_task->>'prompt' or
        v_task_row.harness is distinct from v_task->>'harness' or
        (v_task_row.metadata ? 'plan' and v_task_row.metadata->'plan' is distinct from v_plan) or
        v_spec_row.owned_paths is distinct from array(select jsonb_array_elements_text(v_task->'ownedPaths')) or
        v_spec_row.blocked_paths is distinct from array(select jsonb_array_elements_text(v_task->'blockedPaths')) or
        v_spec_row.depends_on is distinct from array(select jsonb_array_elements_text(v_task->'dependsOn')) or
        v_spec_row.acceptance_criteria is distinct from array(select jsonb_array_elements_text(v_task->'acceptanceCriteria')) or
        v_spec_row.validation_commands is distinct from array(select jsonb_array_elements_text(v_task->'validationCommands')) then
        raise exception 'Task slug % already has different instructions. Use a new slug for new work.', v_task->>'slug';
      end if;
      v_tasks := v_tasks || jsonb_build_array(to_jsonb(v_task_row));
      continue;
    end if;
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
      (run_id, spec_id, repo_id, harness, branch_name, base_branch, metadata)
    values
      (v_run.id, v_spec_id, v_run.repo_id, v_task->>'harness',
       v_task->>'branchName', v_run.base_branch, jsonb_build_object('plan', v_plan))
    returning * into v_task_row;

    v_tasks := v_tasks || jsonb_build_array(to_jsonb(v_task_row));
    v_created := v_created + 1;
  end loop;

  if v_created > 0 then
  insert into public.orchestration_events
    (run_id, repo_id, type, message, metadata)
  values
    (v_run.id, v_run.repo_id, 'mission_planned',
     'Added ' || v_created || case when v_created = 1 then ' task' else ' tasks' end,
     jsonb_build_object(
       'plan', v_plan,
       'taskIds',
       (select coalesce(jsonb_agg(task->>'id'), '[]'::jsonb)
        from jsonb_array_elements(v_tasks) task)
     ));

  end if;
  return v_tasks;
end;
$$;

-- Restoring and pruning an archived checkout both run sandbox commands
-- between reading the row and writing its next status. A short lease keeps
-- those two operations from interleaving on the same archived checkout.
create or replace function public.claim_archived_worktree(
  p_worktree_id uuid,
  p_user_id uuid,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.orchestration_worktrees
  set metadata = metadata || jsonb_build_object('archived_claim',
    jsonb_build_object('token', v_token, 'claimed_at', now()))
  where id = p_worktree_id
    and user_id = p_user_id
    and status = 'archived'
    and updated_at = p_expected_updated_at
    and (metadata->'archived_claim' is null or
      (metadata->'archived_claim'->>'claimed_at')::timestamptz
        < now() - interval '10 minutes');

  if not found then
    return null;
  end if;
  return v_token;
end;
$$;

create or replace function public.release_archived_worktree(
  p_worktree_id uuid,
  p_user_id uuid,
  p_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orchestration_worktrees
  set metadata = metadata - 'archived_claim'
  where id = p_worktree_id
    and user_id = p_user_id
    and metadata->'archived_claim'->>'token' = p_token::text;
end;
$$;

revoke all on function public.activate_orchestration_worktree(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.activate_orchestration_worktree(uuid,uuid,text) to service_role;
revoke all on function public.create_orchestration_plan(uuid,uuid,text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.create_orchestration_plan(uuid,uuid,text,text,text[],jsonb) to service_role;
revoke all on function public.claim_archived_worktree(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_archived_worktree(uuid,uuid,timestamptz) to service_role;
revoke all on function public.release_archived_worktree(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_archived_worktree(uuid,uuid,uuid) to service_role;
