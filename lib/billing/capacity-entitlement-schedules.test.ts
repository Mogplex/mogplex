import assert from "node:assert/strict";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { test } from "vitest";
import type { BillingAccount } from "./accounts";
import {
  capacityScheduleMetadata,
  parseCapacityScheduleIntent,
  projectCapacityScheduleEvent,
  recordCapacityScheduleProjection,
  type CapacityScheduleIntent,
} from "./capacity-entitlement-schedules";

const EFFECTIVE_AT = Date.parse("2026-09-16T00:00:00.000Z") / 1_000;
const INTENT: CapacityScheduleIntent = {
  accountId: "account-1",
  subscriptionId: "sub-1",
  subscriptionItemId: "si-addon",
  lookupKey: "capacity_v2_concurrency_10_monthly",
  priceId: "price-addon",
  currentQuantity: 3,
  targetQuantity: 1,
  effectiveAt: EFFECTIVE_AT,
  action: "decrease",
  attemptId: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
};

const ACCOUNT = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: "cus-1",
  stripe_subscription_id: "sub-1",
  tier: "pro",
  plan_code: "pro",
  period_anchor: "2026-08-16",
  subscription_checkout_generation: 0,
  status: "active",
} satisfies BillingAccount;

function subscription(quantity = 3): Stripe.Subscription {
  return {
    id: "sub-1",
    items: {
      data: [
        {
          id: "si-addon",
          quantity,
          price: { id: "price-addon" },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function schedule(
  input: {
    status?: Stripe.SubscriptionSchedule.Status;
    targetQuantity?: number;
    metadata?: Stripe.Metadata;
  } = {}
): Stripe.SubscriptionSchedule {
  const status = input.status ?? "active";
  const targetQuantity = input.targetQuantity ?? 1;
  return {
    id: "sub_sched-1",
    status,
    subscription:
      status === "released" || status === "canceled" ? null : "sub-1",
    released_subscription: status === "released" ? "sub-1" : null,
    metadata: input.metadata ?? capacityScheduleMetadata(INTENT),
    phases:
      status === "released"
        ? []
        : [
            {
              start_date: EFFECTIVE_AT,
              items:
                targetQuantity === 0
                  ? []
                  : [{ price: "price-addon", quantity: targetQuantity }],
            },
          ],
  } as unknown as Stripe.SubscriptionSchedule;
}

test("capacity schedule metadata round-trips a signed scheduling intent", () => {
  assert.deepEqual(parseCapacityScheduleIntent(schedule()), {
    ...INTENT,
    scheduleId: "sub_sched-1",
  });
  assert.equal(parseCapacityScheduleIntent(schedule({ metadata: {} })), null);
  assert.throws(
    () =>
      parseCapacityScheduleIntent(
        schedule({
          metadata: {
            ...capacityScheduleMetadata(INTENT),
            target_quantity: "4",
          },
        })
      ),
    /quantity does not match/
  );
});

test("projects the intended future quantity and lifecycle reversals", async () => {
  const calls: unknown[] = [];
  const recordProjection = async (input: unknown) => {
    calls.push(input);
    return {
      applied: true,
      duplicate: false,
      stale: false,
      entitlementRecorded: true,
    };
  };
  assert.equal(
    await projectCapacityScheduleEvent({
      account: ACCOUNT,
      schedule: schedule(),
      subscription: subscription(),
      sourceEventId: "evt_updated",
      eventCreated: 1_787_078_400,
      recordProjection,
    }),
    true
  );
  await projectCapacityScheduleEvent({
    account: ACCOUNT,
    schedule: schedule({ status: "released" }),
    subscription: subscription(),
    sourceEventId: "evt_released",
    eventCreated: 1_787_078_500,
    recordProjection,
  });
  await projectCapacityScheduleEvent({
    account: ACCOUNT,
    // Keep the original decrease intent intact. Canceling its Stripe schedule
    // cancels the attached subscription immediately; it does not rewrite the
    // scheduled target phase into a removal intent.
    schedule: schedule({ status: "canceled" }),
    subscription: subscription(),
    sourceEventId: "evt_canceled",
    eventCreated: 1_787_078_600,
    recordProjection,
  });
  assert.deepEqual(
    calls.map((call) => {
      const value = call as {
        quantity: number;
        eventPriority: number;
        effectiveAt: Date;
        state: string;
      };
      return [
        value.quantity,
        value.eventPriority,
        value.state,
        value.effectiveAt.toISOString(),
      ];
    }),
    [
      [1, 0, "target_scheduled", "2026-09-16T00:00:00.000Z"],
      [3, 50, "schedule_released", "2026-09-16T00:00:00.000Z"],
      [0, 100, "schedule_canceled", "2026-08-18T18:43:20.000Z"],
    ]
  );
});

test("rejects changed schedule targets and mismatched ownership", async () => {
  await assert.rejects(
    projectCapacityScheduleEvent({
      account: ACCOUNT,
      schedule: schedule({ targetQuantity: 2 }),
      subscription: subscription(),
      sourceEventId: "evt_changed",
      eventCreated: 1_787_078_400,
      recordProjection: async () => {
        throw new Error("should not run");
      },
    }),
    /target changed outside Mogplex/
  );
  await assert.rejects(
    projectCapacityScheduleEvent({
      account: { ...ACCOUNT, id: "another-account" },
      schedule: schedule(),
      subscription: subscription(),
      sourceEventId: "evt_wrong_account",
      eventCreated: 1_787_078_400,
    }),
    /does not match its billing account/
  );
});

test("records a catalog-derived future entitlement through the service-only RPC", async () => {
  let rpcInput: unknown;
  const client = {
    rpc: async (name: string, input: unknown) => {
      rpcInput = { name, input };
      return {
        data: [
          {
            applied: true,
            duplicate: false,
            stale: false,
            entitlement_recorded: true,
          },
        ],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const result = await recordCapacityScheduleProjection({
    accountId: "account-1",
    subscriptionId: "sub-1",
    scheduleId: "sub_sched-1",
    sourceEventId: "evt-updated",
    providerEventCreatedAt: new Date("2026-08-18T18:40:00.000Z"),
    eventPriority: 0,
    effectiveAt: new Date(EFFECTIVE_AT * 1_000),
    subscriptionItemId: "si-addon",
    lookupKey: INTENT.lookupKey,
    quantity: 1,
    state: "target_scheduled",
    attemptId: INTENT.attemptId,
    client,
  });
  assert.deepEqual(result, {
    applied: true,
    duplicate: false,
    stale: false,
    entitlementRecorded: true,
  });
  assert.deepEqual(rpcInput, {
    name: "record_billing_capacity_schedule_projection",
    input: {
      p_account: "account-1",
      p_subscription_id: "sub-1",
      p_schedule_id: "sub_sched-1",
      p_source_event_id: "evt-updated",
      p_provider_event_created_at: "2026-08-18T18:40:00.000Z",
      p_event_priority: 0,
      p_effective_at: "2026-09-16T00:00:00.000Z",
      p_item_ref: "si-addon",
      p_item_kind: "concurrency_addon",
      p_price_lookup_key: INTENT.lookupKey,
      p_quantity: 1,
      p_concurrency_delta: 10,
      p_retained_data_bytes_delta: 0,
      p_metadata: {
        source: "stripe_subscription_schedule",
        state: "target_scheduled",
        attempt_id: INTENT.attemptId,
      },
    },
  });
});
