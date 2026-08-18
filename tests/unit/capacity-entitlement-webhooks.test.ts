import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyCapacityEntitlementSnapshot,
  buildCapacityEntitlementSnapshot,
  type CapacityEntitlementSnapshot,
} from "../../lib/billing/capacity-entitlement-webhooks";

function stripeItem(input: {
  id: string;
  lookupKey: string | null;
  quantity?: number;
  currentPeriodStart?: number;
}): Stripe.SubscriptionItem {
  return {
    id: input.id,
    quantity: input.quantity ?? 1,
    current_period_start: input.currentPeriodStart ?? 1_785_542_400,
    price: {
      id: `price_${input.id}`,
      lookup_key: input.lookupKey,
    },
  } as Stripe.SubscriptionItem;
}

function subscription(input: {
  status?: Stripe.Subscription.Status;
  items: Stripe.SubscriptionItem[];
}): Stripe.Subscription {
  return {
    id: "sub_capacity",
    customer: "cus_capacity",
    status: input.status ?? "active",
    items: { data: input.items },
  } as Stripe.Subscription;
}

function assertPlusSnapshot(snapshot: CapacityEntitlementSnapshot | null) {
  assert.ok(snapshot?.plan);
  assert.equal(snapshot.plan.code, "plus");
  assert.equal(snapshot.plan.concurrency, 25);
  assert.equal(snapshot.plan.retainedDataBytes, 5_000_000_000);
  assert.equal(snapshot.plan.hostedUsageCents, 10_000);
  assert.equal(snapshot.plan.periodAnchor, "2026-08-01");
  assert.deepEqual(
    snapshot.items.map((item) => [
      item.itemRef,
      item.itemKind,
      item.quantity,
      item.concurrencyDelta,
      item.retainedDataBytesDelta,
    ]),
    [
      ["si_plan", "plan", 1, 25, 5_000_000_000],
      ["si_concurrency", "concurrency_addon", 2, 10, 0],
      ["si_storage", "retained_data_addon", 1, 0, 50_000_000_000],
    ]
  );
}

test("buildCapacityEntitlementSnapshot resolves one plan and recurring add-ons", () => {
  const snapshot = buildCapacityEntitlementSnapshot({
    subscription: subscription({
      items: [
        stripeItem({ id: "si_plan", lookupKey: "capacity_v2_plus_monthly" }),
        stripeItem({
          id: "si_concurrency",
          lookupKey: "capacity_v2_concurrency_10_monthly",
          quantity: 2,
        }),
        stripeItem({
          id: "si_storage",
          lookupKey: "capacity_v2_retained_data_50gb_monthly",
        }),
      ],
    }),
  });

  assertPlusSnapshot(snapshot);
});

test("legacy subscriptions are ignored and mixed capacity catalogs fail closed", () => {
  assert.equal(
    buildCapacityEntitlementSnapshot({
      subscription: subscription({
        items: [stripeItem({ id: "si_legacy", lookupKey: "pro_monthly" })],
      }),
    }),
    null
  );

  assert.throws(
    () =>
      buildCapacityEntitlementSnapshot({
        subscription: subscription({
          items: [
            stripeItem({ id: "si_plan", lookupKey: "capacity_v2_pro_monthly" }),
            stripeItem({ id: "si_legacy", lookupKey: "topup_10" }),
          ],
        }),
      }),
    /contains unknown prices: topup_10/
  );
  assert.throws(
    () =>
      buildCapacityEntitlementSnapshot({
        subscription: subscription({
          items: [
            stripeItem({
              id: "si_bad",
              lookupKey: "capacity_v2_future_monthly",
            }),
          ],
        }),
      }),
    /unknown capacity price/
  );
});

test("capacity plan quantity must stay at one named user", () => {
  assert.throws(
    () =>
      buildCapacityEntitlementSnapshot({
        subscription: subscription({
          items: [
            stripeItem({
              id: "si_plan",
              lookupKey: "capacity_v2_max_monthly",
              quantity: 2,
            }),
          ],
        }),
      }),
    /plan quantity must be 1/
  );
});

test("forced capacity cancellation produces an empty closing snapshot", () => {
  const snapshot = buildCapacityEntitlementSnapshot({
    forceCapacity: true,
    subscription: subscription({ status: "canceled", items: [] }),
  });
  assert.deepEqual(snapshot, {
    catalogVersion: "capacity_v2",
    subscriptionId: "sub_capacity",
    cancellation: true,
    plan: null,
    items: [],
  });
});

test("applyCapacityEntitlementSnapshot forwards normalized facts and validates the RPC result", async () => {
  const snapshot = buildCapacityEntitlementSnapshot({
    subscription: subscription({
      items: [
        stripeItem({ id: "si_plan", lookupKey: "capacity_v2_pro_annual" }),
      ],
    }),
  });
  assert.ok(snapshot);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: [
          {
            applied: true,
            duplicate: false,
            stale: false,
            entitlement_version: "4",
          },
        ],
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  const result = await applyCapacityEntitlementSnapshot({
    accountId: "account-1",
    sourceEventId: "evt_capacity",
    effectiveAt: new Date("2026-08-16T12:00:00.000Z"),
    snapshot,
    client,
  });

  assert.deepEqual(result, {
    applied: true,
    duplicate: false,
    stale: false,
    entitlementVersion: 4,
  });
  assert.equal(calls[0]?.name, "apply_billing_capacity_entitlement_snapshot");
  assert.equal(calls[0]?.args.p_source_event_id, "evt_capacity");
  assert.equal(calls[0]?.args.p_effective_at, "2026-08-16T12:00:00.000Z");
  assert.deepEqual(calls[0]?.args.p_snapshot, snapshot);
});
