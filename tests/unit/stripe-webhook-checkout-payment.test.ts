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

test("capacity hosted-usage payment credits face value once after Stripe succeeds", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_capacity_hosted_usage",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_capacity_usage",
        livemode: false,
        status: "succeeded",
        currency: "usd",
        amount_received: 2718,
        metadata: {
          kind: "hosted_usage",
          catalog_version: "capacity_v2",
          billing_account_id: "acct-1",
          credit_cents: "2500",
          checkout_attempt_id: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
        },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.ledger, [
    {
      accountId: "acct-1",
      deltaCents: 2500,
      bucket: "purchased",
      kind: "topup",
      sourceRef: "hosted-usage:pi_capacity_usage",
      metadata: {
        purchase_kind: "capacity",
        catalog_version: "capacity_v2",
        payment_intent: "pi_capacity_usage",
        amount_received: 2718,
      },
    },
  ]);
});

test("capacity hosted-usage payment fails closed when disabled or inconsistent", async () => {
  const route = await loadWebhookRoute();
  const base = {
    id: "pi_capacity_invalid",
    livemode: false,
    status: "succeeded",
    currency: "usd",
    amount_received: 1000,
    metadata: {
      kind: "hosted_usage",
      catalog_version: "capacity_v2",
      billing_account_id: "acct-1",
      credit_cents: "1000",
      checkout_attempt_id: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
    },
  };
  const disabled = makeDeps({});
  await assert.rejects(
    route.handleStripeEvent(
      {
        id: "evt_capacity_disabled",
        type: "payment_intent.succeeded",
        data: { object: base },
      } as unknown as Stripe.Event,
      disabled.deps
    ),
    /operations are disabled/
  );
  assert.equal(disabled.recorded.ledger.length, 0);

  for (const object of [
    { ...base, livemode: true },
    { ...base, status: "processing" },
    { ...base, currency: "cad" },
    { ...base, amount_received: 999 },
    { ...base, metadata: { ...base.metadata, catalog_version: "capacity_v3" } },
    { ...base, metadata: { ...base.metadata, credit_cents: "99" } },
    { ...base, metadata: { ...base.metadata, credit_cents: "100001" } },
    {
      ...base,
      metadata: { ...base.metadata, checkout_attempt_id: "invalid" },
    },
  ]) {
    const invalid = makeDeps({ capacityBillingOperationsEnabled: true });
    await assert.rejects(
      route.handleStripeEvent(
        {
          id: "evt_capacity_invalid",
          type: "payment_intent.succeeded",
          data: { object },
        } as unknown as Stripe.Event,
        invalid.deps
      ),
      /does not match the capacity purchase contract/
    );
    assert.equal(invalid.recorded.ledger.length, 0);
  }
});

test("capacity hosted-usage payment keeps missing account linkage retryable", async () => {
  const route = await loadWebhookRoute();
  const base = {
    id: "pi_capacity_unlinked",
    livemode: false,
    status: "succeeded",
    currency: "usd",
    amount_received: 1000,
    metadata: {
      kind: "hosted_usage",
      catalog_version: "capacity_v2",
      billing_account_id: "missing-account",
      credit_cents: "1000",
      checkout_attempt_id: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
    },
  };
  for (const [object, expected] of [
    [base, /unknown account/],
    [
      { ...base, metadata: { ...base.metadata, billing_account_id: "" } },
      /missing its billing account/,
    ],
  ] as const) {
    const { deps, recorded } = makeDeps({
      capacityBillingOperationsEnabled: true,
    });
    await assert.rejects(
      route.handleStripeEvent(
        {
          id: "evt_capacity_unlinked",
          type: "payment_intent.succeeded",
          data: { object },
        } as unknown as Stripe.Event,
        deps
      ),
      expected
    );
    assert.equal(recorded.ledger.length, 0);
  }
});
