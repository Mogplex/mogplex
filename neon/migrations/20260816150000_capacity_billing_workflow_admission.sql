-- Atomic root-workflow admission for capacity-pricing Sprint 3. All accounts
-- still default to shadow mode. Enforced decisions exist behind the account
-- mode so Gate C remains closed until a later, explicit backfill and rollout.

alter table public.billing_workflow_capacity_leases
  drop constraint if exists
    billing_workflow_capacity_leases_accounting_mode_check;
alter table public.billing_workflow_capacity_leases
  add constraint billing_workflow_capacity_leases_accounting_mode_check
    check (accounting_mode in ('shadow', 'meter_only', 'enforced'));

-- A root workflow can have more than one historical lease after a dispatch
-- rollback and retry. The admission function serializes an account and rejects
-- a second active lease for the same root workflow.
alter table public.billing_workflow_capacity_leases
  drop constraint if exists billing_workflow_capacity_leases_root_key;
create index if not exists billing_workflow_capacity_leases_root_idx
  on public.billing_workflow_capacity_leases
    (account_id, root_workflow_ref, acquired_at desc);

create table if not exists public.billing_workflow_capacity_admission_events (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  admission_ref text not null unique check (btrim(admission_ref) <> ''),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  lease_ref text not null check (btrim(lease_ref) <> ''),
  root_workflow_ref text not null check (btrim(root_workflow_ref) <> ''),
  lease_id bigint unique
    references public.billing_workflow_capacity_leases (id) on delete restrict,
  accounting_mode text not null
    check (accounting_mode in ('shadow', 'meter_only', 'enforced')),
  concurrency_limit integer not null check (concurrency_limit >= 0),
  active_before integer not null check (active_before >= 0),
  would_admit boolean not null,
  admitted boolean not null,
  attempted_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_workflow_capacity_admission_lease_shape check (
    (admitted and lease_id is not null)
    or (not admitted and lease_id is null)
  )
);

create index if not exists billing_workflow_capacity_admission_account_idx
  on public.billing_workflow_capacity_admission_events
    (account_id, attempted_at desc);
create index if not exists billing_workflow_capacity_admission_root_idx
  on public.billing_workflow_capacity_admission_events
    (account_id, root_workflow_ref, attempted_at desc);

drop trigger if exists billing_workflow_capacity_admission_events_immutable
  on public.billing_workflow_capacity_admission_events;
create trigger billing_workflow_capacity_admission_events_immutable
before update or delete on public.billing_workflow_capacity_admission_events
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.admit_billing_workflow_capacity(
  p_account uuid,
  p_admission_ref text,
  p_source_ref text,
  p_lease_ref text,
  p_root_workflow_ref text,
  p_attempted_at timestamptz,
  p_metadata jsonb
) returns table (
  posted boolean,
  admitted boolean,
  would_admit boolean,
  active_before integer,
  concurrency_limit integer,
  accounting_mode text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_limit integer;
  v_active integer;
  v_would_admit boolean;
  v_admitted boolean;
  v_lease_id bigint;
  v_existing public.billing_workflow_capacity_admission_events%rowtype;
begin
  select entitlement_enforcement_mode, included_concurrency
    into v_mode, v_limit
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  select * into v_existing
  from public.billing_workflow_capacity_admission_events
  where admission_ref = btrim(p_admission_ref)
    or source_ref = btrim(p_source_ref)
  order by id
  limit 1;

  if found then
    if v_existing.account_id is distinct from p_account
      or v_existing.admission_ref <> btrim(p_admission_ref)
      or v_existing.source_ref <> btrim(p_source_ref)
      or v_existing.lease_ref <> btrim(p_lease_ref)
      or v_existing.root_workflow_ref <> btrim(p_root_workflow_ref)
      or v_existing.attempted_at <> p_attempted_at
      or v_existing.metadata <> coalesce(p_metadata, '{}') then
      raise exception 'capacity admission idempotency conflict for %',
        p_admission_ref;
    end if;

    return query select false, v_existing.admitted,
      v_existing.would_admit, v_existing.active_before,
      v_existing.concurrency_limit, v_existing.accounting_mode;
    return;
  end if;

  if exists (
    select 1
    from public.billing_workflow_capacity_leases lease
    left join public.billing_workflow_capacity_release_events release
      on release.lease_id = lease.id
    where lease.account_id = p_account
      and lease.root_workflow_ref = btrim(p_root_workflow_ref)
      and release.id is null
  ) then
    raise exception 'root workflow % already has active capacity',
      p_root_workflow_ref;
  end if;

  select count(*)::integer into v_active
  from public.billing_workflow_capacity_leases lease
  left join public.billing_workflow_capacity_release_events release
    on release.lease_id = lease.id
  where lease.account_id = p_account
    and release.id is null;

  v_would_admit := v_active < v_limit;
  v_admitted := v_mode <> 'enforced' or v_would_admit;

  if v_admitted then
    insert into public.billing_workflow_capacity_leases (
      account_id,
      lease_ref,
      source_ref,
      root_workflow_ref,
      accounting_mode,
      concurrency_limit,
      active_before,
      would_admit,
      acquired_at,
      metadata
    ) values (
      p_account,
      btrim(p_lease_ref),
      'lease:' || btrim(p_source_ref),
      btrim(p_root_workflow_ref),
      v_mode,
      v_limit,
      v_active,
      v_would_admit,
      p_attempted_at,
      coalesce(p_metadata, '{}')
    ) returning id into v_lease_id;
  end if;

  insert into public.billing_workflow_capacity_admission_events (
    account_id,
    admission_ref,
    source_ref,
    lease_ref,
    root_workflow_ref,
    lease_id,
    accounting_mode,
    concurrency_limit,
    active_before,
    would_admit,
    admitted,
    attempted_at,
    metadata
  ) values (
    p_account,
    btrim(p_admission_ref),
    btrim(p_source_ref),
    btrim(p_lease_ref),
    btrim(p_root_workflow_ref),
    v_lease_id,
    v_mode,
    v_limit,
    v_active,
    v_would_admit,
    v_admitted,
    p_attempted_at,
    coalesce(p_metadata, '{}')
  );

  return query select true, v_admitted, v_would_admit, v_active, v_limit,
    v_mode;
end;
$$;

-- Keep the Sprint 1 shadow writer safe after historical leases become valid.
-- An exact retry remains idempotent, a second active lease for the same root
-- remains a conflict, and a new attempt is allowed only after the prior lease
-- has a release event.
create or replace function public.record_billing_shadow_capacity_lease(
  p_account uuid,
  p_lease_ref text,
  p_source_ref text,
  p_root_workflow_ref text,
  p_acquired_at timestamptz,
  p_metadata jsonb
) returns table (
  posted boolean,
  would_admit boolean,
  active_before integer,
  concurrency_limit integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_limit integer;
  v_active integer;
  v_would_admit boolean;
  v_existing public.billing_workflow_capacity_leases%rowtype;
begin
  select entitlement_enforcement_mode, included_concurrency
    into v_mode, v_limit
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;
  if v_mode not in ('shadow', 'meter_only') then
    raise exception 'shadow capacity writer is disabled for % mode', v_mode;
  end if;

  select lease.* into v_existing
  from public.billing_workflow_capacity_leases lease
  left join public.billing_workflow_capacity_release_events release
    on release.lease_id = lease.id
  where lease.lease_ref = btrim(p_lease_ref)
    or lease.source_ref = btrim(p_source_ref)
    or (
      lease.account_id = p_account
      and lease.root_workflow_ref = btrim(p_root_workflow_ref)
      and release.id is null
    )
  order by lease.id
  limit 1;

  if found then
    if v_existing.account_id is distinct from p_account
      or v_existing.lease_ref <> btrim(p_lease_ref)
      or v_existing.source_ref <> btrim(p_source_ref)
      or v_existing.root_workflow_ref <> btrim(p_root_workflow_ref)
      or v_existing.acquired_at <> p_acquired_at
      or v_existing.metadata <> coalesce(p_metadata, '{}') then
      raise exception 'capacity lease idempotency conflict for %', p_lease_ref;
    end if;

    return query select false, v_existing.would_admit,
      v_existing.active_before, v_existing.concurrency_limit;
    return;
  end if;

  select count(*)::integer into v_active
  from public.billing_workflow_capacity_leases lease
  left join public.billing_workflow_capacity_release_events release
    on release.lease_id = lease.id
  where lease.account_id = p_account
    and release.id is null;

  v_would_admit := v_active < v_limit;

  insert into public.billing_workflow_capacity_leases (
    account_id,
    lease_ref,
    source_ref,
    root_workflow_ref,
    accounting_mode,
    concurrency_limit,
    active_before,
    would_admit,
    acquired_at,
    metadata
  ) values (
    p_account,
    btrim(p_lease_ref),
    btrim(p_source_ref),
    btrim(p_root_workflow_ref),
    v_mode,
    v_limit,
    v_active,
    v_would_admit,
    p_acquired_at,
    coalesce(p_metadata, '{}')
  ) on conflict do nothing;

  if found then
    return query select true, v_would_admit, v_active, v_limit;
    return;
  end if;

  select * into v_existing
  from public.billing_workflow_capacity_leases
  where lease_ref = btrim(p_lease_ref)
    or source_ref = btrim(p_source_ref)
  order by id
  limit 1;

  if not found
    or v_existing.account_id is distinct from p_account
    or v_existing.lease_ref <> btrim(p_lease_ref)
    or v_existing.source_ref <> btrim(p_source_ref)
    or v_existing.root_workflow_ref <> btrim(p_root_workflow_ref)
    or v_existing.acquired_at <> p_acquired_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'capacity lease idempotency conflict for %', p_lease_ref;
  end if;

  return query select false, v_existing.would_admit,
    v_existing.active_before, v_existing.concurrency_limit;
end;
$$;

-- Provider dispatch can fail after the job is claimed but before its runtime
-- handle is durable. Roll the job and its capacity lease back together so a
-- transient provider error cannot leak capacity or strand the job as running.
create or replace function public.rollback_billing_automation_job_start(
  p_job_run_id uuid,
  p_source_ref text,
  p_rolled_back_at timestamptz,
  p_metadata jsonb
) returns table (
  reset boolean,
  lease_released boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.billing_workflow_capacity_leases%rowtype;
  v_reset boolean := false;
  v_released boolean := false;
begin
  perform 1
  from public.job_runs
  where id = p_job_run_id
  for update;
  if not found then
    return query select false, false;
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

  return query select v_reset, v_released;
end;
$$;

-- Every normal terminal job transition releases the active root-workflow
-- lease in the same transaction. Trigger.dev maxDuration does not run failure
-- hooks, so the existing explicit job repair/cancellation paths provide the
-- operator repair boundary for a process crash or provider timeout.
create or replace function public.release_billing_capacity_on_job_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.billing_workflow_capacity_leases%rowtype;
  v_outcome text;
  v_released_at timestamptz;
begin
  if new.status = 'success' then
    v_outcome := 'success';
  elsif new.status = 'cancelled' then
    if coalesce(new.cancel_reason, '') like 'ZOMBIE_REAPED_%' then
      v_outcome := 'operator_repair';
    else
      v_outcome := 'cancelled';
    end if;
  elsif coalesce(new.error, '') ilike '%timed out%'
    or coalesce(new.error, '') ilike '%timeout%' then
    v_outcome := 'timeout';
  elsif coalesce(new.error, '') like 'RECONCILED_%' then
    v_outcome := 'operator_repair';
  else
    v_outcome := 'failure';
  end if;

  v_released_at := coalesce(new.completed_at, new.cancelled_at, now());

  for v_lease in
    select lease.*
    from public.billing_workflow_capacity_leases lease
    left join public.billing_workflow_capacity_release_events release
      on release.lease_id = lease.id
    where lease.root_workflow_ref = new.id::text
      and release.id is null
    order by lease.id
  loop
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
      v_outcome,
      'job-terminal:' || new.id::text || ':lease:' || v_lease.id::text,
      v_released_at,
      jsonb_build_object(
        'jobRunId', new.id::text,
        'jobStatus', new.status
      )
    ) on conflict (lease_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists job_runs_release_billing_capacity
  on public.job_runs;
create trigger job_runs_release_billing_capacity
after update of status on public.job_runs
for each row
when (
  new.status in ('success', 'failed', 'cancelled')
  and coalesce(old.status, '') not in ('success', 'failed', 'cancelled')
)
execute function public.release_billing_capacity_on_job_terminal();

-- Repair a lease that predated this terminal trigger but already belongs to a
-- terminal job. This is a one-time migration repair, not a recurring scan.
insert into public.billing_workflow_capacity_release_events (
  lease_id,
  terminal_outcome,
  source_ref,
  released_at,
  metadata
)
select
  lease.id,
  case
    when job.status = 'success' then 'success'
    when job.status = 'cancelled' then 'operator_repair'
    else 'operator_repair'
  end,
  'migration-terminal-repair:' || job.id::text || ':lease:' || lease.id::text,
  coalesce(job.completed_at, job.cancelled_at, now()),
  jsonb_build_object(
    'jobRunId', job.id::text,
    'jobStatus', job.status,
    'migration', '20260816150000'
  )
from public.billing_workflow_capacity_leases lease
join public.job_runs job on job.id::text = lease.root_workflow_ref
left join public.billing_workflow_capacity_release_events release
  on release.lease_id = lease.id
where release.id is null
  and job.status in ('success', 'failed', 'cancelled')
on conflict (lease_id) do nothing;

alter table public.billing_workflow_capacity_admission_events
  enable row level security;

revoke all on table public.billing_workflow_capacity_admission_events
  from anon, authenticated, service_role;
grant select on table public.billing_workflow_capacity_admission_events
  to service_role;

revoke all on function public.admit_billing_workflow_capacity(
  uuid, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.rollback_billing_automation_job_start(
  uuid, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.release_billing_capacity_on_job_terminal()
  from public, anon, authenticated;

grant execute on function public.admit_billing_workflow_capacity(
  uuid, text, text, text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.rollback_billing_automation_job_start(
  uuid, text, timestamptz, jsonb
) to service_role;
