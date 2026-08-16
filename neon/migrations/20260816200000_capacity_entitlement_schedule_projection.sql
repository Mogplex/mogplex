-- Period-end capacity changes are projected as future entitlement item
-- versions without advancing the current subscription webhook watermark.
-- Stripe can deliver schedule events out of order, so an append-only event
-- ledger decides which future version is authoritative before recording it.

create table if not exists public.billing_capacity_schedule_projections (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  stripe_subscription_id text not null
    check (btrim(stripe_subscription_id) <> ''),
  stripe_schedule_id text not null check (btrim(stripe_schedule_id) <> ''),
  source_event_id text not null check (btrim(source_event_id) <> ''),
  provider_event_created_at timestamptz not null,
  event_priority smallint not null check (event_priority in (0, 50, 100)),
  effective_at timestamptz not null,
  item_ref text not null check (btrim(item_ref) <> ''),
  item_kind text not null
    check (item_kind in ('concurrency_addon', 'retained_data_addon')),
  price_lookup_key text not null check (btrim(price_lookup_key) <> ''),
  quantity integer not null check (quantity >= 0),
  concurrency_delta integer not null check (concurrency_delta >= 0),
  retained_data_bytes_delta bigint not null
    check (retained_data_bytes_delta >= 0),
  applied boolean not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_capacity_schedule_projection_event_key
    unique (account_id, source_event_id)
);

create index if not exists billing_capacity_schedule_projection_order_idx
  on public.billing_capacity_schedule_projections (
    account_id,
    stripe_schedule_id,
    item_ref,
    provider_event_created_at desc,
    event_priority desc,
    source_event_id desc
  ) where applied;

drop trigger if exists billing_capacity_schedule_projections_immutable
  on public.billing_capacity_schedule_projections;
create trigger billing_capacity_schedule_projections_immutable
before update or delete on public.billing_capacity_schedule_projections
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.record_billing_capacity_schedule_projection(
  p_account uuid,
  p_subscription_id text,
  p_schedule_id text,
  p_source_event_id text,
  p_provider_event_created_at timestamptz,
  p_event_priority smallint,
  p_effective_at timestamptz,
  p_item_ref text,
  p_item_kind text,
  p_price_lookup_key text,
  p_quantity integer,
  p_concurrency_delta integer,
  p_retained_data_bytes_delta bigint,
  p_metadata jsonb
) returns table (
  applied boolean,
  duplicate boolean,
  stale boolean,
  entitlement_recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_existing public.billing_capacity_schedule_projections%rowtype;
  v_latest public.billing_capacity_schedule_projections%rowtype;
  v_should_apply boolean;
  v_recorded boolean := false;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = ''
    or p_schedule_id is null or btrim(p_schedule_id) = ''
    or p_source_event_id is null or btrim(p_source_event_id) = ''
    or p_provider_event_created_at is null
    or p_effective_at is null
    or p_item_ref is null or btrim(p_item_ref) = ''
    or p_price_lookup_key is null or btrim(p_price_lookup_key) = '' then
    raise exception 'capacity schedule projection identity is invalid';
  end if;
  if p_event_priority is null or p_event_priority not in (0, 50, 100)
    or p_item_kind is null
    or p_item_kind not in ('concurrency_addon', 'retained_data_addon')
    or p_quantity is null or p_quantity < 0
    or p_concurrency_delta is null or p_concurrency_delta < 0
    or p_retained_data_bytes_delta is null
    or p_retained_data_bytes_delta < 0
    or (p_item_kind = 'concurrency_addon'
      and (p_concurrency_delta = 0 or p_retained_data_bytes_delta <> 0))
    or (p_item_kind = 'retained_data_addon'
      and (p_retained_data_bytes_delta = 0 or p_concurrency_delta <> 0)) then
    raise exception 'capacity schedule projection values are invalid';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'capacity schedule projection metadata must be an object';
  end if;

  select * into v_account
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;
  if v_account.stripe_subscription_id is not null
    and v_account.stripe_subscription_id <> btrim(p_subscription_id) then
    raise exception 'capacity schedule subscription does not match account';
  end if;

  select * into v_existing
  from public.billing_capacity_schedule_projections
  where account_id = p_account
    and source_event_id = btrim(p_source_event_id);
  if found then
    if v_existing.stripe_subscription_id <> btrim(p_subscription_id)
      or v_existing.stripe_schedule_id <> btrim(p_schedule_id)
      or v_existing.provider_event_created_at <> p_provider_event_created_at
      or v_existing.event_priority <> p_event_priority
      or v_existing.effective_at <> p_effective_at
      or v_existing.item_ref <> btrim(p_item_ref)
      or v_existing.item_kind <> p_item_kind
      or v_existing.price_lookup_key <> btrim(p_price_lookup_key)
      or v_existing.quantity <> p_quantity
      or v_existing.concurrency_delta <> p_concurrency_delta
      or v_existing.retained_data_bytes_delta <> p_retained_data_bytes_delta
      or v_existing.metadata <> coalesce(p_metadata, '{}') then
      raise exception 'capacity schedule projection idempotency conflict for %',
        p_source_event_id;
    end if;
    return query select false, true, not v_existing.applied, false;
    return;
  end if;

  select * into v_latest
  from public.billing_capacity_schedule_projections
  where account_id = p_account
    and stripe_schedule_id = btrim(p_schedule_id)
    and item_ref = btrim(p_item_ref)
    and billing_capacity_schedule_projections.applied
  order by provider_event_created_at desc,
    event_priority desc,
    source_event_id desc
  limit 1;

  v_should_apply := not found
    or p_provider_event_created_at > v_latest.provider_event_created_at
    or (
      p_provider_event_created_at = v_latest.provider_event_created_at
      and p_event_priority > v_latest.event_priority
    )
    or (
      p_provider_event_created_at = v_latest.provider_event_created_at
      and p_event_priority = v_latest.event_priority
      and btrim(p_source_event_id) > v_latest.source_event_id
    );

  insert into public.billing_capacity_schedule_projections (
    account_id,
    stripe_subscription_id,
    stripe_schedule_id,
    source_event_id,
    provider_event_created_at,
    event_priority,
    effective_at,
    item_ref,
    item_kind,
    price_lookup_key,
    quantity,
    concurrency_delta,
    retained_data_bytes_delta,
    applied,
    metadata
  ) values (
    p_account,
    btrim(p_subscription_id),
    btrim(p_schedule_id),
    btrim(p_source_event_id),
    p_provider_event_created_at,
    p_event_priority,
    p_effective_at,
    btrim(p_item_ref),
    p_item_kind,
    btrim(p_price_lookup_key),
    p_quantity,
    p_concurrency_delta,
    p_retained_data_bytes_delta,
    v_should_apply,
    coalesce(p_metadata, '{}')
  );

  if v_should_apply then
    v_recorded := public.record_billing_entitlement_item(
      p_account,
      btrim(p_item_ref),
      p_item_kind,
      btrim(p_price_lookup_key),
      p_quantity,
      p_concurrency_delta,
      p_retained_data_bytes_delta,
      0,
      p_effective_at,
      btrim(p_source_event_id),
      coalesce(p_metadata, '{}') || jsonb_build_object(
        'stripe_subscription_id', btrim(p_subscription_id),
        'stripe_schedule_id', btrim(p_schedule_id),
        'scheduled', true
      )
    );
  end if;

  return query select
    v_should_apply,
    false,
    not v_should_apply,
    v_recorded;
end;
$$;

alter table public.billing_capacity_schedule_projections enable row level security;

revoke all on table public.billing_capacity_schedule_projections
  from public, anon, authenticated, service_role;
grant select on table public.billing_capacity_schedule_projections
  to service_role;

revoke all on function public.record_billing_capacity_schedule_projection(
  uuid, text, text, text, timestamptz, smallint, timestamptz, text, text,
  text, integer, integer, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_billing_capacity_schedule_projection(
  uuid, text, text, text, timestamptz, smallint, timestamptz, text, text,
  text, integer, integer, bigint, jsonb
) to service_role;
