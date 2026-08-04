import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isBillingEnabled } from "@/lib/billing/stripe";
import { findPlanPrice } from "@/lib/billing/catalog";
import {
  findBillingAccountById,
  findBillingAccountByStripeCustomer,
  updateBillingAccount,
  type BillingAccount,
} from "@/lib/billing/accounts";
import {
  getBillingBalance,
  postLedgerEntry,
  type BillingBalance,
  type LedgerEntry,
} from "@/lib/billing/ledger";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  getBalance: (accountId: string) => Promise<BillingBalance>;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  listRefunds: (chargeId: string) => Promise<Stripe.Refund[]>;
  retrieveCharge: (id: string) => Promise<Stripe.Charge>;
};

function defaultDeps(): StripeWebhookDeps {
  return {
    findAccountByCustomer: findBillingAccountByStripeCustomer,
    findAccountById: findBillingAccountById,
    updateAccount: updateBillingAccount,
    postLedgerEntry,
    getBalance: getBillingBalance,
    retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
    listRefunds: async (chargeId) =>
      (await getStripe().refunds.list({ charge: chargeId, limit: 100 })).data,
    retrieveCharge: (id) => getStripe().charges.retrieve(id),
  };
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
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
  if (!account || account.stripe_customer_id === customerId) return;
  await deps.updateAccount(account.id, { stripe_customer_id: customerId });
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
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
  const item = subscription.items.data[0];
  const lookupKey = item?.price.lookup_key;
  const plan = lookupKey ? findPlanPrice(lookupKey) : null;
  if (!plan || !item) return;

  const periodStart = new Date(item.current_period_start * 1000);
  const period = periodOf(periodStart);

  // Read the pre-grant balance, then claim the grant's source_ref. The
  // expiry of the prior period's leftover ("no rollover" as an explicit,
  // auditable ledger row — pricing-plan 03 §1) only posts when this delivery
  // won the grant claim; otherwise a redelivery would mistake the fresh
  // grant for prior-period leftover and expire it.
  const balance = await deps.getBalance(account.id);
  const grant = await deps.postLedgerEntry({
    accountId: account.id,
    deltaCents: plan.includedUsageCents,
    bucket: "included",
    kind: "grant",
    sourceRef: `grant:${account.id}:${period}`,
    period,
    metadata: { invoice: invoice.id, plan: plan.lookupKey },
  });
  if (grant.posted && balance.includedCents > 0) {
    await deps.postLedgerEntry({
      accountId: account.id,
      deltaCents: -balance.includedCents,
      bucket: "included",
      kind: "grant_expiry",
      sourceRef: `grantexp:${account.id}:${period}`,
      period,
    });
  }
  await deps.updateAccount(account.id, {
    tier: plan.tier,
    status: "active",
    period_anchor: periodStart.toISOString().slice(0, 10),
  });
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  deps: StripeWebhookDeps
) {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;
  // Smart Retries run on Stripe's side; tier persists through the period
  // (grace), drop-to-free happens via customer.subscription.deleted.
  await deps.updateAccount(account.id, { status: "past_due" });
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  deps: StripeWebhookDeps
) {
  if (paymentIntent.metadata?.kind !== "topup") return;
  const accountId = paymentIntent.metadata.billing_account_id;
  if (!accountId) return;
  const account = await deps.findAccountById(accountId);
  if (!account) return;
  await deps.postLedgerEntry({
    accountId: account.id,
    deltaCents: paymentIntent.amount_received,
    bucket: "purchased",
    kind: "topup",
    sourceRef: `topup:${paymentIntent.id}`,
    metadata: { payment_intent: paymentIntent.id },
  });
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  deps: StripeWebhookDeps
) {
  const customerId = customerIdOf(subscription.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;

  if (subscription.status === "canceled") {
    // Drop to Free; purchased balance persists indefinitely (ledger is
    // untouched — only the tier changes).
    await deps.updateAccount(account.id, { tier: "free" });
    return;
  }
  const lookupKey = subscription.items.data[0]?.price.lookup_key;
  const plan = lookupKey ? findPlanPrice(lookupKey) : null;
  if (!plan) return;
  await deps.updateAccount(account.id, { tier: plan.tier });
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  deps: StripeWebhookDeps
) {
  // v1 only reverses top-up credit; subscription refunds are a support flow
  // with no automatic ledger impact.
  if (charge.metadata?.kind !== "topup") return;
  const accountId = charge.metadata.billing_account_id;
  if (!accountId) return;
  const account = await deps.findAccountById(accountId);
  if (!account) return;
  const refunds = await deps.listRefunds(charge.id);
  for (const refund of refunds) {
    await deps.postLedgerEntry({
      accountId: account.id,
      deltaCents: -refund.amount,
      bucket: "purchased",
      kind: "refund",
      sourceRef: `refund:${refund.id}`,
      metadata: { charge: charge.id, refund: refund.id },
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
      return handleInvoicePaid(event.data.object, deps);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object, deps);
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object, deps);
    case "customer.subscription.updated":
      return syncSubscription(event.data.object, deps);
    case "customer.subscription.deleted":
      return syncSubscription(event.data.object, deps);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object, deps);
    case "charge.dispute.created":
      return handleDisputeCreated(event.data.object, deps);
    default:
      return; // unhandled event types are acked and ignored
  }
}

// Claims the event id. Returns false when another delivery already claimed
// it (duplicate → ack and skip).
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const { error } = await supabaseAdmin.from("billing_events").insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`billing_events insert failed: ${error.message}`);
}

async function releaseEvent(eventId: string): Promise<void> {
  await supabaseAdmin
    .from("billing_events")
    .delete()
    .eq("stripe_event_id", eventId);
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

  if (!(await claimEvent(event))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    // Release the claim so Stripe's retry can reprocess. A concurrent
    // duplicate delivery acked while we held the claim is fine — Stripe
    // retries on our 500 regardless.
    await releaseEvent(event.id);
    console.error(
      `[stripe-webhook] ${event.type} ${event.id} failed:`,
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
