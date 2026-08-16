import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAPACITY_CATALOG_VERSION,
  findCapacityAddOn,
  findIndividualCapacityPrice,
  type IndividualCapacityPlanCode,
} from "@/lib/billing/capacity-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type CapacityEntitlementSnapshotItem = {
  itemRef: string;
  itemKind: "plan" | "concurrency_addon" | "retained_data_addon";
  priceLookupKey: string;
  quantity: number;
  concurrencyDelta: number;
  retainedDataBytesDelta: number;
  hostedUsageCentsDelta: number;
};

export type CapacityEntitlementSnapshot = {
  catalogVersion: typeof CAPACITY_CATALOG_VERSION;
  subscriptionId: string;
  cancellation: boolean;
  plan: null | {
    code: IndividualCapacityPlanCode;
    priceLookupKey: string;
    maxNamedUsers: 1;
    concurrency: number;
    retainedDataBytes: number;
    hostedUsageCents: number;
    periodAnchor: string;
  };
  items: CapacityEntitlementSnapshotItem[];
};

export type CapacityEntitlementProjectionResult = {
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  entitlementVersion: number;
};

type CapacitySubscriptionItem = {
  stripeItem: Stripe.SubscriptionItem;
  lookupKey: string;
  quantity: number;
};

function subscriptionQuantity(item: Stripe.SubscriptionItem): number {
  const quantity = item.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError(`invalid quantity for Stripe item ${item.id}`);
  }
  return quantity;
}

function periodAnchor(item: Stripe.SubscriptionItem): string {
  if (
    !Number.isSafeInteger(item.current_period_start) ||
    item.current_period_start <= 0
  ) {
    throw new TypeError(
      `Stripe item ${item.id} is missing current_period_start`
    );
  }
  return new Date(item.current_period_start * 1_000).toISOString().slice(0, 10);
}

function classifiedItems(subscription: Stripe.Subscription): {
  plans: CapacitySubscriptionItem[];
  addOns: CapacitySubscriptionItem[];
  unknown: string[];
} {
  const plans: CapacitySubscriptionItem[] = [];
  const addOns: CapacitySubscriptionItem[] = [];
  const unknown: string[] = [];
  for (const stripeItem of subscription.items.data) {
    const lookupKey = stripeItem.price.lookup_key;
    if (!lookupKey) {
      unknown.push(`price:${stripeItem.price.id}`);
      continue;
    }
    const item = {
      stripeItem,
      lookupKey,
      quantity: subscriptionQuantity(stripeItem),
    };
    if (findIndividualCapacityPrice(lookupKey)) {
      plans.push(item);
      continue;
    }
    if (findCapacityAddOn(lookupKey)) {
      addOns.push(item);
      continue;
    }
    if (lookupKey.startsWith(`${CAPACITY_CATALOG_VERSION}_`)) {
      throw new TypeError(`unknown capacity price ${lookupKey}`);
    }
    unknown.push(lookupKey);
  }
  return { plans, addOns, unknown };
}

type ClassifiedCapacityItems = ReturnType<typeof classifiedItems>;

function assertNoUnknownPrices(
  subscription: Stripe.Subscription,
  classified: ClassifiedCapacityItems,
  capacitySubscription: boolean
) {
  if (!capacitySubscription || classified.unknown.length === 0) return;
  throw new TypeError(
    `capacity subscription ${subscription.id} contains unknown prices: ${classified.unknown.join(
      ", "
    )}`
  );
}

function resolvePlanItem(
  subscription: Stripe.Subscription,
  classified: ClassifiedCapacityItems
) {
  if (classified.plans.length !== 1) {
    throw new TypeError(
      `capacity subscription ${subscription.id} must contain exactly one plan`
    );
  }
  const planItem = classified.plans[0]!;
  if (planItem.quantity !== 1) {
    throw new RangeError("individual capacity plan quantity must be 1");
  }
  const resolvedPlan = findIndividualCapacityPrice(planItem.lookupKey);
  if (!resolvedPlan) {
    throw new TypeError(`unknown capacity plan ${planItem.lookupKey}`);
  }
  return { planItem, plan: resolvedPlan.plan };
}

function snapshotItems(input: {
  subscription: Stripe.Subscription;
  planItem: CapacitySubscriptionItem;
  plan: ReturnType<typeof resolvePlanItem>["plan"];
  addOns: CapacitySubscriptionItem[];
}): CapacityEntitlementSnapshotItem[] {
  const { subscription, planItem, plan } = input;
  const items: CapacityEntitlementSnapshotItem[] = [
    {
      itemRef: planItem.stripeItem.id,
      itemKind: "plan",
      priceLookupKey: planItem.lookupKey,
      quantity: 1,
      concurrencyDelta: plan.concurrency,
      retainedDataBytesDelta: plan.retainedDataBytes,
      hostedUsageCentsDelta: plan.hostedUsageCents,
    },
  ];
  for (const item of input.addOns) {
    const addOn = findCapacityAddOn(item.lookupKey);
    if (!addOn)
      throw new TypeError(`unknown capacity add-on ${item.lookupKey}`);
    items.push({
      itemRef: item.stripeItem.id,
      itemKind:
        addOn.kind === "concurrency"
          ? "concurrency_addon"
          : "retained_data_addon",
      priceLookupKey: item.lookupKey,
      quantity: item.quantity,
      concurrencyDelta: addOn.concurrencyDelta,
      retainedDataBytesDelta: addOn.retainedDataBytesDelta,
      hostedUsageCentsDelta: 0,
    });
  }
  const itemRefs = new Set(items.map((item) => item.itemRef));
  if (itemRefs.size !== items.length) {
    throw new TypeError(
      `capacity subscription ${subscription.id} contains duplicate item ids`
    );
  }
  return items;
}

export function buildCapacityEntitlementSnapshot(input: {
  subscription: Stripe.Subscription;
  forceCapacity?: boolean;
}): CapacityEntitlementSnapshot | null {
  const { subscription } = input;
  const classified = classifiedItems(subscription);
  const recognized =
    classified.plans.length > 0 || classified.addOns.length > 0;
  const capacitySubscription = recognized || input.forceCapacity === true;
  const cancellation = subscription.status === "canceled";

  assertNoUnknownPrices(subscription, classified, capacitySubscription);
  if (cancellation && capacitySubscription) {
    return {
      catalogVersion: CAPACITY_CATALOG_VERSION,
      subscriptionId: subscription.id,
      cancellation: true,
      plan: null,
      items: [],
    };
  }
  if (!recognized) return null;
  const { planItem, plan } = resolvePlanItem(subscription, classified);
  const items = snapshotItems({
    subscription,
    planItem,
    plan,
    addOns: classified.addOns,
  });

  return {
    catalogVersion: CAPACITY_CATALOG_VERSION,
    subscriptionId: subscription.id,
    cancellation: false,
    plan: {
      code: plan.code,
      priceLookupKey: planItem.lookupKey,
      maxNamedUsers: plan.maxNamedUsers,
      concurrency: plan.concurrency,
      retainedDataBytes: plan.retainedDataBytes,
      hostedUsageCents: plan.hostedUsageCents,
      periodAnchor: periodAnchor(planItem.stripeItem),
    },
    items,
  };
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} returned an invalid boolean`);
  }
  return value;
}

function versionValue(value: unknown): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError(
      "capacity entitlement projection returned an invalid version"
    );
  }
  return version;
}

export async function applyCapacityEntitlementSnapshot(input: {
  accountId: string;
  sourceEventId: string;
  effectiveAt: Date;
  snapshot: CapacityEntitlementSnapshot;
  client?: SupabaseClient;
}): Promise<CapacityEntitlementProjectionResult> {
  const client = input.client ?? supabaseAdmin;
  const { data, error } = await client.rpc(
    "apply_billing_capacity_entitlement_snapshot",
    {
      p_account: input.accountId,
      p_subscription_id: input.snapshot.subscriptionId,
      p_source_event_id: input.sourceEventId,
      p_effective_at: input.effectiveAt.toISOString(),
      p_snapshot: input.snapshot,
    }
  );
  if (error) {
    throw new Error(`capacity entitlement projection failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;
  if (!row) {
    throw new Error("capacity entitlement projection returned no result");
  }
  return {
    applied: booleanValue(row.applied, "capacity projection applied"),
    duplicate: booleanValue(row.duplicate, "capacity projection duplicate"),
    stale: booleanValue(row.stale, "capacity projection stale"),
    entitlementVersion: versionValue(row.entitlement_version),
  };
}
