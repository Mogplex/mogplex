-- Report the job status observed while the rollback holds the job row lock.
-- This keeps a concurrent cancellation from being returned to the caller as
-- pending. The v1 function remains in place for rollback compatibility.
create or replace function public.rollback_billing_automation_job_start_v2(
  p_job_run_id uuid,
  p_source_ref text,
  p_rolled_back_at timestamptz,
  p_metadata jsonb
) returns table (
  reset boolean,
  lease_released boolean,
  job_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.billing_workflow_capacity_leases%rowtype;
  v_reset boolean := false;
  v_released boolean := false;
  v_job_status text;
begin
  select status into v_job_status
  from public.job_runs
  where id = p_job_run_id
  for update;
  if not found then
    return query select false, false, null::text;
    return;
  end if;

  select lease.* into v_lease
  from public.billing_workflow_capacity_leases lease
  left join public.billing_workflow_capacity_release_events release
    on release.lease_id = lease.id
  where lease.root_workflow_ref = p_job_run_id::text
    and release.id is null
  order by lease.id desc
  limit 1;

  if found then
    perform 1
    from public.billing_accounts
    where id = v_lease.account_id
    for update;

    insert into public.billing_workflow_capacity_release_events (
      lease_id,
      terminal_outcome,
      source_ref,
      released_at,
      metadata
    ) values (
      v_lease.id,
      'failure',
      btrim(p_source_ref) || ':lease:' || v_lease.id::text,
      p_rolled_back_at,
      coalesce(p_metadata, '{}')
    ) on conflict (lease_id) do nothing;
    v_released := found;
  end if;

  update public.job_runs
  set status = 'pending',
      started_at = null,
      completed_at = null,
      duration_ms = null,
      input_tokens = null,
      output_tokens = null,
      error = null,
      runtime_provider = null,
      runtime_run_id = null,
      workflow_run_id = null
  where id = p_job_run_id
    and status = 'running';
  v_reset := found;
  if v_reset then
    v_job_status := 'pending';
  end if;

  return query select v_reset, v_released, v_job_status;
end;
$$;

revoke all on function public.rollback_billing_automation_job_start_v2(
  uuid, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.rollback_billing_automation_job_start_v2(
  uuid, text, timestamptz, jsonb
) to service_role;
