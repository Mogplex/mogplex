import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  loadWebhookRoute,
  accountFixture,
  makeDeps,
} from "./helpers/stripe-webhook-fixtures";

test("checkout.session.completed should link the Stripe customer to the account", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ stripe_customer_id: null }),
  });
  const event = {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        mode: "subscription",
        client_reference_id: "acct-1",
        customer: "cus_new",
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { stripe_customer_id: "cus_new" } },
  ]);
});

test("checkout.session.completed should not replace an existing Stripe customer", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_checkout_stale",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_stale",
        mode: "subscription",
        client_reference_id: "acct-1",
        customer: "cus_stale",
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, []);
});

test("payment_intent.succeeded should credit the stamped pre-tax amount, not amount_received", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1",
        amount_received: 2718, // $25 + tax
        metadata: {
          kind: "topup",
          billing_account_id: "acct-1",
          credit_cents: "2500",
        },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [
      entry.kind,
      entry.bucket,
      entry.deltaCents,
      entry.sourceRef,
    ]),
    [["topup", "purchased", 2500, "topup:pi_1"]]
  );
});

test("payment_intent.succeeded should reject a missing pre-tax credit stamp", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi3",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_3",
        amount_received: 1000,
        metadata: { kind: "topup", billing_account_id: "acct-1" },
      },
    },
  } as unknown as Stripe.Event;

  await assert.rejects(
    route.handleStripeEvent(event, deps),
    /missing a valid credit_cents stamp/
  );
  assert.equal(recorded.ledger.length, 0);
});

test("payment_intent.succeeded should ignore non-topup payments", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi2",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_2", amount_received: 2000, metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
});
