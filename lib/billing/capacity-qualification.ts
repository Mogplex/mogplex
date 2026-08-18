/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import type { Pool } from "pg";
import {
  findCapacityAddOn,
  findIndividualCapacityPrice,
} from "@/lib/billing/capacity-catalog";

type QualificationRow = {
  account_count: string;
  paying_account_count: string;
  paying_accounts_without_plan: string;
  provider_event_count: string;
  provider_cost_micros: string;
  customer_cost_micros: string;
  customer_retail_debit_micros: string;
  capacity_and_overhead_cost_micros: string;
  shared_overhead_micros: string;
  recurring_items: unknown;
  ownerless_provider_events: string;
  cost_sources_present: string[];
  open_reservation_count: string;
  expired_open_reservations: string;
  active_lease_count: string;
  terminal_workflow_leases: string;
};

export type CapacityBillingQualification = {
  ok: boolean;
  asOf: string;
  checks: {
    hasBillingAccounts: boolean;
    entitlementsBackfilled: boolean;
    providerLedgerPopulated: boolean;
    providerOwnershipComplete: boolean;
    requiredCostSourcesPresent: boolean;
    customerCostsCovered: boolean;
    recurringRevenueCoversPlatformCosts: boolean;
    noExpiredOpenReservations: boolean;
    noTerminalWorkflowLeases: boolean;
  };
  accounts: {
    total: number;
    paying: number;
    payingWithoutPlan: number;
  };
  providerCosts: {
    events: number;
    providerCostMicros: string;
    customerCostMicros: string;
    customerRetailDebitMicros: string;
    capacityAndOverheadCostMicros: string;
    sharedOverheadMicros: string;
    recurringRevenueMicros: string;
    ownerlessEvents: number;
    sourcesPresent: string[];
  };
  reservations: { open: number; expiredOpen: number };
  workflowLeases: { active: number; terminal: number };
};

const REQUIRED_COST_SOURCES = [
  "ai",
  "trigger",
  "sandbox_compute",
  "database",
  "vercel_function",
  "email",
  "object_storage",
  "observability",
] as const;

const QUALIFICATION_SQL = `
with account_stats as (
  select
    count(*)::text as account_count,
    count(*) filter (where tier <> 'free')::text as paying_account_count,
    count(*) filter (
      where tier <> 'free' and plan_code is null
    )::text as paying_accounts_without_plan
  from public.billing_accounts
), current_recurring_items as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'priceLookupKey', price_lookup_key,
    'quantity', quantity
  )), '[]'::jsonb) as recurring_items
  from public.billing_current_entitlement_items
  where quantity > 0
), provider_stats as (
  select
    count(*)::text as provider_event_count,
    coalesce(sum(normalized_cost_micros), 0)::text as provider_cost_micros,
    coalesce(sum(normalized_cost_micros) filter (
      where account_id is not null
        and billing_treatment = 'hosted_usage'
    ), 0)::text as customer_cost_micros,
    coalesce(sum(retail_debit_micros) filter (
      where account_id is not null
        and billing_treatment = 'hosted_usage'
    ), 0)::text as customer_retail_debit_micros,
    coalesce(sum(normalized_cost_micros) filter (
      where billing_treatment <> 'hosted_usage'
    ), 0)::text as capacity_and_overhead_cost_micros,
    coalesce(sum(normalized_cost_micros) filter (
      where shared_overhead_category is not null
    ), 0)::text as shared_overhead_micros,
    count(*) filter (
      where account_id is null and shared_overhead_category is null
    )::text as ownerless_provider_events,
    coalesce(array_agg(distinct cost_source order by cost_source), '{}')
      as cost_sources_present
  from public.billing_provider_cost_events
  where occurred_at >= $1::timestamptz - interval '30 days'
), reservation_stats as (
  select
    count(*)::text as open_reservation_count,
    count(*) filter (where expires_at < now())::text
      as expired_open_reservations
  from public.billing_open_cost_reservations
), lease_stats as (
  select
    count(*)::text as active_lease_count,
    count(*) filter (
      where job.status in ('success', 'failed', 'cancelled')
    )::text as terminal_workflow_leases
  from public.billing_active_workflow_capacity_leases lease
  left join public.job_runs job on job.id::text = lease.root_workflow_ref
)
select *
from account_stats, current_recurring_items, provider_stats, reservation_stats,
  lease_stats
`;

function safeCount(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is not a safe count`);
  }
  return parsed;
}

function monthlyRecurringRevenueMicros(value: unknown): bigint {
  if (!Array.isArray(value)) return BigInt(0);
  return value.reduce((total: bigint, item) => {
    if (!item || typeof item !== "object") return total;
    const { priceLookupKey, quantity } = item as Record<string, unknown>;
    if (
      typeof priceLookupKey !== "string" ||
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      return total;
    }
    const plan = findIndividualCapacityPrice(priceLookupKey);
    const addOn = findCapacityAddOn(priceLookupKey);
    const amountCents = plan?.price.amountCents ?? addOn?.amountCents;
    if (amountCents === undefined) return total;
    const interval = plan?.price.interval ?? addOn?.interval;
    const monthlyMicros =
      interval === "year"
        ? (BigInt(amountCents) * BigInt(10_000)) / BigInt(12)
        : BigInt(amountCents) * BigInt(10_000);
    return total + monthlyMicros * BigInt(quantity);
  }, BigInt(0));
}

export async function runCapacityBillingQualification(
  database: Pick<Pool, "query">,
  now: Date = new Date()
): Promise<CapacityBillingQualification> {
  const result = await database.query<QualificationRow>(QUALIFICATION_SQL, [
    now.toISOString(),
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("Capacity billing qualification returned no row");

  const accounts = {
    total: safeCount(row.account_count, "account count"),
    paying: safeCount(row.paying_account_count, "paying account count"),
    payingWithoutPlan: safeCount(
      row.paying_accounts_without_plan,
      "unbackfilled paying account count"
    ),
  };
  const providerCosts = {
    events: safeCount(row.provider_event_count, "provider event count"),
    providerCostMicros: row.provider_cost_micros,
    customerCostMicros: row.customer_cost_micros,
    customerRetailDebitMicros: row.customer_retail_debit_micros,
    capacityAndOverheadCostMicros: row.capacity_and_overhead_cost_micros,
    sharedOverheadMicros: row.shared_overhead_micros,
    recurringRevenueMicros: monthlyRecurringRevenueMicros(
      row.recurring_items
    ).toString(),
    ownerlessEvents: safeCount(
      row.ownerless_provider_events,
      "ownerless provider event count"
    ),
    sourcesPresent: row.cost_sources_present,
  };
  const reservations = {
    open: safeCount(row.open_reservation_count, "open reservation count"),
    expiredOpen: safeCount(
      row.expired_open_reservations,
      "expired reservation count"
    ),
  };
  const workflowLeases = {
    active: safeCount(row.active_lease_count, "active lease count"),
    terminal: safeCount(
      row.terminal_workflow_leases,
      "terminal workflow lease count"
    ),
  };
  const checks = {
    hasBillingAccounts: accounts.total > 0,
    entitlementsBackfilled: accounts.payingWithoutPlan === 0,
    providerLedgerPopulated: providerCosts.events > 0,
    providerOwnershipComplete: providerCosts.ownerlessEvents === 0,
    requiredCostSourcesPresent: REQUIRED_COST_SOURCES.every((source) =>
      providerCosts.sourcesPresent.includes(source)
    ),
    customerCostsCovered:
      BigInt(providerCosts.customerRetailDebitMicros) >=
      BigInt(providerCosts.customerCostMicros),
    recurringRevenueCoversPlatformCosts:
      BigInt(providerCosts.recurringRevenueMicros) >=
      BigInt(providerCosts.capacityAndOverheadCostMicros),
    noExpiredOpenReservations: reservations.expiredOpen === 0,
    noTerminalWorkflowLeases: workflowLeases.terminal === 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    asOf: now.toISOString(),
    checks,
    accounts,
    providerCosts,
    reservations,
    workflowLeases,
  };
}
