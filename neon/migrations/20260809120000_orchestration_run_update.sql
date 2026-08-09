-- Operator-facing partial update for orchestration runs (PATCH
-- /api/orchestrations/[runId]): title, approval_mode, and a jsonb metadata
-- merge. Exists as an RPC because PostgREST updates replace jsonb columns
-- wholesale — `metadata || patch` must happen in the database or concurrent
-- writers (transition RPCs also patch metadata) lose keys.
--
-- Ownership is enforced here (id AND user_id) so the function is safe to call
-- with any authenticated caller's id; status is deliberately NOT updatable —
-- status changes go through transition_orchestration_run's compare-and-swap.

create or replace function public.update_orchestration_run(
  p_run_id uuid,
  p_user_id uuid,
  p_title text default null,
  p_approval_mode text default null,
  p_metadata_patch jsonb default null
) returns boolean
language plpgsql
as $$
begin
  update public.orchestration_runs
  set title = coalesce(p_title, title),
      approval_mode = coalesce(p_approval_mode, approval_mode),
      metadata = case when p_metadata_patch is not null
        then metadata || p_metadata_patch else metadata end
  where id = p_run_id and user_id = p_user_id;

  return found;
end;
$$;

revoke all on function public.update_orchestration_run(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_orchestration_run(uuid, uuid, text, text, jsonb)
  to service_role;
