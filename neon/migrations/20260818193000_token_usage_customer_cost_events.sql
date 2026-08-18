-- Keep customer-visible AI usage history in the same transaction as the exact
-- token accrual. This records cost facts only; the existing accrual function
-- remains the sole writer of customer credit debits.

create or replace function public.publish_token_usage_cost_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost_micros bigint := (new.cost_units + 99) / 100;
begin
  perform public.record_billing_provider_cost_event(
    'vercel-ai-gateway',
    new.source_ref,
    'ai',
    new.account_id,
    null,
    v_cost_micros,
    'USD',
    v_cost_micros,
    v_cost_micros,
    'hosted_usage',
    'gateway_passthrough_2026_08_18',
    new.cost_units,
    '1e-8_usd',
    new.created_at,
    pg_catalog.jsonb_build_object(
      'operationRef',
      coalesce(
        nullif(new.metadata ->> 'ai_call_id', ''),
        pg_catalog.regexp_replace(new.source_ref, '^tok:', '')
      )
    ),
    new.metadata
  );
  return new;
end;
$$;

drop trigger if exists token_usage_accruals_publish_cost_event
  on public.token_usage_accruals;
create trigger token_usage_accruals_publish_cost_event
after insert on public.token_usage_accruals
for each row execute function public.publish_token_usage_cost_event();

-- Existing exact accruals were already debited. Backfill only their immutable
-- customer cost facts so recent usage becomes visible without another charge.
insert into public.billing_provider_cost_events (
  provider,
  provider_event_id,
  cost_source,
  account_id,
  provider_cost_micros,
  provider_currency,
  normalized_cost_micros,
  retail_debit_micros,
  billing_treatment,
  pricing_rule_version,
  measured_quantity,
  measured_unit,
  operation_ref,
  occurred_at,
  metadata
)
select
  'vercel-ai-gateway',
  accrual.source_ref,
  'ai',
  accrual.account_id,
  (accrual.cost_units + 99) / 100,
  'USD',
  (accrual.cost_units + 99) / 100,
  (accrual.cost_units + 99) / 100,
  'hosted_usage',
  'gateway_passthrough_2026_08_18',
  accrual.cost_units,
  '1e-8_usd',
  coalesce(
    nullif(accrual.metadata ->> 'ai_call_id', ''),
    pg_catalog.regexp_replace(accrual.source_ref, '^tok:', '')
  ),
  accrual.created_at,
  accrual.metadata || pg_catalog.jsonb_build_object(
    'customer_description',
    case
      when call.type = 'pr_review'
        and nullif(call.metadata ->> 'repo_full_name', '') is not null
        and nullif(call.metadata ->> 'pr_number', '') is not null
        then 'Code review · ' || (call.metadata ->> 'repo_full_name')
          || ' #' || (call.metadata ->> 'pr_number')
      when call.metadata ->> 'source' = 'cli' then 'CLI task'
      when nullif(call.metadata ->> 'flow_node_label', '') is not null
        then call.metadata ->> 'flow_node_label'
      else 'AI inference'
    end
  )
from public.token_usage_accruals accrual
left join public.ai_calls call
  on call.id::text = accrual.metadata ->> 'ai_call_id'
on conflict (provider, provider_event_id) do nothing;

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
  pg_catalog.sum(event.retail_debit_micros)::bigint as retail_debit_micros,
  pg_catalog.max(event.occurred_at) as occurred_at,
  pg_catalog.max(
    coalesce(
      nullif(event.metadata ->> 'customer_description', ''),
      'Hosted work'
    )
  ) as description
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

revoke all on table public.billing_customer_retail_cost_operations
from public, anon, authenticated;
grant select on table public.billing_customer_retail_cost_operations
to service_role;
