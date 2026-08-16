-- Capacity-pricing Sprint 1 foundation. The new accounting path starts in
-- shadow mode: it records durable facts but does not debit credit, reject work,
-- change Stripe state, or alter customer-visible behavior.

alter table public.billing_accounts
  add column if not exists plan_code text
    check (plan_code is null or plan_code in
      ('pro', 'plus', 'max', 'business', 'enterprise')),
  add column if not exists plan_audience text not null default 'legacy'
    check (plan_audience in ('legacy', 'individual', 'business', 'enterprise')),
  add column if not exists max_named_users integer
    check (max_named_users is null or max_named_users > 0),
  add column if not exists included_concurrency integer not null default 0
    check (included_concurrency >= 0),
  add column if not exists included_retained_bytes bigint not null default 0
    check (included_retained_bytes >= 0),
  add column if not exists included_hosted_usage_cents bigint not null default 0
    check (included_hosted_usage_cents >= 0),
  add column if not exists entitlement_catalog_version text not null
    default 'capacity_v2',
  add column if not exists entitlement_version bigint not null default 0
    check (entitlement_version >= 0),
  add column if not exists entitlement_enforcement_mode text not null
    default 'shadow'
    check (entitlement_enforcement_mode in ('shadow', 'meter_only', 'enforced'));

-- Each plan or recurring add-on change is a new version. Quantity zero closes
-- an item. Reordered Stripe delivery can be replayed without overwriting its
-- source event.
create table if not exists public.billing_entitlement_items (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.billing_accounts (id) on delete restrict,
  item_ref text not null check (btrim(item_ref) <> ''),
  item_kind text not null
    check (item_kind in ('plan', 'concurrency_addon', 'retained_data_addon')),
  price_lookup_key text not null check (btrim(price_lookup_key) <> ''),
  quantity integer not null check (quantity >= 0),
  concurrency_delta integer not null default 0
    check (concurrency_delta >= 0),
  retained_data_bytes_delta bigint not null default 0
    check (retained_data_bytes_delta >= 0),
  hosted_usage_cents_delta bigint not null default 0
    check (hosted_usage_cents_delta >= 0),
  effective_at timestamptz not null,
  source_event_id text not null check (btrim(source_event_id) <> ''),
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_entitlement_items_source_key
    unique (account_id, item_ref, source_event_id)
);

create index if not exists billing_entitlement_items_current_idx
  on public.billing_entitlement_items
    (account_id, item_ref, effective_at desc, id desc);

create or replace view public.billing_current_entitlement_items
with (security_invoker = true) as
select distinct on (account_id, item_ref)
  id,
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
  metadata,
  recorded_at
from public.billing_entitlement_items
where effective_at <= now()
order by account_id, item_ref, effective_at desc, id desc;

-- One named category keeps unattributable platform cost visible instead of
-- dropping it or assigning it to a customer.
create table if not exists public.billing_shared_overhead_categories (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.billing_shared_overhead_categories (code, description)
values (
  'platform_operations',
  'Hosted provider cost that cannot reasonably be attributed to one account'
)
on conflict (code) do nothing;

-- Monetary values use integer microdollars so sub-cent costs remain exact
-- until later settlement into the existing credit ledger.
create table if not exists public.billing_provider_cost_events (
  id bigint generated always as identity primary key,
  provider text not null check (btrim(provider) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  cost_source text not null check (cost_source in (
    'ai',
    'trigger',
    'sandbox_compute',
    'sandbox_transfer',
    'retained_data',
    'vercel_function',
    'database',
    'email',
    'object_storage',
    'transfer',
    'observability',
    'other'
  )),
  account_id uuid references public.billing_accounts (id) on delete restrict,
  shared_overhead_category text references
    public.billing_shared_overhead_categories (code) on delete restrict,
  provider_cost_micros bigint not null check (provider_cost_micros >= 0),
  provider_currency text not null default 'USD'
    check (char_length(provider_currency) = 3),
  normalized_cost_micros bigint not null
    check (normalized_cost_micros >= 0),
  retail_debit_micros bigint not null check (retail_debit_micros >= 0),
  billing_treatment text not null
    check (billing_treatment in
      ('capacity_revenue', 'hosted_usage', 'shared_overhead')),
  pricing_rule_version text not null
    check (btrim(pricing_rule_version) <> ''),
  measured_quantity numeric(30, 9),
  measured_unit text,
  operation_ref text,
  root_workflow_ref text,
  run_ref text,
  sandbox_ref text,
  artifact_ref text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint billing_provider_cost_events_provider_key
    unique (provider, provider_event_id),
  constraint billing_provider_cost_events_owner_shape check (
    (account_id is not null and shared_overhead_category is null
      and billing_treatment <> 'shared_overhead')
    or
    (account_id is null and shared_overhead_category is not null
      and billing_treatment = 'shared_overhead')
  ),
  constraint billing_provider_cost_events_retail_shape check (
    billing_treatment = 'hosted_usage' or retail_debit_micros = 0
  )
);

create index if not exists billing_provider_cost_events_account_time_idx
  on public.billing_provider_cost_events (account_id, occurred_at desc)
  where account_id is not null;
create index if not exists billing_provider_cost_events_overhead_time_idx
  on public.billing_provider_cost_events
    (shared_overhead_category, occurred_at desc)
  where shared_overhead_category is not null;

create or replace function public.reject_immutable_billing_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; insert a compensating event', tg_table_name;
end;
$$;

drop trigger if exists billing_entitlement_items_immutable
  on public.billing_entitlement_items;
create trigger billing_entitlement_items_immutable
before update or delete on public.billing_entitlement_items
for each row execute function public.reject_immutable_billing_event_mutation();

drop trigger if exists billing_provider_cost_events_immutable
  on public.billing_provider_cost_events;
create trigger billing_provider_cost_events_immutable
before update or delete on public.billing_provider_cost_events
for each row execute function public.reject_immutable_billing_event_mutation();

create or replace function public.record_billing_entitlement_item(
  p_account uuid,
  p_item_ref text,
  p_item_kind text,
  p_price_lookup_key text,
  p_quantity integer,
  p_concurrency_delta integer,
  p_retained_data_bytes_delta bigint,
  p_hosted_usage_cents_delta bigint,
  p_effective_at timestamptz,
  p_source_event_id text,
  p_metadata jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.billing_entitlement_items%rowtype;
begin
  perform 1 from public.billing_accounts where id = p_account;
  if not found then
    raise exception 'billing account % not found', p_account;
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
    btrim(p_item_ref),
    p_item_kind,
    btrim(p_price_lookup_key),
    p_quantity,
    p_concurrency_delta,
    p_retained_data_bytes_delta,
    p_hosted_usage_cents_delta,
    p_effective_at,
    btrim(p_source_event_id),
    coalesce(p_metadata, '{}')
  ) on conflict (account_id, item_ref, source_event_id) do nothing;

  if found then
    return true;
  end if;

  select * into v_existing
  from public.billing_entitlement_items
  where account_id = p_account
    and item_ref = btrim(p_item_ref)
    and source_event_id = btrim(p_source_event_id);

  if v_existing.item_kind <> p_item_kind
    or v_existing.price_lookup_key <> btrim(p_price_lookup_key)
    or v_existing.quantity <> p_quantity
    or v_existing.concurrency_delta <> p_concurrency_delta
    or v_existing.retained_data_bytes_delta <> p_retained_data_bytes_delta
    or v_existing.hosted_usage_cents_delta <> p_hosted_usage_cents_delta
    or v_existing.effective_at <> p_effective_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'entitlement item idempotency conflict for %', p_source_event_id;
  end if;

  return false;
end;
$$;

create or replace function public.record_billing_provider_cost_event(
  p_provider text,
  p_provider_event_id text,
  p_cost_source text,
  p_account uuid,
  p_shared_overhead_category text,
  p_provider_cost_micros bigint,
  p_provider_currency text,
  p_normalized_cost_micros bigint,
  p_retail_debit_micros bigint,
  p_billing_treatment text,
  p_pricing_rule_version text,
  p_measured_quantity numeric,
  p_measured_unit text,
  p_occurred_at timestamptz,
  p_refs jsonb,
  p_metadata jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.billing_provider_cost_events%rowtype;
begin
  if p_account is not null then
    perform 1 from public.billing_accounts where id = p_account;
    if not found then
      raise exception 'billing account % not found', p_account;
    end if;
  end if;

  insert into public.billing_provider_cost_events (
    provider,
    provider_event_id,
    cost_source,
    account_id,
    shared_overhead_category,
    provider_cost_micros,
    provider_currency,
    normalized_cost_micros,
    retail_debit_micros,
    billing_treatment,
    pricing_rule_version,
    measured_quantity,
    measured_unit,
    operation_ref,
    root_workflow_ref,
    run_ref,
    sandbox_ref,
    artifact_ref,
    occurred_at,
    metadata
  ) values (
    btrim(p_provider),
    btrim(p_provider_event_id),
    p_cost_source,
    p_account,
    p_shared_overhead_category,
    p_provider_cost_micros,
    upper(p_provider_currency),
    p_normalized_cost_micros,
    p_retail_debit_micros,
    p_billing_treatment,
    btrim(p_pricing_rule_version),
    p_measured_quantity,
    p_measured_unit,
    p_refs ->> 'operationRef',
    p_refs ->> 'rootWorkflowRef',
    p_refs ->> 'runRef',
    p_refs ->> 'sandboxRef',
    p_refs ->> 'artifactRef',
    p_occurred_at,
    coalesce(p_metadata, '{}')
  ) on conflict (provider, provider_event_id) do nothing;

  if found then
    return true;
  end if;

  select * into v_existing
  from public.billing_provider_cost_events
  where provider = btrim(p_provider)
    and provider_event_id = btrim(p_provider_event_id);

  if v_existing.cost_source <> p_cost_source
    or v_existing.account_id is distinct from p_account
    or v_existing.shared_overhead_category is distinct from
      p_shared_overhead_category
    or v_existing.provider_cost_micros <> p_provider_cost_micros
    or v_existing.provider_currency <> upper(p_provider_currency)
    or v_existing.normalized_cost_micros <> p_normalized_cost_micros
    or v_existing.retail_debit_micros <> p_retail_debit_micros
    or v_existing.billing_treatment <> p_billing_treatment
    or v_existing.pricing_rule_version <> btrim(p_pricing_rule_version)
    or v_existing.measured_quantity is distinct from p_measured_quantity
    or v_existing.measured_unit is distinct from p_measured_unit
    or v_existing.operation_ref is distinct from p_refs ->> 'operationRef'
    or v_existing.root_workflow_ref is distinct from
      p_refs ->> 'rootWorkflowRef'
    or v_existing.run_ref is distinct from p_refs ->> 'runRef'
    or v_existing.sandbox_ref is distinct from p_refs ->> 'sandboxRef'
    or v_existing.artifact_ref is distinct from p_refs ->> 'artifactRef'
    or v_existing.occurred_at <> p_occurred_at
    or v_existing.metadata <> coalesce(p_metadata, '{}') then
    raise exception 'provider cost idempotency conflict for %:%',
      p_provider, p_provider_event_id;
  end if;

  return false;
end;
$$;

alter table public.billing_entitlement_items enable row level security;
alter table public.billing_shared_overhead_categories enable row level security;
alter table public.billing_provider_cost_events enable row level security;

revoke all on table public.billing_entitlement_items
  from anon, authenticated, service_role;
revoke all on table public.billing_shared_overhead_categories
  from anon, authenticated, service_role;
revoke all on table public.billing_provider_cost_events
  from anon, authenticated, service_role;

grant select on table public.billing_entitlement_items,
  public.billing_current_entitlement_items,
  public.billing_shared_overhead_categories,
  public.billing_provider_cost_events
to service_role;

revoke all on function public.reject_immutable_billing_event_mutation()
  from public, anon, authenticated;
revoke all on function public.record_billing_entitlement_item(
  uuid, text, text, text, integer, integer, bigint, bigint,
  timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.record_billing_provider_cost_event(
  text, text, text, uuid, text, bigint, text, bigint, bigint, text, text,
  numeric, text, timestamptz, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.record_billing_entitlement_item(
  uuid, text, text, text, integer, integer, bigint, bigint,
  timestamptz, text, jsonb
) to service_role;
grant execute on function public.record_billing_provider_cost_event(
  text, text, text, uuid, text, bigint, text, bigint, bigint, text, text,
  numeric, text, timestamptz, jsonb, jsonb
) to service_role;
