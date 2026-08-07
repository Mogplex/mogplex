import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { loadWebhookRoute, makeDeps } from "./helpers/stripe-webhook-fixtures";

test("charge.refunded should reverse the credited amount via PaymentIntent metadata", async () => {
  const route = await loadWebhookRoute();
  // Charge has NO topup metadata (Stripe does not copy PI metadata onto the
  // charge) - the handler must resolve it from the PaymentIntent.
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_1",
      amount_received: 2718,
      metadata: {
        kind: "topup",
        billing_account_id: "acct-1",
        credit_cents: "2500",
      },
    } as unknown as Stripe.PaymentIntent,
    refunds: [{ id: "re_1", amount: 2718, status: "succeeded" }],
  });
  const event = {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: "pi_1", metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  // Full gross refund reverses exactly the credited (pre-tax) amount.
  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.deltaCents, entry.sourceRef]),
    [[-2500, "refund:re_1"]]
  );
});

test("multiple partial refunds should cumulatively reverse the exact credited amount", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_partial",
      amount_received: 3,
      metadata: {
        kind: "topup",
        billing_account_id: "acct-1",
        credit_cents: "2",
      },
    } as unknown as Stripe.PaymentIntent,
    refunds: [
      { id: "re_2", amount: 1, created: 2, status: "succeeded" },
      { id: "re_1", amount: 1, created: 1, status: "succeeded" },
      { id: "re_3", amount: 1, created: 3, status: "succeeded" },
    ],
  });
  const event = {
    id: "evt_partial_refunds",
    type: "charge.refunded",
    data: {
      object: { id: "ch_partial", payment_intent: "pi_partial", metadata: {} },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.sourceRef, entry.deltaCents]),
    [
      ["refund:re_1", -1],
      ["refund:re_2", 0],
      ["refund:re_3", -1],
    ]
  );
  assert.equal(
    recorded.ledger.reduce((sum, entry) => sum + entry.deltaCents, 0),
    -2
  );
});

test("charge.refunded should ignore refunds that did not succeed", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_failed_refund",
      amount_received: 2500,
      metadata: {
        kind: "topup",
        billing_account_id: "acct-1",
        credit_cents: "2500",
      },
    } as unknown as Stripe.PaymentIntent,
    refunds: [
      { id: "re_failed", amount: 2500, status: "failed" },
      { id: "re_canceled", amount: 2500, status: "canceled" },
    ],
  });
  const event = {
    id: "evt_failed_refunds",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_failed_refunds",
        payment_intent: "pi_failed_refund",
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.ledger, []);
});

test("charge.refunded should ignore non-topup charges", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_sub",
      amount_received: 2000,
      metadata: {},
    } as unknown as Stripe.PaymentIntent,
    refunds: [{ id: "re_2", amount: 2000, status: "succeeded" }],
  });
  const event = {
    id: "evt_refund2",
    type: "charge.refunded",
    data: { object: { id: "ch_2", payment_intent: "pi_sub", metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
});

test("charge.dispute.created should freeze top-ups for the org", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_dispute",
    type: "charge.dispute.created",
    data: { object: { id: "dp_1", charge: "ch_1" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { status: "frozen_topups" } },
  ]);
});

test("unhandled event types should be ignored", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_other",
    type: "setup_intent.succeeded",
    data: { object: {} },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});
