import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
  isBillingEnabled,
} from "@/lib/billing/stripe";
import { findPlanPrice } from "@/lib/billing/catalog";
import {
  assertCapacityHostedUsagePayment,
  handleCapacityHostedUsagePaymentIfApplicable,
  stampedUsagePurchaseCents,
} from "@/lib/billing/capacity-hosted-usage-webhook";
import { reconcileCapacityAnnualGrantSchedule } from "@/lib/billing/capacity-annual-grants";
import { applyCapacityEntitlementSnapshot } from "@/lib/billing/capacity-entitlement-webhooks";
import {
  parseCapacityScheduleIntent,
  projectCapacityScheduleEvent,
  recordCapacityScheduleProjection,
} from "@/lib/billing/capacity-entitlement-schedules";
import {
  handleCapacityInvoicePaidIfApplicable,
  handleCapacitySubscriptionIfApplicable,
} from "@/lib/billing/capacity-stripe-webhook";
import {
  claimStripeEvent,
  markStripeEventProcessed,
} from "@/lib/billing/stripe-webhook-events";
import { handleLegacyInvoicePaid } from "@/lib/billing/legacy-stripe-webhook";
import {
  findBillingAccountById,
  findBillingAccountByStripeCustomer,
  updateBillingAccount,
  type BillingAccount,
} from "@/lib/billing/accounts";
import {
  expireIncludedCredit,
  postBillingPeriodGrant,
  postLedgerEntry,
  type IncludedCreditExpiry,
  type BillingPeriodGrant,
  type LedgerEntry,
} from "@/lib/billing/ledger";

// Single Stripe webhook endpoint (pricing-plan 02 §4): verify signature,
// claim event id in billing_events before processing, ack duplicates fast.

export type StripeWebhookDeps = {
  findAccountByCustomer: (customerId: string) => Promise<BillingAccount | null>;
  findAccountById: (id: string) => Promise<BillingAccount | null>;
  updateAccount: (
    id: string,
    updates: Parameters<typeof updateBillingAccount>[1]
  ) => Promise<void>;
  postLedgerEntry: (entry: LedgerEntry) => Promise<{ posted: boolean }>;
  postBillingPeriodGrant: (
    grant: BillingPeriodGrant
  ) => Promise<{ posted: boolean; expiredCents: number }>;
  expireIncludedCredit: (expiry: IncludedCreditExpiry) => Promise<number>;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  retrievePaymentIntent: (id: string) => Promise<Stripe.PaymentIntent>;
  listRefunds: (chargeId: string) => Promise<Stripe.Refund[]>;
  retrieveCharge: (id: string) => Promise<Stripe.Charge>;
  capacityBillingOperationsEnabled: () => boolean;
  applyCapacityEntitlementSnapshot: typeof applyCapacityEntitlementSnapshot;
  recordCapacityScheduleProjection: typeof recordCapacityScheduleProjection;
  reconcileCapacityAnnualGrantSchedule: typeof reconcileCapacityAnnualGrantSchedule;
};

function defaultDeps(): StripeWebhookDeps {
  return {
    findAccountByCustomer: findBillingAccountByStripeCustomer,
    findAccountById: findBillingAccountById,
    updateAccount: updateBillingAccount,
    postLedgerEntry,
    postBillingPeriodGrant,
    expireIncludedCredit,
    retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
    retrievePaymentIntent: (id) => getStripe().paymentIntents.retrieve(id),
    listRefunds: async (chargeId) =>
      (await getStripe().refunds.list({ charge: chargeId, limit: 100 })).data,
    retrieveCharge: (id) => getStripe().charges.retrieve(id),
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
    applyCapacityEntitlementSnapshot,
    recordCapacityScheduleProjection,
    reconcileCapacityAnnualGrantSchedule,
  };
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  deps: StripeWebhookDeps
) {
  // mode=payment top-ups credit on payment_intent.succeeded, never on
  // redirect/session completion.
  if (session.mode !== "subscription") return;
  const accountId = session.client_reference_id;
  const customerId = customerIdOf(session.customer);
  if (!accountId || !customerId) return;
  const account = await deps.findAccountById(accountId);
  // Customer creation is idempotent. This remains a backstop for a failed
  // DB linkage, but an old Checkout completion must never replace a current
  // customer link.
  if (!account || account.stripe_customer_id) return;
  await deps.updateAccount(account.id, { stripe_customer_id: customerId });
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  eventId: string,
  eventCreated: number,
  deps: StripeWebhookDeps
) {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;

  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
  if (!subscriptionId) return; // one-off invoice — nothing to grant

  const subscription = await deps.retrieveSubscription(subscriptionId);
  if (
    await handleCapacityInvoicePaidIfApplicable({
      account,
      invoice,
      subscription,
      eventId,
      eventCreated,
      deps,
    })
  ) {
    return;
  }
  // The legacy handler preserves the existing exact grant and same-period
  // upgrade behavior while capacity subscriptions use their separate path.
  await handleLegacyInvoicePaid({ account, invoice, subscription, deps });
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  eventCreated: number,
  deps: StripeWebhookDeps
) {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;
  const accountUpdatedAt = account.updated_at
    ? Date.parse(account.updated_at) / 1000
    : 0;
  if (accountUpdatedAt > eventCreated) return;
  // Smart Retries run on Stripe's side; tier persists through the period
  // (grace), drop-to-free happens via customer.subscription.deleted.
  if (account.status !== "frozen_topups") {
    await deps.updateAccount(account.id, { status: "past_due" });
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  deps: StripeWebhookDeps
) {
  if (
    await handleCapacityHostedUsagePaymentIfApplicable({
      paymentIntent,
      deps,
    })
  ) {
    return;
  }
  if (paymentIntent.metadata?.kind !== "topup") return;
  const accountId = paymentIntent.metadata.billing_account_id;
  if (!accountId) return;
  const account = await deps.findAccountById(accountId);
  if (!account) return;
  // credit_cents is the pre-tax top-up amount stamped at session creation;
  // amount_received includes automatic_tax, and collected tax must not
  // become spendable credit. Missing or invalid stamps fail closed.
  const creditCents = stampedUsagePurchaseCents(paymentIntent);
  await deps.postLedgerEntry({
    accountId: account.id,
    deltaCents: creditCents,
    bucket: "purchased",
    kind: "topup",
    sourceRef: `topup:${paymentIntent.id}`,
    metadata: {
      payment_intent: paymentIntent.id,
      amount_received: paymentIntent.amount_received,
    },
  });
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  eventId: string,
  eventCreated: number,
  deps: StripeWebhookDeps
) {
  const customerId = customerIdOf(subscription.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;

  if (
    await handleCapacitySubscriptionIfApplicable({
      account,
      subscription,
      eventId,
      eventCreated,
      deps,
    })
  ) {
    return;
  }

  if (subscription.status === "canceled") {
    // Drop to Free and expire subscription-included credit; purchased top-up
    // credit persists indefinitely. past_due clears — there is nothing left
    // to dun — but a dispute freeze survives until support lifts it. The RPC
    // also advances the subscription Checkout generation once per canceled
    // subscription so later sign-ups cannot replay its completed session.
    await deps.expireIncludedCredit({
      accountId: account.id,
      sourceRef: `grantexp:${account.id}:cancel:${subscription.id}`,
    });
    await deps.updateAccount(account.id, {
      tier: "free",
      stripe_subscription_id: null,
      ...(account.status === "frozen_topups"
        ? {}
        : { status: "active" as const }),
    });
    return;
  }
  const lookupKey = subscription.items.data[0]?.price.lookup_key;
  const plan = lookupKey ? findPlanPrice(lookupKey) : null;
  if (!plan) {
    throw new Error(
      `subscription ${subscription.id} references an unknown price`
    );
  }
  // invoice.paid is authoritative for paid tier changes and posts any grant
  // adjustment. Updating tier here can grant Team state before the prorated
  // invoice succeeds and loses the previous tier needed to calculate delta.
  await deps.updateAccount(account.id, {
    stripe_subscription_id: subscription.id,
  });
}

async function syncCapacitySchedule(
  schedule: Stripe.SubscriptionSchedule,
  eventId: string,
  eventCreated: number,
  deps: StripeWebhookDeps
) {
  const intent = parseCapacityScheduleIntent(schedule);
  if (!intent) return;
  if (!deps.capacityBillingOperationsEnabled()) {
    // Do not acknowledge a marked capacity event that we did not project.
    // The durable event claim stays unprocessed so an operator can replay it
    // after the test-mode operations gate is restored.
    throw new Error("Capacity billing operations are disabled");
  }
  const customerId = customerIdOf(schedule.customer);
  if (!customerId) throw new TypeError("capacity schedule has no customer");
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;
  const subscription = await deps.retrieveSubscription(intent.subscriptionId);
  await projectCapacityScheduleEvent({
    account,
    schedule,
    subscription,
    sourceEventId: eventId,
    eventCreated,
    recordProjection: deps.recordCapacityScheduleProjection,
  });
}

function refundedUsagePurchaseKind(
  paymentIntent: Stripe.PaymentIntent,
  deps: StripeWebhookDeps
): "capacity" | "legacy" | null {
  if (paymentIntent.metadata.kind === "hosted_usage") {
    assertCapacityHostedUsagePayment(paymentIntent, deps);
    return "capacity";
  }
  return paymentIntent.metadata.kind === "topup" ? "legacy" : null;
}

function cumulativeRefundCredit(input: {
  cumulativeGrossCents: number;
  grossCents: number;
  creditedCents: number;
}): number {
  if (input.grossCents <= 0) return input.cumulativeGrossCents;
  return Math.round(
    (Math.min(input.cumulativeGrossCents, input.grossCents) *
      input.creditedCents) /
      input.grossCents
  );
}

function refundLedgerDelta(reversalCents: number): number {
  return reversalCents === 0 ? 0 : -reversalCents;
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  deps: StripeWebhookDeps
) {
  // Only hosted-usage purchases are reversed automatically; subscription
  // refunds remain a support flow. Purchase metadata lives on the
  // PaymentIntent (set via payment_intent_data at checkout) — Stripe does
  // NOT copy PI metadata onto the Charge, so it must be fetched.
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const paymentIntent = await deps.retrievePaymentIntent(paymentIntentId);
  const purchaseKind = refundedUsagePurchaseKind(paymentIntent, deps);
  if (!purchaseKind) return;
  const accountId = paymentIntent.metadata.billing_account_id;
  if (!accountId) return;
  const account = await deps.findAccountById(accountId);
  if (!account) return;
  // Reverse the credited (pre-tax) amount, not the gross refund: the ledger
  // was credited credit_cents while the charge total includes tax, so a
  // refund reverses proportionally (full refund ⇒ full credited amount).
  const creditedCents = stampedUsagePurchaseCents(paymentIntent);
  const grossCents = paymentIntent.amount_received;
  const refunds = (await deps.listRefunds(charge.id))
    .filter((refund) => refund.status === "succeeded")
    .toSorted(
      (left, right) =>
        left.created - right.created || left.id.localeCompare(right.id)
    );
  let cumulativeGrossCents = 0;
  let cumulativeReversalCents = 0;
  for (const refund of refunds) {
    cumulativeGrossCents += refund.amount;
    const targetReversalCents = cumulativeRefundCredit({
      cumulativeGrossCents,
      grossCents,
      creditedCents,
    });
    const reversalCents = targetReversalCents - cumulativeReversalCents;
    cumulativeReversalCents = targetReversalCents;
    await deps.postLedgerEntry({
      accountId: account.id,
      deltaCents: refundLedgerDelta(reversalCents),
      bucket: "purchased",
      kind: "refund",
      sourceRef: `refund:${refund.id}`,
      metadata: {
        purchase_kind: purchaseKind,
        catalog_version:
          paymentIntent.metadata.catalog_version ?? "legacy_billing_v1",
        charge: charge.id,
        refund: refund.id,
        refund_amount: refund.amount,
      },
    });
  }
}

async function handleDisputeCreated(
  dispute: Stripe.Dispute,
  deps: StripeWebhookDeps
) {
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const charge = await deps.retrieveCharge(chargeId);
  const customerId = customerIdOf(charge.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;
  // Freeze top-ups only — runs keep working, nobody is punished before
  // adjudication (pricing-plan 02 §4).
  await deps.updateAccount(account.id, { status: "frozen_topups" });
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: StripeWebhookDeps = defaultDeps()
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event.data.object, deps);
    case "invoice.paid":
      return handleInvoicePaid(
        event.data.object,
        event.id,
        event.created,
        deps
      );
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object, event.created, deps);
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object, deps);
    case "customer.subscription.updated":
      return syncSubscription(event.data.object, event.id, event.created, deps);
    case "customer.subscription.deleted":
      return syncSubscription(event.data.object, event.id, event.created, deps);
    case "subscription_schedule.updated":
    case "subscription_schedule.released":
    case "subscription_schedule.canceled":
      return syncCapacitySchedule(
        event.data.object,
        event.id,
        event.created,
        deps
      );
    case "charge.refunded":
      return handleChargeRefunded(event.data.object, deps);
    case "charge.dispute.created":
      return handleDisputeCreated(event.data.object, deps);
    default:
      return; // unhandled event types are acked and ignored
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isBillingEnabled() || !webhookSecret) {
    return NextResponse.json(
      { error: "Billing is not enabled" },
      { status: 503 }
    );
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const claim = await claimStripeEvent(event);
  if (claim === "processed") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (claim === "in_progress") {
    return NextResponse.json(
      { error: "Event processing is already in progress" },
      { status: 409 }
    );
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    // Keep the unprocessed claim. Deleting it can lose the event if a
    // concurrent duplicate was already acknowledged; stale claims remain
    // visible and can be safely replayed after the takeover window.
    console.error(
      `[stripe-webhook] ${event.type} ${event.id} failed:`,
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  await markStripeEventProcessed(event.id);
  return NextResponse.json({ received: true });
}
