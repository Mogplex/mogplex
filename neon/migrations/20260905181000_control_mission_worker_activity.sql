-- Read one owned mission snapshot without a client-side query per worker.
-- Activity is bounded per worker for rendering, not an execution limit.
create index if not exists external_agent_runs_worktree_latest_idx
  on public.external_agent_runs (worktree_id, created_at desc, id desc)
  where worktree_id is not null;

create or replace function public.control_mission_workers(
  p_user_id uuid,
  p_session_id uuid,
  p_include_events boolean default true
) returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  mission_run_id uuid;
  result jsonb;
begin
  select orchestration_run_id into mission_run_id
    from public.control_sessions where id = p_session_id and user_id = p_user_id;
  if not found then return null; end if;
  if mission_run_id is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id, 'worktree_id', w.id, 'branch', w.branch_name,
      'status', r.status, 'error', r.error, 'updated_at', r.updated_at,
      'events', case when p_include_events then (
        select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at, recent.id), '[]'::jsonb)
        from (
          select e.id, e.event_type, e.tool_name, e.message, e.payload, e.created_at
          from public.ai_call_events e
          where e.user_id = p_user_id and e.ai_call_id = r.ai_call_id
          order by e.created_at desc, e.id desc limit 100
        ) recent
      ) else '[]'::jsonb end
    ) order by w.created_at, w.id
  ), '[]'::jsonb) into result
  from public.orchestration_worktrees w
  cross join lateral (
    select a.id, a.ai_call_id, a.status, a.error, a.updated_at
    from public.external_agent_runs a
    where a.worktree_id = w.id and a.user_id = p_user_id
    order by a.created_at desc, a.id desc limit 1
  ) r
  where w.run_id = mission_run_id and w.user_id = p_user_id;
  return result;
end;
$$;

revoke all on function public.control_mission_workers(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.control_mission_workers(uuid, uuid, boolean) to service_role;
