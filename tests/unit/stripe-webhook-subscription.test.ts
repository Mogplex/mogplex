import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  loadWebhookRoute,
  accountFixture,
  makeDeps,
  subscriptionFixture,
  invoicePaidEvent,
} from "./helpers/stripe-webhook-fixtures";

test("customer.subscription.updated should defer a paid tier change until invoice.paid", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_sub_upd",
    type: "customer.subscription.updated",
    data: { object: subscriptionFixture("team_monthly") },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: { stripe_subscription_id: "sub_1" },
    },
  ]);
});

test("invoice.paid should add the included-usage delta for a mid-cycle upgrade", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "pro" }),
    subscription: subscriptionFixture("team_monthly"),
    postedRefs: new Set(["grant:acct-1:2026-08:sub_1"]),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant_adjustment", 8000]]
  );
  assert.equal(
    recorded.ledger[0]?.sourceRef,
    "grantadj:acct-1:sub_1:2026-08:team_monthly"
  );
  assert.equal(recorded.updates[0]?.updates.tier, "team");
});

test("customer.subscription.deleted should drop to free and clear past_due", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "past_due", tier: "pro" }),
  });
  const event = {
    id: "evt_sub_del",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_1",
        status: "canceled",
        customer: "cus_123",
        items: { data: [] },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: {
        tier: "free",
        stripe_subscription_id: null,
        status: "active",
      },
    },
  ]);
  assert.equal(recorded.ledger.length, 0);
});

test("customer.subscription.deleted should expire included credit but preserve purchased credit", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "team" }),
    balance: {
      includedCents: 4200,
      purchasedCents: 2500,
      totalCents: 6700,
    },
  });
  const event = {
    id: "evt_sub_del_credit",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_1",
        status: "canceled",
        customer: "cus_123",
        items: { data: [] },
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
    [["grant_expiry", "included", -4200, "grantexp:acct-1:cancel:sub_1"]]
  );
});

test("customer.subscription.deleted should preserve a dispute freeze", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "frozen_topups", tier: "pro" }),
  });
  const event = {
    id: "evt_sub_del2",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_1",
        status: "canceled",
        customer: "cus_123",
        items: { data: [] },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.updates[0].updates.status, undefined);
  assert.equal(recorded.updates[0].updates.tier, "free");
});
