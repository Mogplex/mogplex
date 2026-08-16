-- Capacity annual plans receive included hosted usage at monthly anchors.
-- Each future grant is a durable, account-scoped one-time schedule. Stripe
-- webhooks replace stale schedules and Trigger.dev only wakes the named row;
-- there is no recurring account scan.

create table if not exists public.billing_annual_grant_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  stripe_subscription_id text not null
    check (btrim(stripe_subscription_id) <> ''),
  entitlement_version bigint not null check (entitlement_version > 0),
  price_lookup_key text not null check (btrim(price_lookup_key) <> ''),
  included_usage_cents bigint not null check (included_usage_cents > 0),
  cycle_started_at timestamptz not null,
  grant_offset smallint not null check (grant_offset between 1 and 11),
  grant_period text not null
    check (grant_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_at timestamptz not null,
  source_event_id text not null check (btrim(source_event_id) <> ''),
  runtime_run_id text,
  status text not null default 'pending'
    check (status in ('pending', 'cancel_pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_annual_grant_schedules_occurrence_key
    unique (account_id, entitlement_version, grant_offset),
  constraint billing_annual_grant_schedules_plan_shape check (
    (price_lookup_key = 'capacity_v2_pro_annual'
      and included_usage_cents = 500)
    or (price_lookup_key = 'capacity_v2_plus_annual'
      and included_usage_cents = 2500)
    or (price_lookup_key = 'capacity_v2_max_annual'
      and included_usage_cents = 5000)
  ),
  constraint billing_annual_grant_schedules_due_after_cycle
    check (due_at > cycle_started_at),
  constraint billing_annual_grant_schedules_terminal_shape check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status in ('pending', 'cancel_pending')
      and completed_at is null and cancelled_at is null)
  )
);

create unique index if not exists billing_annual_grant_schedules_run_key
  on public.billing_annual_grant_schedules (runtime_run_id)
  where runtime_run_id is not null;

create index if not exists billing_annual_grant_schedules_account_status_idx
  on public.billing_annual_grant_schedules (account_id, status, due_at);

alter table public.billing_annual_grant_schedules enable row level security;

revoke all on table public.billing_annual_grant_schedules
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_annual_grant_schedules
  to service_role;

-- The grant and schedule completion share the billing-account lock used by
-- every ledger writer. A cancellation or newer entitlement projection either
-- wins first and makes this schedule stale, or waits for this grant and then
-- expires it. Included credit cannot appear after a completed cancellation.
create or replace function public.apply_billing_annual_grant_schedule(
  p_schedule uuid
) returns table (
  eligible boolean,
  posted boolean,
  duplicate boolean,
  cancelled boolean,
  account_id uuid,
  stripe_subscription_id text,
  entitlement_version bigint,
  price_lookup_key text,
  included_usage_cents bigint,
  cycle_started_at timestamptz,
  grant_offset smallint,
  grant_period text,
  due_at timestamptz,
  source_event_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.billing_annual_grant_schedules%rowtype;
  v_account public.billing_accounts%rowtype;
  v_posted boolean;
begin
  select * into v_schedule
  from public.billing_annual_grant_schedules
  where id = p_schedule;
  if not found then
    raise exception 'annual grant schedule % not found', p_schedule;
  end if;

  select * into v_account
  from public.billing_accounts
  where id = v_schedule.account_id
  for update;
  if not found then
    raise exception 'billing account % not found', v_schedule.account_id;
  end if;

  select * into v_schedule
  from public.billing_annual_grant_schedules
  where id = p_schedule
  for update;

  if v_schedule.status = 'completed' then
    return query select
      true, false, true, false,
      v_schedule.account_id,
      v_schedule.stripe_subscription_id,
      v_schedule.entitlement_version,
      v_schedule.price_lookup_key,
      v_schedule.included_usage_cents,
      v_schedule.cycle_started_at,
      v_schedule.grant_offset,
      v_schedule.grant_period,
      v_schedule.due_at,
      v_schedule.source_event_id;
    return;
  end if;

  if v_schedule.status <> 'pending' then
    return query select
      false, false, false, true,
      v_schedule.account_id,
      v_schedule.stripe_subscription_id,
      v_schedule.entitlement_version,
      v_schedule.price_lookup_key,
      v_schedule.included_usage_cents,
      v_schedule.cycle_started_at,
      v_schedule.grant_offset,
      v_schedule.grant_period,
      v_schedule.due_at,
      v_schedule.source_event_id;
    return;
  end if;

  if v_account.entitlement_version <> v_schedule.entitlement_version
    or v_account.stripe_subscription_id is distinct from
      v_schedule.stripe_subscription_id
    or v_account.plan_audience <> 'individual'
    or v_account.plan_code is null
    or v_account.included_hosted_usage_cents <>
      v_schedule.included_usage_cents
    or v_account.status = 'past_due' then
    update public.billing_annual_grant_schedules
    set status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    where id = p_schedule;
    return query select
      false, false, false, true,
      v_schedule.account_id,
      v_schedule.stripe_subscription_id,
      v_schedule.entitlement_version,
      v_schedule.price_lookup_key,
      v_schedule.included_usage_cents,
      v_schedule.cycle_started_at,
      v_schedule.grant_offset,
      v_schedule.grant_period,
      v_schedule.due_at,
      v_schedule.source_event_id;
    return;
  end if;

  if now() < v_schedule.due_at then
    raise exception 'annual grant schedule % is not due', p_schedule;
  end if;
  if v_schedule.grant_period is distinct from
    to_char(v_schedule.due_at at time zone 'UTC', 'YYYY-MM') then
    raise exception 'annual grant schedule % has an invalid grant period',
      p_schedule;
  end if;

  select result.posted into v_posted
  from public.post_billing_period_grant(
    v_schedule.account_id,
    v_schedule.included_usage_cents,
    'grant:' || v_schedule.account_id::text || ':' ||
      v_schedule.grant_period || ':' || v_schedule.stripe_subscription_id,
    'grantexp:' || v_schedule.account_id::text || ':' ||
      v_schedule.grant_period || ':' || v_schedule.stripe_subscription_id,
    v_schedule.grant_period,
    jsonb_build_object(
      'source', 'capacity_annual_schedule',
      'plan', v_schedule.price_lookup_key,
      'catalog', 'capacity_v2',
      'schedule_id', v_schedule.id,
      'source_event_id', v_schedule.source_event_id
    )
  ) result;

  update public.billing_annual_grant_schedules
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = p_schedule;

  return query select
    true, v_posted, not v_posted, false,
    v_schedule.account_id,
    v_schedule.stripe_subscription_id,
    v_schedule.entitlement_version,
    v_schedule.price_lookup_key,
    v_schedule.included_usage_cents,
    v_schedule.cycle_started_at,
    v_schedule.grant_offset,
    v_schedule.grant_period,
    v_schedule.due_at,
    v_schedule.source_event_id;
end;
$$;

revoke all on function public.apply_billing_annual_grant_schedule(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_billing_annual_grant_schedule(uuid)
  to service_role;
