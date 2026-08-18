import {
  CONTRACT_CAPACITY_PLANS,
  INDIVIDUAL_CAPACITY_PLANS,
  type CapacityPlanCode,
} from "@/lib/billing/capacity-catalog";
import type {
  CapacityBillingEntitlementRow,
  CapacityBillingFacts,
  CapacityBillingSummaryV2,
} from "@/lib/billing/capacity-summary-types";
import { summarizeCapacityAddOns } from "@/lib/billing/capacity-summary-add-ons";
import { summarizeCapacityCosts } from "@/lib/billing/capacity-summary-costs";

// The repository TypeScript target predates bigint literal syntax.
/* eslint-disable unicorn/prefer-bigint-literals */
const ZERO = BigInt(0);
const THOUSAND = BigInt(1_000);

function nonnegativeInteger(value: number | string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return parsed;
}

function addSafeInteger(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function nonnegativeBigInt(value: number | string, label: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < ZERO) {
      throw new TypeError(`${label} must be a nonnegative integer`);
    }
    return parsed;
  } catch {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
}

function asTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function orderedVersions(
  rows: CapacityBillingEntitlementRow[],
  predicate: (time: number) => boolean
): CapacityBillingEntitlementRow[] {
  return rows
    .filter((row) => predicate(asTime(row.effective_at, "effective_at")))
    .toSorted((left, right) => {
      const effective =
        asTime(left.effective_at, "effective_at") -
        asTime(right.effective_at, "effective_at");
      if (effective !== 0) return effective;
      const recorded =
        asTime(left.recorded_at, "recorded_at") -
        asTime(right.recorded_at, "recorded_at");
      if (recorded !== 0) return recorded;
      return (
        nonnegativeInteger(left.id, "entitlement id") -
        nonnegativeInteger(right.id, "entitlement id")
      );
    });
}

function currentVersion(
  rows: CapacityBillingEntitlementRow[],
  asOfTime: number
): CapacityBillingEntitlementRow | null {
  return orderedVersions(rows, (time) => time <= asOfTime).at(-1) ?? null;
}

function planPrice(planCode: CapacityPlanCode, lookupKey: string | null) {
  if (planCode === "business" || planCode === "enterprise") return null;
  const prices = INDIVIDUAL_CAPACITY_PLANS[planCode].prices;
  return (
    Object.values(prices).find((price) => price.lookupKey === lookupKey) ?? null
  );
}

function legacyPlanName(facts: CapacityBillingFacts): string {
  const { tier } = facts.account;
  if (tier === "free") return "Cloud";
  if (tier === "business") return "Mog Mode";
  return tier[0]!.toUpperCase() + tier.slice(1);
}

function legacyPlanPresentation(
  facts: CapacityBillingFacts,
  asOf: Date
): CapacityBillingSummaryV2["plan"] {
  return {
    ref: "legacy",
    name: legacyPlanName(facts),
    offerKind: "legacy",
    interval: "contract",
    recurringAmountCents: null,
    renewsAt: nextMonthlyAnchor(facts.account.period_anchor, asOf),
    cancelsAt: null,
    namedUserLimit: null,
  };
}

function namedUserLimit(facts: CapacityBillingFacts): number | null {
  const value = facts.account.max_named_users;
  if (value == null) return null;
  return nonnegativeInteger(value, "named user limit");
}

function contractPlanPresentation(
  facts: CapacityBillingFacts,
  asOf: Date,
  planCode: "business" | "enterprise"
): CapacityBillingSummaryV2["plan"] {
  return {
    ref: planCode,
    name: CONTRACT_CAPACITY_PLANS[planCode].name,
    offerKind: "contract",
    interval: "contract",
    recurringAmountCents: null,
    renewsAt: nextMonthlyAnchor(facts.account.period_anchor, asOf),
    cancelsAt: null,
    namedUserLimit: namedUserLimit(facts),
  };
}

function individualPlanPresentation(
  facts: CapacityBillingFacts,
  asOf: Date,
  planCode: "pro" | "plus" | "max"
): CapacityBillingSummaryV2["plan"] {
  const planRows = facts.entitlementItems.filter(
    (row) => row.item_kind === "plan"
  );
  const currentPlan = currentVersion(planRows, asOf.getTime());
  const price = planPrice(planCode, currentPlan?.price_lookup_key ?? null);
  return {
    ref: planCode,
    name: INDIVIDUAL_CAPACITY_PLANS[planCode].name,
    offerKind: "individual",
    interval: price?.interval ?? "month",
    recurringAmountCents: price?.amountCents ?? null,
    renewsAt: nextMonthlyAnchor(facts.account.period_anchor, asOf),
    cancelsAt: null,
    namedUserLimit: namedUserLimit(facts),
  };
}

function planPresentation(
  facts: CapacityBillingFacts,
  asOf: Date
): CapacityBillingSummaryV2["plan"] {
  const { account } = facts;
  if (!account.plan_code) return legacyPlanPresentation(facts, asOf);
  if (account.plan_code === "business" || account.plan_code === "enterprise") {
    return contractPlanPresentation(facts, asOf, account.plan_code);
  }
  return individualPlanPresentation(facts, asOf, account.plan_code);
}

function nextMonthlyAnchor(anchor: string | null, asOf: Date): string | null {
  if (!anchor) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) return null;
  const anchorYear = Number(match[1]);
  const anchorMonth = Number(match[2]);
  const day = Number(match[3]);
  const parsedAnchor = new Date(Date.UTC(anchorYear, anchorMonth - 1, day));
  if (
    parsedAnchor.getUTCFullYear() !== anchorYear ||
    parsedAnchor.getUTCMonth() !== anchorMonth - 1 ||
    parsedAnchor.getUTCDate() !== day
  ) {
    return null;
  }
  let year = asOf.getUTCFullYear();
  let month = asOf.getUTCMonth();
  for (let offset = 0; offset < 14; offset += 1) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidate = new Date(
      Date.UTC(year, month, Math.min(day, daysInMonth))
    );
    if (candidate > asOf) return candidate.toISOString();
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null;
}

function customerStatus(
  status: CapacityBillingFacts["account"]["status"]
): CapacityBillingSummaryV2["account"]["status"] {
  if (status === "frozen_topups") return "frozen_purchases";
  return status;
}

function enforcementMode(
  mode: CapacityBillingFacts["account"]["entitlement_enforcement_mode"]
): CapacityBillingSummaryV2["account"]["enforcementMode"] {
  if (mode === "shadow" || mode === "meter_only" || mode === "enforced") {
    return mode;
  }
  throw new TypeError("entitlement enforcement mode is invalid");
}

function resolvedBaseConcurrency(facts: CapacityBillingFacts): number | null {
  const { account } = facts;
  if (account.plan_audience === "legacy") return null;
  const value = nonnegativeInteger(
    account.included_concurrency,
    "included concurrency"
  );
  return account.plan_audience === "individual" || value > 0 ? value : null;
}

function resolvedBaseRetainedBytes(facts: CapacityBillingFacts): bigint | null {
  const { account } = facts;
  if (account.plan_audience === "legacy") return null;
  const value = nonnegativeBigInt(
    account.included_retained_bytes,
    "included retained bytes"
  );
  return account.plan_audience === "individual" || value > ZERO ? value : null;
}

function numberLimit(
  included: number | null,
  addOn: number,
  label: string
): number | null {
  if (included == null) return null;
  return addSafeInteger(included, addOn, label);
}

function byteLimit(included: bigint | null, addOn: bigint): bigint | null {
  if (included == null) return null;
  return included + addOn;
}

function isAtOrAbove(value: number, limit: number | null): boolean;
function isAtOrAbove(value: bigint, limit: bigint | null): boolean;
function isAtOrAbove(
  value: number | bigint,
  limit: number | bigint | null
): boolean {
  if (limit == null) return false;
  return value >= limit;
}

function percentUsed(value: bigint, limit: bigint | null): number | null {
  if (limit == null || limit === ZERO) return null;
  return Number((value * THOUSAND) / limit) / 10;
}

function scopeDisplayName(scope: "personal" | "team"): string {
  return scope === "personal" ? "Personal workspace" : "Team workspace";
}

export function buildCapacityBillingSummary(input: {
  facts: CapacityBillingFacts;
  scope: "personal" | "team";
  canManageBilling: boolean;
  billingOperationsEnabled: boolean;
  asOf?: Date;
}): CapacityBillingSummaryV2 {
  const asOf = input.asOf ?? new Date();
  const { facts } = input;
  const addOns = summarizeCapacityAddOns(facts.entitlementItems, asOf);
  const includedConcurrency = resolvedBaseConcurrency(facts);
  const concurrencyLimit = numberLimit(
    includedConcurrency,
    addOns.concurrency,
    "concurrency limit"
  );
  const includedRetainedBytes = resolvedBaseRetainedBytes(facts);
  const retainedLimit = byteLimit(includedRetainedBytes, addOns.retainedBytes);
  const retainedLogicalBytes = nonnegativeBigInt(
    facts.retainedLogicalBytes,
    "retained logical bytes"
  );
  const costs = summarizeCapacityCosts({
    reservations: facts.openReservations,
    costOperations: facts.costOperations,
    costItems: facts.costItems,
  });
  const activeConcurrency = nonnegativeInteger(
    facts.activeConcurrency,
    "active concurrency"
  );
  const nextRetainedLimit = byteLimit(
    includedRetainedBytes,
    addOns.pendingRetainedBytes
  );

  return {
    version: "capacity_v2",
    asOf: asOf.toISOString(),
    billingOperationsEnabled: input.billingOperationsEnabled,
    account: {
      id: facts.account.id,
      eventSequence: nonnegativeBigInt(
        facts.account.billing_event_sequence,
        "billing event sequence"
      ).toString(),
      enforcementMode: enforcementMode(
        facts.account.entitlement_enforcement_mode
      ),
      scope: input.scope,
      displayName: scopeDisplayName(input.scope),
      status: customerStatus(facts.account.status),
      canManageBilling: input.canManageBilling,
      hasSubscription: Boolean(facts.account.stripe_subscription_id),
      hasBillingHistory: Boolean(facts.account.stripe_customer_id),
    },
    plan: planPresentation(facts, asOf),
    concurrency: {
      active: activeConcurrency,
      included: includedConcurrency,
      addOn: addOns.concurrency,
      limit: concurrencyLimit,
      wouldBlock: isAtOrAbove(activeConcurrency, concurrencyLimit),
    },
    retainedData: {
      logicalBytes: retainedLogicalBytes.toString(),
      includedBytes: includedRetainedBytes?.toString() ?? null,
      addOnBytes: addOns.retainedBytes.toString(),
      limitBytes: retainedLimit?.toString() ?? null,
      percentUsed: percentUsed(retainedLogicalBytes, retainedLimit),
      wouldBlock: isAtOrAbove(retainedLogicalBytes, retainedLimit),
      overLimitAfterPendingChange:
        nextRetainedLimit == null
          ? false
          : retainedLogicalBytes > nextRetainedLimit,
    },
    hostedUsage: {
      includedRemainingCents: facts.balance.includedCents,
      purchasedRemainingCents: facts.balance.purchasedCents,
      openReservationsCents: costs.openReservationsCents,
      spendableCents: Math.max(
        0,
        facts.balance.totalCents - costs.openReservationsCents
      ),
      grantResetsAt: nextMonthlyAnchor(facts.account.period_anchor, asOf),
      purchasesFrozen: facts.account.status === "frozen_topups",
    },
    addOns: addOns.items,
    openReservations: costs.openReservations,
    recentCosts: costs.recentCosts,
  };
}
