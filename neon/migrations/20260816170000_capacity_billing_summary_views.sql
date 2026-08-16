-- Customer billing summaries need exact operation totals without loading or
-- exposing raw provider facts. These service-only projections aggregate the
-- retail side of hosted-usage events and omit provider cost, margin, metadata,
-- and shared overhead.
create or replace view public.billing_customer_retail_cost_operations
with (security_invoker = true) as
select
  event.account_id,
  coalesce(
    event.operation_ref,
    event.root_workflow_ref,
    event.run_ref,
    event.sandbox_ref,
    event.provider_event_id
  ) as operation_ref,
  sum(event.retail_debit_micros)::bigint as retail_debit_micros,
  max(event.occurred_at) as occurred_at
from public.billing_provider_cost_events event
where event.account_id is not null
  and event.billing_treatment = 'hosted_usage'
group by
  event.account_id,
  coalesce(
    event.operation_ref,
    event.root_workflow_ref,
    event.run_ref,
    event.sandbox_ref,
    event.provider_event_id
  );

create or replace view public.billing_customer_retail_cost_items
with (security_invoker = true) as
with normalized as (
  select
    event.account_id,
    coalesce(
      event.operation_ref,
      event.root_workflow_ref,
      event.run_ref,
      event.sandbox_ref,
      event.provider_event_id
    ) as operation_ref,
    event.cost_source,
    event.retail_debit_micros
  from public.billing_provider_cost_events event
  where event.account_id is not null
    and event.billing_treatment = 'hosted_usage'
)
select
  normalized.account_id,
  normalized.operation_ref,
  normalized.cost_source,
  sum(normalized.retail_debit_micros)::bigint as retail_debit_micros,
  operation.occurred_at
from normalized
join public.billing_customer_retail_cost_operations operation
  on operation.account_id = normalized.account_id
  and operation.operation_ref = normalized.operation_ref
group by
  normalized.account_id,
  normalized.operation_ref,
  normalized.cost_source,
  operation.occurred_at;

revoke all on table
  public.billing_customer_retail_cost_operations,
  public.billing_customer_retail_cost_items
from public, anon, authenticated;

grant select on table
  public.billing_customer_retail_cost_operations,
  public.billing_customer_retail_cost_items
to service_role;
