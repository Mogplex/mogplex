import type {
  CapacityAddOnKind,
  CapacityPlanCode,
} from "@/lib/billing/capacity-catalog";
import type { BillingBalance } from "@/lib/billing/ledger";

export type CapacityBillingSummaryV2 = {
  version: "capacity_v2";
  asOf: string;
  billingOperationsEnabled: boolean;
  concurrencyPurchasesEnabled: boolean;
  account: {
    id: string;
    eventSequence: string;
    enforcementMode: "shadow" | "meter_only" | "enforced";
    scope: "personal" | "team";
    displayName: string;
    status: "active" | "past_due" | "read_only" | "frozen_purchases";
    canManageBilling: boolean;
    hasSubscription: boolean;
    hasBillingHistory: boolean;
  };
  plan: {
    ref: CapacityPlanCode | "legacy";
    name: string;
    offerKind: "individual" | "contract" | "legacy";
    interval: "month" | "year" | "contract";
    recurringAmountCents: number | null;
    renewsAt: string | null;
    cancelsAt: string | null;
    namedUserLimit: number | null;
  };
  concurrency: {
    active: number;
    included: number | null;
    addOn: number;
    limit: number | null;
    wouldBlock: boolean;
  };
  retainedData: {
    logicalBytes: string;
    includedBytes: string | null;
    addOnBytes: string;
    limitBytes: string | null;
    percentUsed: number | null;
    wouldBlock: boolean;
    overLimitAfterPendingChange: boolean;
  };
  hostedUsage: {
    includedRemainingCents: number;
    purchasedRemainingCents: number;
    openReservationsCents: number;
    spendableCents: number;
    grantResetsAt: string | null;
    purchasesFrozen: boolean;
  };
  addOns: CapacityBillingSummaryAddOn[];
  openReservations: CapacityBillingSummaryReservation[];
  recentCosts: CapacityBillingSummaryCost[];
};

export type CapacityBillingSummaryAddOn = {
  subscriptionItemId: string;
  lookupKey: string;
  kind: CapacityAddOnKind;
  name: string;
  quantity: number;
  allowanceDelta: string;
  recurringAmountCents: number;
  status:
    | "active"
    | "pending_increase"
    | "pending_decrease"
    | "cancels_at_period_end";
  effectiveAt: string;
};

export type CapacityBillingSummaryReservation = {
  id: string;
  operationKind: string;
  description: string;
  reservedCents: number;
  createdAt: string;
};

export type CapacityBillingCostCategory =
  | "ai"
  | "trigger"
  | "sandbox"
  | "vercel"
  | "email"
  | "storage_operation"
  | "transfer"
  | "other";

export type CapacityBillingSummaryCost = {
  operationId: string;
  description: string;
  status: "in_progress" | "settled" | "failed" | "cancelled";
  occurredAt: string;
  totalCents: number | null;
  items: Array<{
    category: CapacityBillingCostCategory;
    label: string;
    amountCents: number;
  }>;
};

export type CapacityBillingAccountProjection = {
  id: string;
  billing_event_sequence: number | string;
  owner_type: "user" | "team";
  tier: "free" | "pro" | "team" | "business";
  status: "active" | "past_due" | "frozen_topups";
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  period_anchor: string | null;
  plan_code: CapacityPlanCode | null;
  plan_audience: "legacy" | "individual" | "business" | "enterprise";
  max_named_users: number | string | null;
  included_concurrency: number | string;
  included_retained_bytes: number | string;
  entitlement_enforcement_mode: "shadow" | "meter_only" | "enforced";
};

export type CapacityBillingEntitlementRow = {
  id: number | string;
  item_ref: string;
  item_kind: "plan" | "concurrency_addon" | "retained_data_addon";
  price_lookup_key: string;
  quantity: number | string;
  effective_at: string;
  recorded_at: string;
};

export type CapacityBillingReservationRow = {
  reservation_ref: string;
  operation_ref: string;
  reserved_micros: number | string;
  created_at: string;
};

export type CapacityBillingCostOperationRow = {
  operation_ref: string;
  retail_debit_micros: number | string;
  occurred_at: string;
};

export type CapacityBillingCostItemRow = {
  operation_ref: string;
  cost_source: string;
  retail_debit_micros: number | string;
  occurred_at: string;
};

export type CapacityBillingFacts = {
  account: CapacityBillingAccountProjection;
  balance: BillingBalance;
  activeConcurrency: number;
  retainedLogicalBytes: number | string;
  entitlementItems: CapacityBillingEntitlementRow[];
  openReservations: CapacityBillingReservationRow[];
  costOperations: CapacityBillingCostOperationRow[];
  costItems: CapacityBillingCostItemRow[];
};
