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

test("invoice.paid should post the grant and expire prior included leftover", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    balance: { includedCents: 350, purchasedCents: 0, totalCents: 350 },
    subscription: subscriptionFixture("pro_monthly"),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [
      ["grant", 2000],
      ["grant_expiry", -350],
    ]
  );
  assert.equal(recorded.ledger[0].sourceRef, "grant:acct-1:2026-08:sub_1");
  assert.equal(recorded.ledger[1].sourceRef, "grantexp:acct-1:2026-08:sub_1");
  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: {
        tier: "pro",
        stripe_subscription_id: "sub_1",
        status: "active",
        period_anchor: "2026-08-01",
      },
    },
  ]);
});

test("invoice.paid redelivery should not double-post grant rows", async () => {
  const route = await loadWebhookRoute();
  const postedRefs = new Set<string>();
  const first = makeDeps({
    subscription: subscriptionFixture("team_monthly"),
    postedRefs,
  });
  await route.handleStripeEvent(invoicePaidEvent(), first.deps);
  assert.equal(first.recorded.ledger.length, 1); // no leftover -> grant only

  // Second delivery sees the granted balance as leftover, but both
  // source_refs for the period are already claimed.
  const second = makeDeps({
    balance: { includedCents: 10000, purchasedCents: 0, totalCents: 10000 },
    subscription: subscriptionFixture("team_monthly"),
    postedRefs,
  });
  await route.handleStripeEvent(invoicePaidEvent(), second.deps);
  assert.equal(second.recorded.ledger.length, 0);
});

test("invoice.paid should grant a same-month re-subscription", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "free" }),
    subscription: subscriptionFixture("pro_monthly", "sub_new"),
    postedRefs: new Set([
      "grant:acct-1:2026-08",
      "grant:acct-1:2026-08:sub_old",
    ]),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.sourceRef]),
    [["grant", "grant:acct-1:2026-08:sub_new"]]
  );
});

test("invoice.paid should NOT lift a dispute freeze on routine renewal", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "frozen_topups", tier: "pro" }),
    subscription: subscriptionFixture("pro_monthly"),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.equal(recorded.updates.length, 1);
  assert.equal(recorded.updates[0].updates.status, undefined);
  assert.equal(recorded.updates[0].updates.tier, "pro");
});

test("invoice.paid should fail visibly for an unknown paid price", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: subscriptionFixture("unknown_plan"),
  });

  await assert.rejects(
    route.handleStripeEvent(invoicePaidEvent(), deps),
    /paid invoice in_1 references an unknown subscription price/
  );
  assert.deepEqual(recorded.ledger, []);
  assert.deepEqual(recorded.updates, []);
});

test("invoice.payment_failed should mark the account past_due", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_inv_failed",
    type: "invoice.payment_failed",
    data: { object: { id: "in_2", customer: "cus_123" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { status: "past_due" } },
  ]);
});

test("invoice.payment_failed should preserve a dispute freeze", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "frozen_topups" }),
  });
  const event = {
    id: "evt_inv_failed_frozen",
    type: "invoice.payment_failed",
    data: { object: { id: "in_frozen", customer: "cus_123" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, []);
});

test("stale invoice.payment_failed should not clobber a newer account status", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({
      updated_at: "2026-08-04T19:00:00.000Z",
    }),
  });
  const event = {
    id: "evt_inv_failed_stale",
    type: "invoice.payment_failed",
    created: Date.parse("2026-08-04T18:00:00.000Z") / 1000,
    data: { object: { id: "in_stale", customer: "cus_123" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, []);
});
