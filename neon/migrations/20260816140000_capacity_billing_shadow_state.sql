-- Capacity-pricing Sprint 1 state facts. These writers intentionally support
-- shadow and meter-only accounts only. Customer-visible enforcement requires
-- a later gated migration that replaces the admission contract.

create table if not exists public.billing_cost_reservations (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  reservation_ref text not null unique check (btrim(reservation_ref) <> ''),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  operation_ref text not null check (btrim(operation_ref) <> ''),
  root_workflow_ref text,
  reserved_micros bigint not null check (reserved_micros > 0),
  basis jsonb not null check (jsonb_typeof(basis) = 'object'),
  basis_version text not null check (btrim(basis_version) <> ''),
  accounting_mode text not null
    check (accounting_mode in ('shadow', 'meter_only')),
  balance_micros_before bigint not null,
  open_reserved_micros_before bigint not null
    check (open_reserved_micros_before >= 0),
  spendable_micros_before bigint not null,
  would_admit boolean not null,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists billing_cost_reservations_account_created_idx
  on public.billing_cost_reservations (account_id, created_at desc);

create table if not exists public.billing_cost_reservation_terminal_events (
  id bigint generated always as identity primary key,
  reservation_id bigint not null unique
    references public.billing_cost_reservations (id) on delete restrict,
  terminal_kind text not null
    check (terminal_kind in ('settled', 'released', 'expired')),
  consumed_micros bigint not null check (consumed_micros >= 0),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  terminal_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_cost_reservation_terminal_consumed_check check (
    terminal_kind = 'settled' or consumed_micros = 0
  )
);

create or replace view public.billing_open_cost_reservations
with (security_invoker = true) as
select reservation.*
from public.billing_cost_reservations reservation
left join public.billing_cost_reservation_terminal_events terminal
  on terminal.reservation_id = reservation.id
where terminal.id is null;

-- A capacity lease represents one actively executing root customer workflow.
-- Queued work, waits, internal subtasks, and maintenance work do not create it.
create table if not exists public.billing_workflow_capacity_leases (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  lease_ref text not null unique check (btrim(lease_ref) <> ''),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  root_workflow_ref text not null check (btrim(root_workflow_ref) <> ''),
  accounting_mode text not null
    check (accounting_mode in ('shadow', 'meter_only')),
  concurrency_limit integer not null check (concurrency_limit >= 0),
  active_before integer not null check (active_before >= 0),
  would_admit boolean not null,
  acquired_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_workflow_capacity_leases_root_key
    unique (account_id, root_workflow_ref)
);

create index if not exists billing_workflow_capacity_leases_account_time_idx
  on public.billing_workflow_capacity_leases (account_id, acquired_at desc);

create table if not exists public.billing_workflow_capacity_release_events (
  id bigint generated always as identity primary key,
  lease_id bigint not null unique
    references public.billing_workflow_capacity_leases (id) on delete restrict,
  terminal_outcome text not null check (terminal_outcome in
    ('success', 'failure', 'cancelled', 'timeout', 'operator_repair')),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  released_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now()
);

create or replace view public.billing_active_workflow_capacity_leases
with (security_invoker = true) as
select lease.*
from public.billing_workflow_capacity_leases lease
left join public.billing_workflow_capacity_release_events release
  on release.lease_id = lease.id
where release.id is null;

-- Logical retained bytes are event-sourced. The rollup is a mutable read
-- projection; the source facts remain append-only and corrections use a new
-- negative event.
create table if not exists public.billing_retained_data_events (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  resource_type text not null check (resource_type in (
    'workflow_history',
    'node_run_history',
    'job_run_history',
    'ai_call_history',
    'automation_dispatch_history',
    'logs_events',
    'review_finding',
    'generated_artifact',
    'customer_upload',
    'sandbox_snapshot'
  )),
  resource_ref text not null check (btrim(resource_ref) <> ''),
  delta_bytes bigint not null check (delta_bytes <> 0),
  source_ref text not null unique check (btrim(source_ref) <> ''),
  operation_ref text,
  accounting_mode text not null
    check (accounting_mode in ('shadow', 'meter_only')),
  retained_limit_bytes bigint not null check (retained_limit_bytes >= 0),
  logical_bytes_before bigint not null check (logical_bytes_before >= 0),
  logical_bytes_after bigint not null check (logical_bytes_after >= 0),
  would_admit boolean not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now()
);

create index if not exists billing_retained_data_events_account_time_idx
  on public.billing_retained_data_events
    (account_id, resource_type, occurred_at desc);
create index if not exists billing_retained_data_events_resource_idx
  on public.billing_retained_data_events
    (account_id, resource_type, resource_ref);

create table if not exists public.billing_retained_data_rollups (
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  resource_type text not null check (resource_type in (
    'workflow_history',
    'node_run_history',
    'job_run_history',
    'ai_call_history',
    'automation_dispatch_history',
    'logs_events',
    'review_finding',
    'generated_artifact',
    'customer_upload',
    'sandbox_snapshot'
  )),
  logical_bytes bigint not null check (logical_bytes >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, resource_type)
);

create or replace view public.billing_retained_data_totals
with (security_invoker = true) as
select account_id, sum(logical_bytes)::bigint as logical_bytes
from public.billing_retained_data_rollups
group by account_id;

drop trigger if exists billing_cost_reservations_immutable
  on public.billing_cost_reservations;
create trigger billing_cost_reservations_immutable
before update or delete on public.billing_cost_reservations
for each row execute function public.reject_immutable_billing_event_mutation();

drop trigger if exists billing_cost_reservation_terminal_events_immutable
  on public.billing_cost_reservation_terminal_events;
create trigger billing_cost_reservation_terminal_events_immutable
before update or delete on public.billing_cost_reservation_terminal_events
for each row execute function public.reject_immutable_billing_event_mutation();

drop trigger if exists billing_workflow_capacity_leases_immutable
  on public.billing_workflow_capacity_leases;
create trigger billing_workflow_capacity_leases_immutable
before update or delete on public.billing_workflow_capacity_leases
for each row execute function public.reject_immutable_billing_event_mutation();

drop trigger if exists billing_workflow_capacity_release_events_immutable
  on public.billing_workflow_capacity_release_events;
create trigger billing_workflow_capacity_release_events_immutable
before update or delete on public.billing_workflow_capacity_release_events
for each row execute function public.reject_immutable_billing_event_mutation();

drop trigger if exists billing_retained_data_events_immutable
  on public.billing_retained_data_events;
create trigger billing_retained_data_events_immutable
before update or delete on public.billing_retained_data_events
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.record_billing_shadow_reservation(
  p_account uuid,
  p_reservation_ref text,
  p_source_ref text,
  p_operation_ref text,
  p_root_workflow_ref text,
  p_reserved_micros bigint,
  p_basis jsonb,
  p_basis_version text,
  p_expires_at timestamptz,
  p_metadata jsonb
) returns table (
  posted boolean,
  would_admit boolean,
  balance_micros text,
  open_reserved_micros text,
  spendable_micros text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_balance bigint;
  v_open_reserved bigint;
  v_spendable bigint;
  v_would_admit boolean;
  v_existing public.billing_cost_reservations%rowtype;
begin
  select entitlement_enforcement_mode into v_mode
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;
  if v_mode not in ('shadow', 'meter_only') then
    raise exception 'shadow reservation writer is disabled for % mode', v_mode;
  end if;
  select coalesce(sum(delta_cents), 0)::bigint * 10000
    into v_balance
  from public.credit_ledger
  where account_id = p_account;

  select coalesce(sum(reservation.reserved_micros), 0)::bigint
    into v_open_reserved
  from public.billing_cost_reservations reservation
  left join public.billing_cost_reservation_terminal_events terminal
    on terminal.reservation_id = reservation.id
  where reservation.account_id = p_account
    and terminal.id is null;

  v_spendable := v_balance - v_open_reserved;
  v_would_admit := v_spendable >= p_reserved_micros;

  insert into public.billing_cost_reservations (
    account_id,
    reservation_ref,
    source_ref,
    operation_ref,
    root_workflow_ref,
    reserved_micros,
    basis,
    basis_version,
    accounting_mode,
    balance_micros_before,
    open_reserved_micros_before,
    spendable_micros_before,
    would_admit,
    expires_at,
    metadata
  ) values (
    p_account,
    btrim(p_reservation_ref),
    btrim(p_source_ref),
    btrim(p_operation_ref),
    nullif(btrim(p_root_workflow_ref), ''),
    p_reserved_micros,
    coalesce(p_basis, '{}'),
    btrim(p_basis_version),
    v_mode,
    v_balance,
    v_open_reserved,
    v_spendable,
    v_would_admit,
    p_expires_at,
    coalesce(p_metadata, '{}')
  ) on conflict do nothing;

  if found then
    return query select true, v_would_admit, v_balance::text,
      v_open_reserved::text, v_spendable::text;
    return;
  end if;

  select * into v_existing
  from public.billing_cost_reservations
  where reservation_ref = btrim(p_reservation_ref)
    or source_ref = btrim(p_source_ref)
  order by id
  limit 1;

  if v_existing.account_id is distinct from p_account
    or v_existing.reservation_ref <> btrim(p_reservation_ref)
    or v_existing.source_ref <> btrim(p_source_ref)
    or v_existing.operation_ref <> btrim(p_operation_ref)
    or v_existing.root_workflow_ref is distinct from
      nullif(btrim(p_root_workflow_ref), '')
    or v_existing.reserved_micros <> p_reserved_micros
    or v_existing.basis <> coalesce(p_basis, '{}')
    or v_existing.basis_version <> btrim(p_basis_version)
    or v_existing.expires_at <> p_expires_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'reservation idempotency conflict for %', p_reservation_ref;
  end if;

  return query select false, v_existing.would_admit,
    v_existing.balance_micros_before::text,
    v_existing.open_reserved_micros_before::text,
    v_existing.spendable_micros_before::text;
end;
$$;

create or replace function public.record_billing_reservation_terminal(
  p_reservation_ref text,
  p_terminal_kind text,
  p_consumed_micros bigint,
  p_source_ref text,
  p_terminal_at timestamptz,
  p_metadata jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.billing_cost_reservations%rowtype;
  v_existing public.billing_cost_reservation_terminal_events%rowtype;
begin
  select * into v_reservation
  from public.billing_cost_reservations
  where reservation_ref = btrim(p_reservation_ref)
  for update;
  if not found then
    raise exception 'billing reservation % not found', p_reservation_ref;
  end if;
  if p_terminal_at < v_reservation.created_at then
    raise exception 'reservation terminal cannot predate the reservation';
  end if;
  if p_terminal_kind = 'settled'
    and p_consumed_micros > v_reservation.reserved_micros then
    raise exception 'reservation settlement exceeds its approved bound';
  end if;

  insert into public.billing_cost_reservation_terminal_events (
    reservation_id,
    terminal_kind,
    consumed_micros,
    source_ref,
    terminal_at,
    metadata
  ) values (
    v_reservation.id,
    p_terminal_kind,
    p_consumed_micros,
    btrim(p_source_ref),
    p_terminal_at,
    coalesce(p_metadata, '{}')
  ) on conflict do nothing;

  if found then
    return true;
  end if;

  select * into v_existing
  from public.billing_cost_reservation_terminal_events
  where reservation_id = v_reservation.id
    or source_ref = btrim(p_source_ref)
  order by id
  limit 1;

  if v_existing.reservation_id <> v_reservation.id
    or v_existing.terminal_kind <> p_terminal_kind
    or v_existing.consumed_micros <> p_consumed_micros
    or v_existing.source_ref <> btrim(p_source_ref)
    or v_existing.terminal_at <> p_terminal_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'reservation terminal idempotency conflict for %',
      p_reservation_ref;
  end if;

  return false;
end;
$$;

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
    or (
      account_id = p_account
      and root_workflow_ref = btrim(p_root_workflow_ref)
    )
  order by id
  limit 1;

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
end;
$$;

create or replace function public.record_billing_capacity_release(
  p_lease_ref text,
  p_terminal_outcome text,
  p_source_ref text,
  p_released_at timestamptz,
  p_metadata jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.billing_workflow_capacity_leases%rowtype;
  v_existing public.billing_workflow_capacity_release_events%rowtype;
begin
  select * into v_lease
  from public.billing_workflow_capacity_leases
  where lease_ref = btrim(p_lease_ref)
  for update;
  if not found then
    raise exception 'billing capacity lease % not found', p_lease_ref;
  end if;
  if p_released_at < v_lease.acquired_at then
    raise exception 'capacity release cannot predate the lease';
  end if;

  insert into public.billing_workflow_capacity_release_events (
    lease_id,
    terminal_outcome,
    source_ref,
    released_at,
    metadata
  ) values (
    v_lease.id,
    p_terminal_outcome,
    btrim(p_source_ref),
    p_released_at,
    coalesce(p_metadata, '{}')
  ) on conflict do nothing;

  if found then
    return true;
  end if;

  select * into v_existing
  from public.billing_workflow_capacity_release_events
  where lease_id = v_lease.id
    or source_ref = btrim(p_source_ref)
  order by id
  limit 1;

  if v_existing.lease_id <> v_lease.id
    or v_existing.terminal_outcome <> p_terminal_outcome
    or v_existing.source_ref <> btrim(p_source_ref)
    or v_existing.released_at <> p_released_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'capacity release idempotency conflict for %', p_lease_ref;
  end if;

  return false;
end;
$$;

create or replace function public.record_billing_shadow_retained_data_event(
  p_account uuid,
  p_resource_type text,
  p_resource_ref text,
  p_delta_bytes bigint,
  p_source_ref text,
  p_operation_ref text,
  p_occurred_at timestamptz,
  p_metadata jsonb
) returns table (
  posted boolean,
  would_admit boolean,
  logical_bytes text,
  retained_limit_bytes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_limit bigint;
  v_total_before bigint;
  v_total_after bigint;
  v_resource_before bigint;
  v_resource_after bigint;
  v_would_admit boolean;
  v_existing public.billing_retained_data_events%rowtype;
begin
  select entitlement_enforcement_mode, included_retained_bytes
    into v_mode, v_limit
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;
  if v_mode not in ('shadow', 'meter_only') then
    raise exception 'shadow retained-data writer is disabled for % mode', v_mode;
  end if;

  select coalesce(sum(rollup.logical_bytes), 0)::bigint into v_total_before
  from public.billing_retained_data_rollups rollup
  where rollup.account_id = p_account;

  select coalesce(max(rollup.logical_bytes), 0)::bigint into v_resource_before
  from public.billing_retained_data_rollups rollup
  where rollup.account_id = p_account
    and rollup.resource_type = p_resource_type;

  v_total_after := v_total_before + p_delta_bytes;
  v_resource_after := v_resource_before + p_delta_bytes;
  if v_total_after < 0 or v_resource_after < 0 then
    raise exception 'retained data change would make logical bytes negative';
  end if;
  v_would_admit := p_delta_bytes < 0 or v_total_after <= v_limit;

  insert into public.billing_retained_data_events (
    account_id,
    resource_type,
    resource_ref,
    delta_bytes,
    source_ref,
    operation_ref,
    accounting_mode,
    retained_limit_bytes,
    logical_bytes_before,
    logical_bytes_after,
    would_admit,
    occurred_at,
    metadata
  ) values (
    p_account,
    p_resource_type,
    btrim(p_resource_ref),
    p_delta_bytes,
    btrim(p_source_ref),
    nullif(btrim(p_operation_ref), ''),
    v_mode,
    v_limit,
    v_total_before,
    v_total_after,
    v_would_admit,
    p_occurred_at,
    coalesce(p_metadata, '{}')
  ) on conflict (source_ref) do nothing;

  if not found then
    select * into v_existing
    from public.billing_retained_data_events
    where source_ref = btrim(p_source_ref);

    if v_existing.account_id is distinct from p_account
      or v_existing.resource_type <> p_resource_type
      or v_existing.resource_ref <> btrim(p_resource_ref)
      or v_existing.delta_bytes <> p_delta_bytes
      or v_existing.operation_ref is distinct from
        nullif(btrim(p_operation_ref), '')
      or v_existing.occurred_at <> p_occurred_at
      or v_existing.metadata <> coalesce(p_metadata, '{}') then
      raise exception 'retained data idempotency conflict for %', p_source_ref;
    end if;

    return query select false, v_existing.would_admit,
      v_existing.logical_bytes_after::text,
      v_existing.retained_limit_bytes::text;
    return;
  end if;

  insert into public.billing_retained_data_rollups (
    account_id,
    resource_type,
    logical_bytes,
    updated_at
  ) values (
    p_account,
    p_resource_type,
    v_resource_after,
    now()
  ) on conflict (account_id, resource_type) do update
    set logical_bytes = excluded.logical_bytes,
        updated_at = excluded.updated_at;

  return query select true, v_would_admit, v_total_after::text, v_limit::text;
end;
$$;

alter table public.billing_cost_reservations enable row level security;
alter table public.billing_cost_reservation_terminal_events
  enable row level security;
alter table public.billing_workflow_capacity_leases enable row level security;
alter table public.billing_workflow_capacity_release_events
  enable row level security;
alter table public.billing_retained_data_events enable row level security;
alter table public.billing_retained_data_rollups enable row level security;

revoke all on table public.billing_cost_reservations,
  public.billing_cost_reservation_terminal_events,
  public.billing_workflow_capacity_leases,
  public.billing_workflow_capacity_release_events,
  public.billing_retained_data_events,
  public.billing_retained_data_rollups
from anon, authenticated, service_role;

grant select on table public.billing_cost_reservations,
  public.billing_cost_reservation_terminal_events,
  public.billing_open_cost_reservations,
  public.billing_workflow_capacity_leases,
  public.billing_workflow_capacity_release_events,
  public.billing_active_workflow_capacity_leases,
  public.billing_retained_data_events,
  public.billing_retained_data_rollups,
  public.billing_retained_data_totals
to service_role;

revoke all on function public.record_billing_shadow_reservation(
  uuid, text, text, text, text, bigint, jsonb, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.record_billing_reservation_terminal(
  text, text, bigint, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.record_billing_shadow_capacity_lease(
  uuid, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.record_billing_capacity_release(
  text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.record_billing_shadow_retained_data_event(
  uuid, text, text, bigint, text, text, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.record_billing_shadow_reservation(
  uuid, text, text, text, text, bigint, jsonb, text, timestamptz, jsonb
) to service_role;
grant execute on function public.record_billing_reservation_terminal(
  text, text, bigint, text, timestamptz, jsonb
) to service_role;
grant execute on function public.record_billing_shadow_capacity_lease(
  uuid, text, text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.record_billing_capacity_release(
  text, text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.record_billing_shadow_retained_data_event(
  uuid, text, text, bigint, text, text, timestamptz, jsonb
) to service_role;
