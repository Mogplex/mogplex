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

export type ShadowCostReservation = {
  accountId: string;
  reservationRef: string;
  sourceRef: string;
  operationRef: string;
  rootWorkflowRef?: string;
  reservedMicros: bigint;
  basis: Record<string, unknown>;
  basisVersion: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
};

export type ShadowReservationDecision = {
  posted: boolean;
  wouldAdmit: boolean;
  balanceMicros: bigint;
  openReservedMicros: bigint;
  spendableMicros: bigint;
};

export type ShadowReservationTerminal = {
  reservationRef: string;
  terminalKind: "settled" | "released" | "expired";
  consumedMicros: bigint;
  sourceRef: string;
  terminalAt: Date;
  metadata?: Record<string, unknown>;
};

export type ShadowCapacityLease = {
  accountId: string;
  leaseRef: string;
  sourceRef: string;
  rootWorkflowRef: string;
  acquiredAt: Date;
  metadata?: Record<string, unknown>;
};

export type ShadowCapacityDecision = {
  posted: boolean;
  wouldAdmit: boolean;
  activeBefore: number;
  concurrencyLimit: number;
};

export type ShadowCapacityRelease = {
  leaseRef: string;
  terminalOutcome:
    | "success"
    | "failure"
    | "cancelled"
    | "timeout"
    | "operator_repair";
  sourceRef: string;
  releasedAt: Date;
  metadata?: Record<string, unknown>;
};

export type RetainedDataResourceType =
  | "workflow_history"
  | "node_run_history"
  | "job_run_history"
  | "ai_call_history"
  | "automation_dispatch_history"
  | "logs_events"
  | "review_finding"
  | "generated_artifact"
  | "customer_upload"
  | "sandbox_snapshot";

export type ShadowRetainedDataEvent = {
  accountId: string;
  resourceType: RetainedDataResourceType;
  resourceRef: string;
  deltaBytes: bigint;
  sourceRef: string;
  operationRef?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
};

export type ShadowRetainedDataDecision = {
  posted: boolean;
  wouldAdmit: boolean;
  logicalBytes: bigint;
  retainedLimitBytes: bigint;
};

function databaseInteger(value: bigint): string {
  return value.toString();
}

function posted(data: unknown): boolean {
  return data === true;
}

function databaseBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new TypeError(`${label} returned an invalid integer`);
  }
}

function databaseSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  return parsed;
}

function databaseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} returned an invalid boolean`);
  }
  return value;
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

async function postShadowRow(
  client: SupabaseClient,
  rpc: string,
  args: Record<string, unknown>,
  label: string
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(rpc, args);
  if (error) throw new Error(`${label} failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;
  if (!row || typeof row !== "object") {
    throw new Error(`${label} failed: database returned no result`);
  }
  return row;
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

export async function recordShadowCostReservation(
  reservation: ShadowCostReservation,
  client: SupabaseClient = supabaseAdmin
): Promise<ShadowReservationDecision> {
  const row = await postShadowRow(
    client,
    "record_billing_shadow_reservation",
    {
      p_account: reservation.accountId,
      p_reservation_ref: reservation.reservationRef,
      p_source_ref: reservation.sourceRef,
      p_operation_ref: reservation.operationRef,
      p_root_workflow_ref: reservation.rootWorkflowRef ?? null,
      p_reserved_micros: databaseInteger(reservation.reservedMicros),
      p_basis: reservation.basis,
      p_basis_version: reservation.basisVersion,
      p_expires_at: reservation.expiresAt.toISOString(),
      p_metadata: reservation.metadata ?? {},
    },
    "shadow cost reservation"
  );
  return {
    posted: databaseBoolean(row.posted, "shadow reservation posted"),
    wouldAdmit: databaseBoolean(row.would_admit, "shadow reservation decision"),
    balanceMicros: databaseBigInt(row.balance_micros, "shadow balance"),
    openReservedMicros: databaseBigInt(
      row.open_reserved_micros,
      "shadow open reservations"
    ),
    spendableMicros: databaseBigInt(
      row.spendable_micros,
      "shadow spendable balance"
    ),
  };
}

export function recordShadowReservationTerminal(
  terminal: ShadowReservationTerminal,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean }> {
  return postShadowFact(
    client,
    "record_billing_reservation_terminal",
    {
      p_reservation_ref: terminal.reservationRef,
      p_terminal_kind: terminal.terminalKind,
      p_consumed_micros: databaseInteger(terminal.consumedMicros),
      p_source_ref: terminal.sourceRef,
      p_terminal_at: terminal.terminalAt.toISOString(),
      p_metadata: terminal.metadata ?? {},
    },
    "shadow reservation terminal"
  );
}

export async function recordShadowCapacityLease(
  lease: ShadowCapacityLease,
  client: SupabaseClient = supabaseAdmin
): Promise<ShadowCapacityDecision> {
  const row = await postShadowRow(
    client,
    "record_billing_shadow_capacity_lease",
    {
      p_account: lease.accountId,
      p_lease_ref: lease.leaseRef,
      p_source_ref: lease.sourceRef,
      p_root_workflow_ref: lease.rootWorkflowRef,
      p_acquired_at: lease.acquiredAt.toISOString(),
      p_metadata: lease.metadata ?? {},
    },
    "shadow capacity lease"
  );
  return {
    posted: databaseBoolean(row.posted, "shadow capacity lease posted"),
    wouldAdmit: databaseBoolean(row.would_admit, "shadow capacity decision"),
    activeBefore: databaseSafeInteger(
      row.active_before,
      "shadow active concurrency"
    ),
    concurrencyLimit: databaseSafeInteger(
      row.concurrency_limit,
      "shadow concurrency limit"
    ),
  };
}

export function recordShadowCapacityRelease(
  release: ShadowCapacityRelease,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean }> {
  return postShadowFact(
    client,
    "record_billing_capacity_release",
    {
      p_lease_ref: release.leaseRef,
      p_terminal_outcome: release.terminalOutcome,
      p_source_ref: release.sourceRef,
      p_released_at: release.releasedAt.toISOString(),
      p_metadata: release.metadata ?? {},
    },
    "shadow capacity release"
  );
}

export async function recordShadowRetainedData(
  event: ShadowRetainedDataEvent,
  client: SupabaseClient = supabaseAdmin
): Promise<ShadowRetainedDataDecision> {
  const row = await postShadowRow(
    client,
    "record_billing_shadow_retained_data_event",
    {
      p_account: event.accountId,
      p_resource_type: event.resourceType,
      p_resource_ref: event.resourceRef,
      p_delta_bytes: databaseInteger(event.deltaBytes),
      p_source_ref: event.sourceRef,
      p_operation_ref: event.operationRef ?? null,
      p_occurred_at: event.occurredAt.toISOString(),
      p_metadata: event.metadata ?? {},
    },
    "shadow retained data"
  );
  return {
    posted: databaseBoolean(row.posted, "shadow retained data posted"),
    wouldAdmit: databaseBoolean(
      row.would_admit,
      "shadow retained-data decision"
    ),
    logicalBytes: databaseBigInt(
      row.logical_bytes,
      "shadow logical retained bytes"
    ),
    retainedLimitBytes: databaseBigInt(
      row.retained_limit_bytes,
      "shadow retained-data limit"
    ),
  };
}
