import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  capacityAnnualGrantScheduleInput,
  reconcileCapacityAnnualGrantSchedule,
} from "@/lib/billing/capacity-annual-grants";
import { findIndividualCapacityPrice } from "@/lib/billing/capacity-catalog";
import {
  applyCapacityEntitlementSnapshot,
  buildCapacityEntitlementSnapshot,
  type CapacityEntitlementProjectionResult,
} from "@/lib/billing/capacity-entitlement-webhooks";
import type {
  BillingPeriodGrant,
  IncludedCreditExpiry,
  LedgerEntry,
} from "@/lib/billing/ledger";

export type CapacityStripeWebhookDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  applyCapacityEntitlementSnapshot: typeof applyCapacityEntitlementSnapshot;
  postLedgerEntry: (entry: LedgerEntry) => Promise<{ posted: boolean }>;
  postBillingPeriodGrant: (
    grant: BillingPeriodGrant
  ) => Promise<{ posted: boolean; expiredCents: number }>;
  expireIncludedCredit: (expiry: IncludedCreditExpiry) => Promise<number>;
  updateAccount: (
    id: string,
    updates: {
      status?: BillingAccount["status"];
      stripe_subscription_id?: string | null;
    }
  ) => Promise<void>;
  reconcileCapacityAnnualGrantSchedule: typeof reconcileCapacityAnnualGrantSchedule;
};

function stripeEventDate(created: number): Date {
  if (!Number.isSafeInteger(created) || created <= 0) {
    throw new TypeError("Stripe event is missing a valid created timestamp");
  }
  return new Date(created * 1_000);
}

function priorCapacityIncludedUsage(account: BillingAccount): number {
  const value = Number(account.included_hosted_usage_cents ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("billing account has invalid included hosted usage");
  }
  return value;
}

function hasIndividualCapacityPlan(account: BillingAccount): boolean {
  return (
    account.plan_code === "pro" ||
    account.plan_code === "plus" ||
    account.plan_code === "max"
  );
}

function stripeObjectId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function requireCapacityOperations(deps: CapacityStripeWebhookDeps) {
  if (!deps.capacityBillingOperationsEnabled()) {
    throw new Error("Capacity billing operations are disabled");
  }
}

function shouldContinueAfterProjection(
  result: CapacityEntitlementProjectionResult,
  eventId: string
): boolean {
  if (result.stale) {
    console.warn(`[stripe-webhook] ignored stale capacity event ${eventId}`);
    return false;
  }
  if (!result.applied && !result.duplicate) {
    throw new Error("capacity entitlement projection returned no disposition");
  }
  if (result.duplicate) {
    // Continue idempotent ledger work so a retry can recover from a crash that
    // happened after the projection but before the grant or expiry completed.
    console.info(`[stripe-webhook] resuming capacity event ${eventId}`);
  }
  return true;
}

async function reconcilePaidCapacityAnnualGrant(input: {
  accountId: string;
  subscription: Stripe.Subscription;
  projection: CapacityEntitlementProjectionResult;
  priceLookupKey: string;
  includedUsageCents: number;
  eventId: string;
  eventCreated: number;
  deps: CapacityStripeWebhookDeps;
}) {
  const resolvedPrice = findIndividualCapacityPrice(input.priceLookupKey);
  if (!resolvedPrice) {
    throw new TypeError(`unknown capacity plan ${input.priceLookupKey}`);
  }
  const annualSchedule =
    resolvedPrice.price.interval === "year"
      ? capacityAnnualGrantScheduleInput({
          accountId: input.accountId,
          subscription: input.subscription,
          entitlementVersion: input.projection.entitlementVersion,
          priceLookupKey: input.priceLookupKey,
          includedUsageCents: input.includedUsageCents,
          sourceEventId: input.eventId,
          eventCreatedAt: stripeEventDate(input.eventCreated),
        })
      : null;
  await input.deps.reconcileCapacityAnnualGrantSchedule({
    accountId: input.accountId,
    keepEntitlementVersion: annualSchedule
      ? input.projection.entitlementVersion
      : null,
    desired: annualSchedule,
  });
}

export async function handleCapacityInvoicePaidIfApplicable(input: {
  account: BillingAccount;
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  eventId: string;
  eventCreated: number;
  deps: CapacityStripeWebhookDeps;
}): Promise<boolean> {
  const { account, invoice, subscription, deps } = input;
  const snapshot = buildCapacityEntitlementSnapshot({
    subscription,
    forceCapacity: hasIndividualCapacityPlan(account),
  });
  if (!snapshot) return false;
  requireCapacityOperations(deps);
  if (snapshot.cancellation) {
    // A delayed paid-invoice event can arrive after the subscription has
    // already been canceled. The deletion event owns the closing projection.
    return true;
  }
  const latestInvoiceId = stripeObjectId(subscription.latest_invoice);
  if (!latestInvoiceId) {
    throw new TypeError("capacity subscription is missing its latest invoice");
  }
  if (latestInvoiceId !== invoice.id) {
    // Never let an older paid invoice authorize a newer subscription state.
    return true;
  }
  if (!snapshot.plan) {
    throw new TypeError("a paid capacity invoice must contain an active plan");
  }
  const projection = await deps.applyCapacityEntitlementSnapshot({
    accountId: account.id,
    sourceEventId: input.eventId,
    effectiveAt: stripeEventDate(input.eventCreated),
    snapshot,
  });
  if (!shouldContinueAfterProjection(projection, input.eventId)) return true;

  const period = snapshot.plan.periodAnchor.slice(0, 7);
  const grant = await deps.postBillingPeriodGrant({
    accountId: account.id,
    deltaCents: snapshot.plan.hostedUsageCents,
    grantSourceRef: `grant:${account.id}:${period}:${snapshot.subscriptionId}`,
    expirySourceRef: `grantexp:${account.id}:${period}:${snapshot.subscriptionId}`,
    period,
    metadata: {
      invoice: invoice.id,
      plan: snapshot.plan.priceLookupKey,
      catalog: snapshot.catalogVersion,
    },
  });
  const priorIncludedUsageCents = priorCapacityIncludedUsage(account);
  if (
    !grant.posted &&
    snapshot.plan.hostedUsageCents > priorIncludedUsageCents
  ) {
    await deps.postLedgerEntry({
      accountId: account.id,
      deltaCents: snapshot.plan.hostedUsageCents - priorIncludedUsageCents,
      bucket: "included",
      kind: "grant_adjustment",
      sourceRef: `grantadj:${account.id}:${snapshot.subscriptionId}:${period}:${snapshot.plan.priceLookupKey}`,
      period,
      metadata: {
        invoice: invoice.id,
        plan: snapshot.plan.priceLookupKey,
        catalog: snapshot.catalogVersion,
      },
    });
  }
  if (account.status !== "frozen_topups") {
    await deps.updateAccount(account.id, { status: "active" });
  }
  await reconcilePaidCapacityAnnualGrant({
    accountId: account.id,
    subscription,
    projection,
    priceLookupKey: snapshot.plan.priceLookupKey,
    includedUsageCents: snapshot.plan.hostedUsageCents,
    eventId: input.eventId,
    eventCreated: input.eventCreated,
    deps,
  });
  return true;
}

export async function handleCapacitySubscriptionIfApplicable(input: {
  account: BillingAccount;
  subscription: Stripe.Subscription;
  eventId: string;
  eventCreated: number;
  deps: CapacityStripeWebhookDeps;
}): Promise<boolean> {
  const { account, subscription, deps } = input;
  const snapshot = buildCapacityEntitlementSnapshot({
    subscription,
    forceCapacity: hasIndividualCapacityPlan(account),
  });
  if (!snapshot) return false;
  requireCapacityOperations(deps);
  if (subscription.status !== "canceled") {
    // Paid invoices own capacity changes. Keeping subscription.updated as a
    // reference-only event prevents an incomplete proration from granting
    // capacity before payment succeeds.
    await deps.updateAccount(account.id, {
      stripe_subscription_id: subscription.id,
    });
    return true;
  }
  const projection = await deps.applyCapacityEntitlementSnapshot({
    accountId: account.id,
    sourceEventId: input.eventId,
    effectiveAt: stripeEventDate(input.eventCreated),
    snapshot,
  });
  if (!shouldContinueAfterProjection(projection, input.eventId)) return true;
  await deps.expireIncludedCredit({
    accountId: account.id,
    sourceRef: `grantexp:${account.id}:cancel:${subscription.id}`,
  });
  await deps.updateAccount(account.id, {
    stripe_subscription_id: null,
    ...(account.status === "frozen_topups"
      ? {}
      : { status: "active" as const }),
  });
  await deps.reconcileCapacityAnnualGrantSchedule({
    accountId: account.id,
    keepEntitlementVersion: null,
    desired: null,
  });
  return true;
}
