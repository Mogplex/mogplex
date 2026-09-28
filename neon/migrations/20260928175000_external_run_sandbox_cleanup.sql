-- A completed dedicated run releases compute even while its preview tab is
-- open. Keep shared worktrees, other active work, and later resumes untouched.
create function public.claim_terminal_run_sandbox_pause(
  p_run_id uuid, p_user_id uuid, p_ai_call_id uuid, p_runtime_run_id text
) returns setof public.sandboxes
language plpgsql security definer set search_path = public as $$
declare
  r public.external_agent_runs;
  s public.sandboxes;
begin
  select * into r from public.external_agent_runs
  where id = p_run_id and user_id = p_user_id
    and ai_call_id = p_ai_call_id
    and runtime_run_id is not distinct from p_runtime_run_id
    and status in ('success', 'failed', 'cancelled')
    and create_branch and worktree_id is null for update;
  if not found then return; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sandbox-presence:' || r.sandbox_record_id::text, 0)
  );
  select * into s from public.sandboxes
  where id = r.sandbox_record_id for update;
  if not found or s.status <> 'running' or s.persistent is not true
    or s.sandbox_id is distinct from r.sandbox_id
    or s.user_id is distinct from r.user_id
    or s.repo_id is distinct from r.repo_id
    or s.working_branch is distinct from r.working_branch
    or s.exec_lock_token is not null then return; end if;

  -- completed_at is immutable across notification retries. A later workspace
  -- resume or interaction must not be stopped by an old supervisor retry.
  if not exists (
    select 1 from public.external_agent_runs current_run
    join public.ai_calls ac on ac.id = current_run.ai_call_id
    where current_run.id = r.id and current_run.user_id = p_user_id
      and current_run.ai_call_id = p_ai_call_id
      and current_run.runtime_run_id is not distinct from p_runtime_run_id
      and current_run.status in ('success', 'failed', 'cancelled')
      and ac.user_id = p_user_id
      and ac.status in ('success', 'failed', 'cancelled')
      and s.last_active_at <= ac.completed_at
  ) or exists (
    select 1 from public.external_agent_runs other_run
    where other_run.sandbox_record_id = s.id
      and other_run.status in ('pending', 'streaming', 'awaiting_input')
  ) or exists (
    select 1 from public.ai_calls ac
    where ac.status in ('pending', 'streaming') and (
      ac.metadata->>'sandbox_record_id' = s.id::text
      or ac.metadata->>'sandbox_id' in (s.id::text, s.sandbox_id)
    )
  ) then return; end if;

  update public.sandboxes set status = 'pausing', health_status = 'pausing',
    stop_reason = 'auto_pause', last_active_at = now()
  where id = s.id;
  return next s;
end;
$$;
revoke all on function public.claim_terminal_run_sandbox_pause(uuid,uuid,uuid,text)
  from public;
grant execute on function public.claim_terminal_run_sandbox_pause(uuid,uuid,uuid,text)
  to service_role;
