import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type BillingCostSource =
  | "ai"
  | "trigger"
  | "sandbox_compute"
  | "sandbox_transfer"
  | "retained_data"
  | "vercel_function"
  | "database"
  | "email"
  | "object_storage"
  | "transfer"
  | "observability"
  | "other";

export type ShadowEntitlementItem = {
  accountId: string;
  itemRef: string;
  itemKind: "plan" | "concurrency_addon" | "retained_data_addon";
  priceLookupKey: string;
  quantity: number;
  concurrencyDelta: number;
  retainedDataBytesDelta: bigint;
  hostedUsageCentsDelta: bigint;
  effectiveAt: Date;
  sourceEventId: string;
  metadata?: Record<string, unknown>;
};

export type ShadowProviderCostEvent = {
  provider: string;
  providerEventId: string;
  costSource: BillingCostSource;
  owner:
    | { accountId: string; sharedOverheadCategory?: never }
    | { accountId?: never; sharedOverheadCategory: "platform_operations" };
  providerCostMicros: bigint;
  providerCurrency?: string;
  normalizedCostMicros: bigint;
  retailDebitMicros: bigint;
  billingTreatment: "capacity_revenue" | "hosted_usage" | "shared_overhead";
  pricingRuleVersion: string;
  measuredQuantity?: string;
  measuredUnit?: string;
  occurredAt: Date;
  refs?: {
    operationRef?: string;
    rootWorkflowRef?: string;
    runRef?: string;
    sandboxRef?: string;
    artifactRef?: string;
  };
  metadata?: Record<string, unknown>;
};

function databaseInteger(value: bigint): string {
  return value.toString();
}

function posted(data: unknown): boolean {
  return data === true;
}

async function postShadowFact(
  client: SupabaseClient,
  rpc: string,
  args: Record<string, unknown>,
  label: string
): Promise<{ posted: boolean }> {
  const { data, error } = await client.rpc(rpc, args);
  if (error) throw new Error(`${label} failed: ${error.message}`);
  return { posted: posted(data) };
}

export function recordShadowEntitlementItem(
  item: ShadowEntitlementItem,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean }> {
  return postShadowFact(
    client,
    "record_billing_entitlement_item",
    {
      p_account: item.accountId,
      p_item_ref: item.itemRef,
      p_item_kind: item.itemKind,
      p_price_lookup_key: item.priceLookupKey,
      p_quantity: item.quantity,
      p_concurrency_delta: item.concurrencyDelta,
      p_retained_data_bytes_delta: databaseInteger(item.retainedDataBytesDelta),
      p_hosted_usage_cents_delta: databaseInteger(item.hostedUsageCentsDelta),
      p_effective_at: item.effectiveAt.toISOString(),
      p_source_event_id: item.sourceEventId,
      p_metadata: item.metadata ?? {},
    },
    "shadow entitlement item"
  );
}

export function recordShadowProviderCost(
  event: ShadowProviderCostEvent,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean }> {
  const accountId = "accountId" in event.owner ? event.owner.accountId : null;
  const sharedOverheadCategory =
    "sharedOverheadCategory" in event.owner
      ? event.owner.sharedOverheadCategory
      : null;
  return postShadowFact(
    client,
    "record_billing_provider_cost_event",
    {
      p_provider: event.provider,
      p_provider_event_id: event.providerEventId,
      p_cost_source: event.costSource,
      p_account: accountId,
      p_shared_overhead_category: sharedOverheadCategory,
      p_provider_cost_micros: databaseInteger(event.providerCostMicros),
      p_provider_currency: event.providerCurrency ?? "USD",
      p_normalized_cost_micros: databaseInteger(event.normalizedCostMicros),
      p_retail_debit_micros: databaseInteger(event.retailDebitMicros),
      p_billing_treatment: event.billingTreatment,
      p_pricing_rule_version: event.pricingRuleVersion,
      p_measured_quantity: event.measuredQuantity ?? null,
      p_measured_unit: event.measuredUnit ?? null,
      p_occurred_at: event.occurredAt.toISOString(),
      p_refs: event.refs ?? {},
      p_metadata: event.metadata ?? {},
    },
    "shadow provider cost"
  );
}
