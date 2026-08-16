import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  accountFixture,
  invoicePaidEvent,
  loadWebhookRoute,
  makeDeps,
} from "./helpers/stripe-webhook-fixtures";

/* eslint-disable max-lines -- capacity webhook lifecycle cases share one fixture suite */

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

function capacitySchedule(
  input: {
    status?: Stripe.SubscriptionSchedule.Status;
    includeMarker?: boolean;
    targetQuantity?: number;
  } = {}
): Stripe.SubscriptionSchedule {
  const effectiveAt = 1_789_516_800;
  const metadata =
    input.includeMarker === false
      ? {}
      : {
          mogplex_capacity_schedule: "capacity_schedule_v1",
          billing_account_id: "acct-1",
          subscription_id: "sub_1",
          subscription_item_id: "si_concurrency",
          lookup_key: "capacity_v2_concurrency_10_monthly",
          price_id: "price_concurrency",
          current_quantity: "2",
          target_quantity: String(input.targetQuantity ?? 1),
          effective_at: String(effectiveAt),
          action: (input.targetQuantity ?? 1) === 0 ? "cancel" : "decrease",
          attempt_id: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
        };
  return {
    id: "sub_sched_1",
    status: input.status ?? "active",
    customer: "cus_123",
    subscription: input.status === "released" ? null : "sub_1",
    released_subscription: input.status === "released" ? "sub_1" : null,
    metadata,
    phases:
      input.status === "released"
        ? []
        : [
            {
              start_date: effectiveAt,
              items: [
                { price: "price_pro", quantity: 1 },
                ...((input.targetQuantity ?? 1) > 0
                  ? [
                      {
                        price: "price_concurrency",
                        quantity: input.targetQuantity ?? 1,
                      },
                    ]
                  : []),
              ],
            },
          ],
  } as unknown as Stripe.SubscriptionSchedule;
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

test("subscription_schedule.updated records a future capacity decrease", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({
      plan_code: "pro",
      stripe_subscription_id: "sub_1",
    }),
    subscription: capacitySubscription({ includeAddOn: true }),
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_schedule_updated",
    type: "subscription_schedule.updated",
    created: 1_787_078_400,
    data: { object: capacitySchedule() },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.equal(recorded.capacityScheduleProjections.length, 1);
  assert.deepEqual(recorded.capacityScheduleProjections[0], {
    accountId: "acct-1",
    subscriptionId: "sub_1",
    scheduleId: "sub_sched_1",
    sourceEventId: "evt_schedule_updated",
    providerEventCreatedAt: new Date("2026-08-18T18:40:00.000Z"),
    eventPriority: 0,
    effectiveAt: new Date("2026-09-16T00:00:00.000Z"),
    subscriptionItemId: "si_concurrency",
    lookupKey: "capacity_v2_concurrency_10_monthly",
    quantity: 1,
    state: "target_scheduled",
    attemptId: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
  });
});

test("subscription_schedule.released restores the current future quantity", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({
      plan_code: "pro",
      stripe_subscription_id: "sub_1",
    }),
    subscription: capacitySubscription({ includeAddOn: true }),
    capacityBillingOperationsEnabled: true,
  });
  const event = {
    id: "evt_schedule_released",
    type: "subscription_schedule.released",
    created: 1_787_078_500,
    data: { object: capacitySchedule({ status: "released" }) },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.capacityScheduleProjections.map((entry) => [
      entry.quantity,
      entry.eventPriority,
      entry.state,
    ]),
    [[2, 50, "schedule_released"]]
  );
});

test("capacity schedule webhooks ignore unmarked schedules and fail closed when disabled", async () => {
  const route = await loadWebhookRoute();
  const ignored = makeDeps({
    subscription: capacitySubscription({ includeAddOn: true }),
  });
  await route.handleStripeEvent(
    {
      id: "evt_unmarked_schedule",
      type: "subscription_schedule.updated",
      created: 1_787_078_400,
      data: { object: capacitySchedule({ includeMarker: false }) },
    } as unknown as Stripe.Event,
    ignored.deps
  );
  assert.equal(ignored.recorded.capacityScheduleProjections.length, 0);

  const disabled = makeDeps({
    subscription: capacitySubscription({ includeAddOn: true }),
  });
  await assert.rejects(
    route.handleStripeEvent(
      {
        id: "evt_disabled_schedule",
        type: "subscription_schedule.updated",
        created: 1_787_078_400,
        data: { object: capacitySchedule() },
      } as unknown as Stripe.Event,
      disabled.deps
    ),
    /Capacity billing operations are disabled/
  );
  assert.equal(disabled.recorded.capacityScheduleProjections.length, 0);
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
