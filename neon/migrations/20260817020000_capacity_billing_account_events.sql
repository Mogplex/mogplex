-- Durable, account-scoped UI events for capacity billing. Inserts and their
-- NOTIFY messages share the mutation transaction; PostgreSQL delivers NOTIFY
-- only after commit, so clients never refresh against uncommitted state.

alter table public.billing_accounts
  add column if not exists billing_event_sequence bigint not null default 0
    check (billing_event_sequence >= 0);

create table if not exists public.billing_account_events (
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (event_type in (
    'billing.summary.changed',
    'billing.capacity.change_pending',
    'billing.capacity.change_applied',
    'billing.capacity.change_failed',
    'billing.hosted_usage.added',
    'billing.account.status_changed'
  )),
  source_event_id text not null check (btrim(source_event_id) <> ''),
  committed_at timestamptz not null default clock_timestamp(),
  primary key (account_id, sequence),
  constraint billing_account_events_source_key
    unique (account_id, event_type, source_event_id)
);

create index if not exists billing_account_events_committed_idx
  on public.billing_account_events (committed_at);

alter table public.billing_account_events enable row level security;

drop trigger if exists billing_account_events_immutable
  on public.billing_account_events;
create trigger billing_account_events_immutable
before update or delete on public.billing_account_events
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.append_billing_account_event(
  p_account uuid,
  p_event_type text,
  p_source_event_id text
) returns table (sequence bigint, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current bigint;
  v_existing bigint;
begin
  if p_event_type is null or p_event_type not in (
    'billing.summary.changed',
    'billing.capacity.change_pending',
    'billing.capacity.change_applied',
    'billing.capacity.change_failed',
    'billing.hosted_usage.added',
    'billing.account.status_changed'
  ) then
    raise exception 'billing account event type is invalid';
  end if;
  if p_source_event_id is null or btrim(p_source_event_id) = '' then
    raise exception 'billing account event source is required';
  end if;

  select billing_event_sequence into v_current
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  select event.sequence into v_existing
  from public.billing_account_events event
  where event.account_id = p_account
    and event.event_type = p_event_type
    and event.source_event_id = btrim(p_source_event_id);
  if found then
    return query select v_existing, false;
    return;
  end if;

  v_current := v_current + 1;
  update public.billing_accounts
  set billing_event_sequence = v_current
  where id = p_account;

  insert into public.billing_account_events (
    account_id,
    sequence,
    event_type,
    source_event_id
  ) values (
    p_account,
    v_current,
    p_event_type,
    btrim(p_source_event_id)
  );

  return query select v_current, true;
end;
$$;

create or replace function public.notify_billing_account_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_notify(
    'mogplex_billing_account_events',
    pg_catalog.json_build_object(
      'accountId', new.account_id,
      'sequence', new.sequence::text
    )::text
  );
  return new;
end;
$$;

drop trigger if exists billing_account_events_notify
  on public.billing_account_events;
create trigger billing_account_events_notify
after insert on public.billing_account_events
for each row execute function public.notify_billing_account_event();

create or replace function public.publish_billing_account_update_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projection_changed boolean;
  v_status_changed boolean;
  v_source text;
begin
  v_projection_changed := row(
    new.tier,
    new.stripe_subscription_id,
    new.period_anchor,
    new.plan_code,
    new.plan_audience,
    new.max_named_users,
    new.included_concurrency,
    new.included_retained_bytes,
    new.included_hosted_usage_cents,
    new.entitlement_version
  ) is distinct from row(
    old.tier,
    old.stripe_subscription_id,
    old.period_anchor,
    old.plan_code,
    old.plan_audience,
    old.max_named_users,
    old.included_concurrency,
    old.included_retained_bytes,
    old.included_hosted_usage_cents,
    old.entitlement_version
  );
  v_status_changed := new.status is distinct from old.status;
  if not v_projection_changed and not v_status_changed then
    return new;
  end if;

  v_source := case
    when new.entitlement_projection_event_id is distinct from
      old.entitlement_projection_event_id
      then coalesce(
        nullif(btrim(new.entitlement_projection_event_id), ''),
        'database:' || pg_catalog.pg_current_xact_id()::text ||
          ':billing-account:' || new.id::text
      )
    else 'database:' || pg_catalog.pg_current_xact_id()::text ||
      ':billing-account:' || new.id::text
  end;

  if v_status_changed then
    perform public.append_billing_account_event(
      new.id,
      'billing.account.status_changed',
      v_source
    );
    if new.status = 'past_due'
      and new.plan_code in ('pro', 'plus', 'max') then
      perform public.append_billing_account_event(
        new.id,
        'billing.capacity.change_failed',
        v_source
      );
    end if;
  end if;

  perform public.append_billing_account_event(
    new.id,
    'billing.summary.changed',
    v_source
  );
  return new;
end;
$$;

drop trigger if exists billing_accounts_publish_events
  on public.billing_accounts;
create trigger billing_accounts_publish_events
after update on public.billing_accounts
for each row execute function public.publish_billing_account_update_events();

create or replace function public.publish_billing_credit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_billing_account_event(
    new.account_id,
    'billing.summary.changed',
    new.source_ref
  );
  if new.delta_cents > 0 then
    perform public.append_billing_account_event(
      new.account_id,
      'billing.hosted_usage.added',
      new.source_ref
    );
  end if;
  return new;
end;
$$;

drop trigger if exists credit_ledger_publish_billing_events
  on public.credit_ledger;
create trigger credit_ledger_publish_billing_events
after insert on public.credit_ledger
for each row execute function public.publish_billing_credit_events();

create or replace function public.publish_billing_entitlement_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_billing_account_event(
    new.account_id,
    case
      when new.effective_at > pg_catalog.clock_timestamp()
        then 'billing.capacity.change_pending'
      else 'billing.capacity.change_applied'
    end,
    new.source_event_id
  );
  perform public.append_billing_account_event(
    new.account_id,
    'billing.summary.changed',
    new.source_event_id
  );
  return new;
end;
$$;

drop trigger if exists billing_entitlement_items_publish_events
  on public.billing_entitlement_items;
create trigger billing_entitlement_items_publish_events
after insert on public.billing_entitlement_items
for each row execute function public.publish_billing_entitlement_events();

create or replace function public.publish_billing_direct_summary_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_account uuid;
  v_source text;
begin
  v_account := (v_row->>'account_id')::uuid;
  v_source := nullif(btrim(v_row->>tg_argv[0]), '');
  if v_account is not null and v_source is not null then
    perform public.append_billing_account_event(
      v_account,
      'billing.summary.changed',
      v_source
    );
  end if;
  return new;
end;
$$;

drop trigger if exists billing_cost_reservations_publish_events
  on public.billing_cost_reservations;
create trigger billing_cost_reservations_publish_events
after insert on public.billing_cost_reservations
for each row execute function public.publish_billing_direct_summary_event(
  'source_ref'
);

drop trigger if exists billing_workflow_capacity_leases_publish_events
  on public.billing_workflow_capacity_leases;
create trigger billing_workflow_capacity_leases_publish_events
after insert on public.billing_workflow_capacity_leases
for each row execute function public.publish_billing_direct_summary_event(
  'source_ref'
);

drop trigger if exists billing_retained_data_events_publish_events
  on public.billing_retained_data_events;
create trigger billing_retained_data_events_publish_events
after insert on public.billing_retained_data_events
for each row execute function public.publish_billing_direct_summary_event(
  'source_ref'
);

create or replace function public.publish_billing_provider_cost_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is not null and new.retail_debit_micros > 0 then
    perform public.append_billing_account_event(
      new.account_id,
      'billing.summary.changed',
      new.provider || ':' || new.provider_event_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists billing_provider_cost_events_publish_events
  on public.billing_provider_cost_events;
create trigger billing_provider_cost_events_publish_events
after insert on public.billing_provider_cost_events
for each row execute function public.publish_billing_provider_cost_event();

create or replace function public.publish_billing_reservation_terminal_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  select reservation.account_id into v_account
  from public.billing_cost_reservations reservation
  where reservation.id = new.reservation_id;
  perform public.append_billing_account_event(
    v_account,
    'billing.summary.changed',
    new.source_ref
  );
  return new;
end;
$$;

drop trigger if exists billing_cost_reservation_terminal_publish_events
  on public.billing_cost_reservation_terminal_events;
create trigger billing_cost_reservation_terminal_publish_events
after insert on public.billing_cost_reservation_terminal_events
for each row execute function public.publish_billing_reservation_terminal_event();

create or replace function public.publish_billing_capacity_release_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  select lease.account_id into v_account
  from public.billing_workflow_capacity_leases lease
  where lease.id = new.lease_id;
  perform public.append_billing_account_event(
    v_account,
    'billing.summary.changed',
    new.source_ref
  );
  return new;
end;
$$;

drop trigger if exists billing_workflow_capacity_release_publish_events
  on public.billing_workflow_capacity_release_events;
create trigger billing_workflow_capacity_release_publish_events
after insert on public.billing_workflow_capacity_release_events
for each row execute function public.publish_billing_capacity_release_event();

revoke all on table public.billing_account_events
  from public, anon, authenticated, service_role;
grant select on table public.billing_account_events to service_role;

revoke all on function public.append_billing_account_event(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.append_billing_account_event(uuid, text, text)
  to service_role;

revoke all on function public.notify_billing_account_event()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_account_update_events()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_credit_events()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_entitlement_events()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_direct_summary_event()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_provider_cost_event()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_reservation_terminal_event()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_billing_capacity_release_event()
  from public, anon, authenticated, service_role;
