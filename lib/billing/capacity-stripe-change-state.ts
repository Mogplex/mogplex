import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  findCapacityAddOn,
  findIndividualCapacityPrice,
  type CapacityAddOn,
  type IndividualCapacityPlan,
} from "@/lib/billing/capacity-catalog";

export class CapacityChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "CapacityChangeError";
  }
}

type SubscriptionItem = Stripe.SubscriptionItem;

export type ResolvedSubscription = {
  subscription: Stripe.Subscription;
  plan: IndividualCapacityPlan;
  targetAddOn: CapacityAddOn;
  targetItem: SubscriptionItem | null;
  currentQuantity: number;
  currentAllowance: bigint;
};

type ClassifiedPlanItem = {
  item: SubscriptionItem;
  plan: IndividualCapacityPlan;
};

type ClassifiedAddOnItem = {
  item: SubscriptionItem;
  addOn: CapacityAddOn;
  itemQuantity: number;
};

function quantity(item: SubscriptionItem): number {
  const value = item.quantity ?? 1;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CapacityChangeError(
      "The Stripe subscription has an invalid capacity quantity",
      409,
      "invalid_subscription"
    );
  }
  return value;
}

function customerId(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  if (typeof customer === "string") return customer;
  return customer.deleted ? null : customer.id;
}

function classifiedItem(
  item: SubscriptionItem
): ClassifiedPlanItem | ClassifiedAddOnItem {
  const lookup = item.price.lookup_key;
  if (!lookup) {
    throw new CapacityChangeError(
      "The Stripe subscription contains a price without a catalog key",
      409,
      "invalid_subscription"
    );
  }
  const plan = findIndividualCapacityPrice(lookup)?.plan;
  if (plan) return { item, plan };
  const addOn = findCapacityAddOn(lookup);
  if (addOn) return { item, addOn, itemQuantity: quantity(item) };
  throw new CapacityChangeError(
    `The Stripe subscription contains unknown price ${lookup}`,
    409,
    "invalid_subscription"
  );
}

function classifySubscriptionItems(subscription: Stripe.Subscription): {
  plans: ClassifiedPlanItem[];
  addOns: ClassifiedAddOnItem[];
} {
  const plans: ClassifiedPlanItem[] = [];
  const addOns: ClassifiedAddOnItem[] = [];
  const seen = new Set<string>();
  for (const item of subscription.items.data) {
    const lookup = item.price.lookup_key;
    if (lookup && seen.has(lookup)) {
      throw new CapacityChangeError(
        `The Stripe subscription contains duplicate price ${lookup}`,
        409,
        "invalid_subscription"
      );
    }
    if (lookup) seen.add(lookup);
    const classified = classifiedItem(item);
    if ("plan" in classified) plans.push(classified);
    else addOns.push(classified);
  }
  return { plans, addOns };
}

export function targetCapacityAddOn(lookupKey: string): CapacityAddOn {
  const addOn = findCapacityAddOn(lookupKey);
  if (addOn) return addOn;
  throw new CapacityChangeError(
    "Unknown capacity add-on",
    400,
    "unknown_add_on"
  );
}

function assertSubscriptionIdentity(input: {
  account: BillingAccount;
  subscription: Stripe.Subscription;
}) {
  if (
    input.subscription.id !== input.account.stripe_subscription_id ||
    customerId(input.subscription) !== input.account.stripe_customer_id
  ) {
    throw new CapacityChangeError(
      "The billing subscription does not match this account",
      409,
      "subscription_mismatch"
    );
  }
}

function assertSubscriptionCanChange(
  subscription: Stripe.Subscription,
  allowPendingUpdate: boolean
) {
  if (subscription.status !== "active") {
    throw new CapacityChangeError(
      "The billing subscription is not active",
      409,
      "subscription_inactive"
    );
  }
  if (subscription.pending_update && !allowPendingUpdate) {
    throw new CapacityChangeError(
      "Another capacity change is waiting for payment",
      409,
      "change_pending"
    );
  }
}

function resolvedPlan(input: {
  account: BillingAccount;
  plans: ClassifiedPlanItem[];
}): IndividualCapacityPlan {
  const entry = input.plans[0];
  if (input.plans.length !== 1 || !entry || quantity(entry.item) !== 1) {
    throw new CapacityChangeError(
      "The Stripe subscription must contain exactly one Individual plan",
      409,
      "invalid_subscription"
    );
  }
  if (entry.plan.code !== input.account.plan_code) {
    throw new CapacityChangeError(
      "The Stripe plan does not match this billing account",
      409,
      "subscription_mismatch"
    );
  }
  return entry.plan;
}

export function addOnAllowance(addOn: CapacityAddOn, count: number): bigint {
  const delta =
    addOn.kind === "concurrency"
      ? addOn.concurrencyDelta
      : addOn.retainedDataBytesDelta;
  return BigInt(delta) * BigInt(count);
}

function planAllowance(plan: IndividualCapacityPlan, addOn: CapacityAddOn) {
  return BigInt(
    addOn.kind === "concurrency" ? plan.concurrency : plan.retainedDataBytes
  );
}

export function assertAccountCanChangeCapacity(account: BillingAccount) {
  if (
    account.owner_type !== "user" ||
    (account.plan_code !== "pro" &&
      account.plan_code !== "plus" &&
      account.plan_code !== "max")
  ) {
    throw new CapacityChangeError(
      "Capacity add-ons are available for Individual plans. Contact sales for a company contract.",
      409,
      "self_service_unavailable"
    );
  }
  if (account.status !== "active") {
    throw new CapacityChangeError(
      "Capacity changes are unavailable until the billing account is active",
      409,
      "account_inactive"
    );
  }
  if (!account.stripe_customer_id || !account.stripe_subscription_id) {
    throw new CapacityChangeError(
      "An active Individual subscription is required",
      409,
      "subscription_required"
    );
  }
}

export function resolveCapacitySubscription(input: {
  account: BillingAccount;
  subscription: Stripe.Subscription;
  lookupKey: string;
  allowPendingUpdate?: boolean;
}): ResolvedSubscription {
  const { account, subscription, lookupKey } = input;
  const targetAddOn = targetCapacityAddOn(lookupKey);
  assertSubscriptionIdentity({ account, subscription });
  assertSubscriptionCanChange(subscription, input.allowPendingUpdate === true);
  const classified = classifySubscriptionItems(subscription);
  const plan = resolvedPlan({ account, plans: classified.plans });
  const target = classified.addOns.find(
    (entry) => entry.addOn.lookupKey === lookupKey
  );
  // The TypeScript target predates bigint literal syntax.
  // eslint-disable-next-line unicorn/prefer-bigint-literals
  let currentAllowance = BigInt(0);
  for (const entry of classified.addOns) {
    if (entry.addOn.kind === targetAddOn.kind) {
      currentAllowance += addOnAllowance(entry.addOn, entry.itemQuantity);
    }
  }
  currentAllowance += planAllowance(plan, targetAddOn);
  return {
    subscription,
    plan,
    targetAddOn,
    targetItem: target?.item ?? null,
    currentQuantity: target?.itemQuantity ?? 0,
    currentAllowance,
  };
}

export function assertCanonicalTargetPrice(
  resolved: ResolvedSubscription,
  priceId: string
) {
  if (resolved.targetItem && resolved.targetItem.price.id !== priceId) {
    throw new CapacityChangeError(
      "The subscription item does not match the canonical capacity price",
      409,
      "catalog_mismatch"
    );
  }
}
