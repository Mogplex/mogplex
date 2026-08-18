import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCapacityBillingSummary } from "@/lib/billing/capacity-summary";
import type {
  CapacityBillingAccountProjection,
  CapacityBillingCostItemRow,
  CapacityBillingCostOperationRow,
  CapacityBillingEntitlementRow,
  CapacityBillingReservationRow,
  CapacityBillingSummaryV2,
} from "@/lib/billing/capacity-summary-types";
import type { BillingBalance } from "@/lib/billing/ledger";

function queryError(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

function completeRows<Row>(
  label: string,
  data: Row[] | null,
  count: number | null,
  limit: number
): Row[] {
  if (count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} did not return an exact count`);
  }
  const rows = data ?? [];
  if (count !== rows.length || rows.length > limit) {
    throw new Error(`${label} exceeded its safe result limit`);
  }
  return rows;
}

const ENTITLEMENT_LIMIT = 500;
const OPEN_RESERVATION_LIMIT = 500;
const RECENT_OPERATION_LIMIT = 20;
const COST_ITEM_LIMIT = RECENT_OPERATION_LIMIT * 12;

export async function loadCapacityBillingSummary(input: {
  accountId: string;
  balance: BillingBalance;
  scope: "personal" | "team";
  canManageBilling: boolean;
  billingOperationsEnabled: boolean;
  concurrencyPurchasesEnabled?: boolean;
  asOf?: Date;
  client?: SupabaseClient;
}): Promise<CapacityBillingSummaryV2> {
  const client = input.client ?? supabaseAdmin;
  const [account, active, retained, entitlements, reservations, operations] =
    await Promise.all([
      client
        .from("billing_accounts")
        .select(
          "id, billing_event_sequence, owner_type, tier, status, period_anchor, stripe_customer_id, stripe_subscription_id, plan_code, plan_audience, max_named_users, included_concurrency, included_retained_bytes, entitlement_enforcement_mode"
        )
        .eq("id", input.accountId)
        .maybeSingle(),
      client
        .from("billing_active_workflow_capacity_leases")
        .select("id", { count: "exact", head: true })
        .eq("account_id", input.accountId),
      client
        .from("billing_retained_data_totals")
        .select("logical_bytes")
        .eq("account_id", input.accountId)
        .maybeSingle(),
      client
        .from("billing_entitlement_items")
        .select(
          "id, item_ref, item_kind, price_lookup_key, quantity, effective_at, recorded_at",
          { count: "exact" }
        )
        .eq("account_id", input.accountId)
        .order("effective_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(ENTITLEMENT_LIMIT),
      client
        .from("billing_open_cost_reservations")
        .select("reservation_ref, operation_ref, reserved_micros, created_at", {
          count: "exact",
        })
        .eq("account_id", input.accountId)
        .order("created_at", { ascending: false })
        .limit(OPEN_RESERVATION_LIMIT),
      client
        .from("billing_customer_retail_cost_operations")
        .select("operation_ref, retail_debit_micros, occurred_at, description")
        .eq("account_id", input.accountId)
        .order("occurred_at", { ascending: false })
        .limit(RECENT_OPERATION_LIMIT),
    ]);

  queryError("capacity billing account lookup", account.error);
  queryError("active Concurrency lookup", active.error);
  queryError("retained data lookup", retained.error);
  queryError("entitlement lookup", entitlements.error);
  queryError("reservation lookup", reservations.error);
  queryError("recent cost operation lookup", operations.error);
  if (!account.data) {
    throw new Error(`capacity billing account ${input.accountId} not found`);
  }
  const entitlementRows = completeRows(
    "capacity entitlement lookup",
    entitlements.data as CapacityBillingEntitlementRow[] | null,
    entitlements.count,
    ENTITLEMENT_LIMIT
  );
  const reservationRows = completeRows(
    "open reservation lookup",
    reservations.data as CapacityBillingReservationRow[] | null,
    reservations.count,
    OPEN_RESERVATION_LIMIT
  );
  const operationRows =
    (operations.data as CapacityBillingCostOperationRow[] | null) ?? [];
  const operationRefs = operationRows.map((row) => row.operation_ref);
  const costItems =
    operationRefs.length > 0
      ? await client
          .from("billing_customer_retail_cost_items")
          .select(
            "operation_ref, cost_source, retail_debit_micros, occurred_at",
            { count: "exact" }
          )
          .eq("account_id", input.accountId)
          .in("operation_ref", operationRefs)
          .limit(COST_ITEM_LIMIT)
      : { data: [], error: null, count: 0 };
  queryError("recent cost item lookup", costItems.error);
  const costItemRows = completeRows(
    "recent cost item lookup",
    costItems.data as CapacityBillingCostItemRow[] | null,
    costItems.count,
    COST_ITEM_LIMIT
  );

  return buildCapacityBillingSummary({
    facts: {
      account: account.data as CapacityBillingAccountProjection,
      balance: input.balance,
      activeConcurrency: active.count ?? 0,
      retainedLogicalBytes:
        (retained.data as { logical_bytes?: number | string } | null)
          ?.logical_bytes ?? 0,
      entitlementItems: entitlementRows,
      openReservations: reservationRows,
      costOperations: operationRows,
      costItems: costItemRows,
    },
    scope: input.scope,
    canManageBilling: input.canManageBilling,
    billingOperationsEnabled: input.billingOperationsEnabled,
    concurrencyPurchasesEnabled: input.concurrencyPurchasesEnabled,
    asOf: input.asOf,
  });
}
