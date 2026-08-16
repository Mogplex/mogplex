-- Stripe capacity entitlement snapshots are append-only and applied through
-- one account-locked RPC. A durable ordering watermark prevents reordered
-- webhook delivery from rolling the current account projection backward.

alter table public.billing_accounts
  add column if not exists entitlement_projection_effective_at timestamptz,
  add column if not exists entitlement_projection_event_id text,
  add column if not exists entitlement_projection_priority smallint not null
    default 0 check (entitlement_projection_priority in (0, 100));

create table if not exists public.billing_entitlement_snapshots (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  stripe_subscription_id text not null check (btrim(stripe_subscription_id) <> ''),
  source_event_id text not null check (btrim(source_event_id) <> ''),
  effective_at timestamptz not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  applied boolean not null,
  recorded_at timestamptz not null default now(),
  constraint billing_entitlement_snapshots_event_key
    unique (account_id, source_event_id)
);

create index if not exists billing_entitlement_snapshots_account_time_idx
  on public.billing_entitlement_snapshots
    (account_id, effective_at desc, source_event_id desc);

drop trigger if exists billing_entitlement_snapshots_immutable
  on public.billing_entitlement_snapshots;
create trigger billing_entitlement_snapshots_immutable
before update or delete on public.billing_entitlement_snapshots
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.apply_billing_capacity_entitlement_snapshot(
  p_account uuid,
  p_subscription_id text,
  p_source_event_id text,
  p_effective_at timestamptz,
  p_snapshot jsonb
) returns table (
  applied boolean,
  duplicate boolean,
  stale boolean,
  entitlement_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_existing public.billing_entitlement_snapshots%rowtype;
  v_should_apply boolean;
  v_cancellation boolean;
  v_event_priority smallint;
  v_plan jsonb;
  v_items jsonb;
  v_item jsonb;
  v_item_refs text[] := array[]::text[];
  v_item_ref text;
  v_item_kind text;
  v_lookup_key text;
  v_quantity integer;
  v_concurrency_delta integer;
  v_retained_delta bigint;
  v_hosted_delta bigint;
  v_plan_count integer := 0;
  v_plan_code text;
  v_max_named_users integer;
  v_included_concurrency integer;
  v_included_retained_bytes bigint;
  v_included_hosted_usage_cents bigint;
  v_period_anchor date;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'capacity entitlement subscription id is required';
  end if;
  if p_source_event_id is null or btrim(p_source_event_id) = '' then
    raise exception 'capacity entitlement source event id is required';
  end if;
  if p_effective_at is null then
    raise exception 'capacity entitlement effective time is required';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'capacity entitlement snapshot must be an object';
  end if;
  if p_snapshot->>'catalogVersion' is distinct from 'capacity_v2'
    or p_snapshot->>'subscriptionId' is distinct from btrim(p_subscription_id) then
    raise exception 'capacity entitlement snapshot identity is invalid';
  end if;
  if jsonb_typeof(p_snapshot->'cancellation') is distinct from 'boolean'
    or jsonb_typeof(p_snapshot->'items') is distinct from 'array' then
    raise exception 'capacity entitlement snapshot shape is invalid';
  end if;
  v_cancellation := (p_snapshot->>'cancellation')::boolean;
  v_event_priority := case when v_cancellation then 100 else 0 end;

  select * into v_account
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  select * into v_existing
  from public.billing_entitlement_snapshots
  where account_id = p_account
    and source_event_id = btrim(p_source_event_id);
  if found then
    if v_existing.stripe_subscription_id <> btrim(p_subscription_id)
      or v_existing.effective_at <> p_effective_at
      or v_existing.snapshot <> p_snapshot then
      raise exception 'capacity entitlement snapshot idempotency conflict for %',
        p_source_event_id;
    end if;
    return query select
      false,
      true,
      not v_existing.applied,
      v_account.entitlement_version;
    return;
  end if;

  v_should_apply :=
    v_account.entitlement_projection_effective_at is null
    or p_effective_at > v_account.entitlement_projection_effective_at
    or (
      p_effective_at = v_account.entitlement_projection_effective_at
      and v_event_priority > v_account.entitlement_projection_priority
    )
    or (
      p_effective_at = v_account.entitlement_projection_effective_at
      and v_event_priority = v_account.entitlement_projection_priority
      and btrim(p_source_event_id) >
          coalesce(v_account.entitlement_projection_event_id, '')
    );

  insert into public.billing_entitlement_snapshots (
    account_id,
    stripe_subscription_id,
    source_event_id,
    effective_at,
    snapshot,
    applied
  ) values (
    p_account,
    btrim(p_subscription_id),
    btrim(p_source_event_id),
    p_effective_at,
    p_snapshot,
    v_should_apply
  );

  if not v_should_apply then
    return query select false, false, true, v_account.entitlement_version;
    return;
  end if;

  v_plan := p_snapshot->'plan';
  v_items := p_snapshot->'items';

  if v_cancellation then
    if v_plan is distinct from 'null'::jsonb
      or jsonb_array_length(v_items) <> 0 then
      raise exception 'capacity cancellation snapshot must not include entitlements';
    end if;
    v_plan_code := null;
    v_max_named_users := null;
    v_included_concurrency := 0;
    v_included_retained_bytes := 0;
    v_included_hosted_usage_cents := 0;
    v_period_anchor := null;
  else
    if jsonb_typeof(v_plan) is distinct from 'object' then
      raise exception 'capacity entitlement snapshot plan is required';
    end if;
    v_plan_code := v_plan->>'code';
    v_max_named_users := (v_plan->>'maxNamedUsers')::integer;
    v_included_concurrency := (v_plan->>'concurrency')::integer;
    v_included_retained_bytes := (v_plan->>'retainedDataBytes')::bigint;
    v_included_hosted_usage_cents :=
      (v_plan->>'hostedUsageCents')::bigint;
    v_period_anchor := (v_plan->>'periodAnchor')::date;
    if v_plan_code is null
      or v_plan_code not in ('pro', 'plus', 'max')
      or nullif(btrim(v_plan->>'priceLookupKey'), '') is null
      or v_max_named_users is distinct from 1
      or v_included_concurrency is null
      or v_included_concurrency < 0
      or v_included_retained_bytes is null
      or v_included_retained_bytes < 0
      or v_included_hosted_usage_cents is null
      or v_period_anchor is null
      or v_included_hosted_usage_cents < 0 then
      raise exception 'capacity entitlement plan values are invalid';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'capacity entitlement item must be an object';
    end if;
    v_item_ref := btrim(v_item->>'itemRef');
    v_item_kind := v_item->>'itemKind';
    v_lookup_key := btrim(v_item->>'priceLookupKey');
    v_quantity := (v_item->>'quantity')::integer;
    v_concurrency_delta := (v_item->>'concurrencyDelta')::integer;
    v_retained_delta := (v_item->>'retainedDataBytesDelta')::bigint;
    v_hosted_delta := (v_item->>'hostedUsageCentsDelta')::bigint;
    if v_item_ref is null or v_item_ref = ''
      or v_lookup_key is null or v_lookup_key = ''
      or v_item_kind is null
      or v_item_kind not in
        ('plan', 'concurrency_addon', 'retained_data_addon')
      or v_quantity is null
      or v_quantity <= 0
      or v_concurrency_delta is null
      or v_concurrency_delta < 0
      or v_retained_delta is null
      or v_retained_delta < 0
      or v_hosted_delta is null
      or v_hosted_delta < 0 then
      raise exception 'capacity entitlement item values are invalid';
    end if;
    if v_item_ref = any(v_item_refs) then
      raise exception 'duplicate capacity entitlement item %', v_item_ref;
    end if;
    v_item_refs := array_append(v_item_refs, v_item_ref);
    if v_item_kind = 'plan' then
      v_plan_count := v_plan_count + 1;
      if v_quantity <> 1
        or v_lookup_key <> v_plan->>'priceLookupKey'
        or v_concurrency_delta <> v_included_concurrency
        or v_retained_delta <> v_included_retained_bytes
        or v_hosted_delta <> v_included_hosted_usage_cents then
        raise exception 'capacity entitlement plan item does not match plan';
      end if;
    elsif v_hosted_delta <> 0 then
      raise exception 'capacity add-on cannot grant hosted usage';
    end if;

    insert into public.billing_entitlement_items (
      account_id,
      item_ref,
      item_kind,
      price_lookup_key,
      quantity,
      concurrency_delta,
      retained_data_bytes_delta,
      hosted_usage_cents_delta,
      effective_at,
      source_event_id,
      metadata
    ) values (
      p_account,
      v_item_ref,
      v_item_kind,
      v_lookup_key,
      v_quantity,
      v_concurrency_delta,
      v_retained_delta,
      v_hosted_delta,
      p_effective_at,
      btrim(p_source_event_id),
      jsonb_build_object(
        'stripe_subscription_id', btrim(p_subscription_id),
        'catalog_version', 'capacity_v2'
      )
    );
  end loop;

  if (not v_cancellation and v_plan_count <> 1)
    or (v_cancellation and v_plan_count <> 0) then
    raise exception 'capacity entitlement snapshot has an invalid plan count';
  end if;

  insert into public.billing_entitlement_items (
    account_id,
    item_ref,
    item_kind,
    price_lookup_key,
    quantity,
    concurrency_delta,
    retained_data_bytes_delta,
    hosted_usage_cents_delta,
    effective_at,
    source_event_id,
    metadata
  )
  select
    p_account,
    previous.item_ref,
    previous.item_kind,
    previous.price_lookup_key,
    0,
    previous.concurrency_delta,
    previous.retained_data_bytes_delta,
    previous.hosted_usage_cents_delta,
    p_effective_at,
    btrim(p_source_event_id),
    jsonb_build_object(
      'stripe_subscription_id', btrim(p_subscription_id),
      'catalog_version', 'capacity_v2',
      'closed_by_snapshot', true
    )
  from (
    select distinct on (item_ref)
      item_ref,
      item_kind,
      price_lookup_key,
      quantity,
      concurrency_delta,
      retained_data_bytes_delta,
      hosted_usage_cents_delta
    from public.billing_entitlement_items
    where account_id = p_account
      and metadata->>'stripe_subscription_id' = btrim(p_subscription_id)
      and source_event_id <> btrim(p_source_event_id)
    order by item_ref, effective_at desc, id desc
  ) previous
  where previous.quantity > 0
    and not (previous.item_ref = any(v_item_refs));

  update public.billing_accounts
  set plan_code = v_plan_code,
      plan_audience = case
        when v_plan_code is null then 'legacy'
        else 'individual'
      end,
      max_named_users = v_max_named_users,
      included_concurrency = v_included_concurrency,
      included_retained_bytes = v_included_retained_bytes,
      included_hosted_usage_cents = v_included_hosted_usage_cents,
      entitlement_catalog_version = 'capacity_v2',
      entitlement_version = public.billing_accounts.entitlement_version + 1,
      entitlement_projection_effective_at = p_effective_at,
      entitlement_projection_event_id = btrim(p_source_event_id),
      entitlement_projection_priority = v_event_priority,
      stripe_subscription_id = case
        when v_cancellation then null
        else btrim(p_subscription_id)
      end,
      period_anchor = v_period_anchor,
      updated_at = now()
  where id = p_account
  returning billing_accounts.entitlement_version
    into v_account.entitlement_version;

  return query select true, false, false, v_account.entitlement_version;
end;
$$;

alter table public.billing_entitlement_snapshots enable row level security;

revoke all on table public.billing_entitlement_snapshots
  from public, anon, authenticated, service_role;
grant select on table public.billing_entitlement_snapshots to service_role;

revoke all on function public.apply_billing_capacity_entitlement_snapshot(
  uuid, text, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_billing_capacity_entitlement_snapshot(
  uuid, text, text, timestamptz, jsonb
) to service_role;
