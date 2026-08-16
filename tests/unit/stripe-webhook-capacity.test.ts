import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  accountFixture,
  invoicePaidEvent,
  loadWebhookRoute,
  makeDeps,
} from "./helpers/stripe-webhook-fixtures";

function capacitySubscription(
  input: {
    plan?: "pro" | "plus" | "max";
    interval?: "monthly" | "annual";
    status?: Stripe.Subscription.Status;
    includeAddOn?: boolean;
  } = {}
): Stripe.Subscription {
  const plan = input.plan ?? "pro";
  const items =
    input.status === "canceled"
      ? []
      : [
          {
            id: "si_plan",
            quantity: 1,
            current_period_start: 1_785_542_400,
            price: {
              id: `price_${plan}`,
              lookup_key: `capacity_v2_${plan}_${input.interval ?? "monthly"}`,
            },
          },
          ...(input.includeAddOn
            ? [
                {
                  id: "si_concurrency",
                  quantity: 2,
                  current_period_start: 1_785_542_400,
                  price: {
                    id: "price_concurrency",
                    lookup_key: "capacity_v2_concurrency_10_monthly",
                  },
                },
              ]
            : []),
        ];
  return {
    id: "sub_1",
    status: input.status ?? "active",
    customer: "cus_123",
    latest_invoice: "in_1",
    items: { data: items },
  } as unknown as Stripe.Subscription;
}

test("invoice.paid projects capacity and grants hosted usage only after payment", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription({ includeAddOn: true }),
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 1);
  assert.equal(
    recorded.capacitySnapshots[0]?.sourceEventId,
    "evt_invoice_paid"
  );
  assert.equal(recorded.capacitySnapshots[0]?.snapshot.plan?.code, "pro");
  assert.equal(recorded.capacitySnapshots[0]?.snapshot.items.length, 2);
  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant", 500]]
  );
  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { status: "active" } },
  ]);
  assert.deepEqual(recorded.annualGrantReconciliations, [
    {
      accountId: "acct-1",
      keepEntitlementVersion: null,
      desired: null,
    },
  ]);
});

test("annual capacity invoice schedules the next monthly included-usage grant", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription({ interval: "annual" }),
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.annualGrantReconciliations.length, 1);
  assert.deepEqual(recorded.annualGrantReconciliations[0], {
    accountId: "acct-1",
    keepEntitlementVersion: 1,
    desired: {
      accountId: "acct-1",
      subscriptionId: "sub_1",
      entitlementVersion: 1,
      priceLookupKey: "capacity_v2_pro_annual",
      includedUsageCents: 500,
      cycleStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      occurrence: {
        offset: 1,
        period: "2026-09",
        dueAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      sourceEventId: "evt_invoice_paid",
    },
  });
});

test("elapsed annual cycle preserves current-version pending grants", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription({ interval: "annual" }),
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = Date.parse("2027-08-01T00:00:00.000Z") / 1_000;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.annualGrantReconciliations, [
    {
      accountId: "acct-1",
      keepEntitlementVersion: 1,
      desired: null,
    },
  ]);
});

test("stale capacity cancellation cannot expire current included usage", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ plan_code: "pro" }),
    balance: { includedCents: 500, purchasedCents: 900, totalCents: 1_400 },
    capacityBillingOperationsEnabled: true,
    capacityProjectionResult: {
      applied: false,
      duplicate: false,
      stale: true,
      entitlementVersion: 2,
    },
  });
  const event = {
    id: "evt_stale_capacity_deleted",
    type: "customer.subscription.deleted",
    created: 1_787_078_400,
    data: {
      object: capacitySubscription({ status: "canceled" }),
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 1);
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});

test("duplicate projection resumes idempotent grant recovery", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription(),
    capacityBillingOperationsEnabled: true,
    capacityProjectionResult: {
      applied: false,
      duplicate: true,
      stale: false,
      entitlementVersion: 1,
    },
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant", 500]]
  );
});

test("indeterminate projection cannot change capacity billing state", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription(),
    capacityBillingOperationsEnabled: true,
    capacityProjectionResult: {
      applied: false,
      duplicate: false,
      stale: false,
      entitlementVersion: 1,
    },
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await assert.rejects(
    route.handleStripeEvent(event, deps),
    /projection returned no disposition/
  );
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});

test("capacity invoice handling fails closed while Gate B operations are disabled", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription(),
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await assert.rejects(
    route.handleStripeEvent(event, deps),
    /Capacity billing operations are disabled/
  );
  assert.equal(recorded.capacitySnapshots.length, 0);
  assert.equal(recorded.ledger.length, 0);
});

test("an older paid invoice cannot authorize a newer capacity state", async () => {
  const route = await loadWebhookRoute();
  const subscription = capacitySubscription({ plan: "plus" });
  subscription.latest_invoice = "in_newer";
  const { deps, recorded } = makeDeps({
    subscription,
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 0);
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});

test("a delayed paid invoice is harmless after capacity cancellation", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ plan_code: "pro" }),
    subscription: capacitySubscription({ status: "canceled" }),
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 0);
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});

test("subscription.updated records the Stripe reference but defers capacity until payment", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    subscription: capacitySubscription({ plan: "plus" }),
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_capacity_updated",
    type: "customer.subscription.updated",
    created: 1_787_078_400,
    data: { object: capacitySubscription({ plan: "plus" }) },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 0);
  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: { stripe_subscription_id: "sub_1" },
    },
  ]);
});

test("subscription.deleted closes capacity and expires only included usage", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ plan_code: "pro", tier: "free" }),
    balance: { includedCents: 500, purchasedCents: 900, totalCents: 1_400 },
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_capacity_deleted",
    type: "customer.subscription.deleted",
    created: 1_787_078_400,
    data: {
      object: capacitySubscription({ status: "canceled" }),
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 1);
  assert.equal(recorded.capacitySnapshots[0]?.snapshot.cancellation, true);
  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant_expiry", -500]]
  );
  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: { stripe_subscription_id: null, status: "active" },
    },
  ]);
  assert.deepEqual(recorded.annualGrantReconciliations, [
    {
      accountId: "acct-1",
      keepEntitlementVersion: null,
      desired: null,
    },
  ]);
});

test("capacity cancellation preserves a dispute freeze while clearing the subscription", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({
      plan_code: "pro",
      status: "frozen_topups",
      stripe_subscription_id: "sub_1",
    }),
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_frozen_capacity_deleted",
    type: "customer.subscription.deleted",
    created: 1_787_078_400,
    data: {
      object: capacitySubscription({ status: "canceled" }),
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { stripe_subscription_id: null } },
  ]);
});

test("contract plan cancellation stays outside individual capacity billing", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ plan_code: "business", tier: "team" }),
  });
  const event = {
    id: "evt_contract_deleted",
    type: "customer.subscription.deleted",
    created: 1_787_078_400,
    data: {
      object: capacitySubscription({ status: "canceled" }),
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacitySnapshots.length, 0);
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
});

test("a paid same-period capacity upgrade grants only the hosted-usage delta", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({
      plan_code: "pro",
      included_hosted_usage_cents: 500,
    }),
    subscription: capacitySubscription({ plan: "plus" }),
    postedRefs: new Set(["grant:acct-1:2026-08:sub_1"]),
    capacityBillingOperationsEnabled: true,
  });
  const event = invoicePaidEvent();
  event.created = 1_787_078_400;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant_adjustment", 2_000]]
  );
});
