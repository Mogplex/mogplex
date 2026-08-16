import assert from "node:assert/strict";
import type Stripe from "stripe";
import { test } from "vitest";
import type { BillingAccount } from "./accounts";
import { signCapacityChangePreview } from "./capacity-change-contract";
import { CapacityChangeError } from "./capacity-stripe-changes";
import {
  buildPeriodEndScheduleUpdate,
  scheduleCapacityDecrease,
  type CapacityStripeScheduleDeps,
} from "./capacity-stripe-schedule";

/* eslint-disable max-lines -- Stripe schedule behavior needs full failure and field-preservation coverage */
/* eslint-disable unicorn/prefer-bigint-literals -- the project TypeScript target predates bigint literal syntax */

const NOW = new Date("2026-08-16T12:00:00.000Z");
const PERIOD_START = Date.parse("2026-08-16T00:00:00.000Z") / 1_000;
const PERIOD_END = Date.parse("2026-09-16T00:00:00.000Z") / 1_000;
const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";
const LOOKUP = "capacity_v2_concurrency_10_monthly";
const PRICE_ID = "price-concurrency-10";

function accountFixture(
  overrides: Partial<BillingAccount> = {}
): BillingAccount {
  return {
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
    ...overrides,
  };
}

function subscriptionItem(input: {
  id: string;
  priceId: string;
  lookupKey: string;
  quantity?: number;
}): Stripe.SubscriptionItem {
  return {
    id: input.id,
    price: { id: input.priceId, lookup_key: input.lookupKey },
    quantity: input.quantity ?? 1,
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
  } as unknown as Stripe.SubscriptionItem;
}

function subscriptionFixture(
  input: {
    lookupKey?: string;
    priceId?: string;
    quantity?: number;
    schedule?: string | null;
  } = {}
): Stripe.Subscription {
  return {
    id: "sub-1",
    customer: "cus-1",
    status: "active",
    pending_update: null,
    schedule: input.schedule ?? null,
    items: {
      data: [
        subscriptionItem({
          id: "si-plan",
          priceId: "price-pro",
          lookupKey: "capacity_v2_pro_monthly",
        }),
        subscriptionItem({
          id: "si-addon",
          priceId: input.priceId ?? PRICE_ID,
          lookupKey: input.lookupKey ?? LOOKUP,
          quantity: input.quantity ?? 3,
        }),
      ],
    },
  } as unknown as Stripe.Subscription;
}

function phaseItem(input: {
  priceId: string;
  quantity: number;
}): Stripe.SubscriptionSchedule.Phase.Item {
  return {
    price: input.priceId,
    plan: input.priceId,
    quantity: input.quantity,
    billing_thresholds: null,
    discounts: [],
    metadata: {},
    tax_rates: [],
  };
}

function phase(input: {
  start: number;
  end: number;
  targetQuantity: number;
}): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: input.start,
    end_date: input.end,
    items: [
      phaseItem({ priceId: "price-pro", quantity: 1 }),
      ...(input.targetQuantity > 0
        ? [phaseItem({ priceId: PRICE_ID, quantity: input.targetQuantity })]
        : []),
    ],
    add_invoice_items: [],
    application_fee_percent: null,
    automatic_tax: {
      enabled: true,
      disabled_reason: null,
      liability: { type: "self" },
    },
    billing_cycle_anchor: "automatic",
    billing_thresholds: null,
    collection_method: "charge_automatically",
    currency: "usd",
    default_payment_method: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    invoice_settings: null,
    metadata: { source: "checkout" },
    on_behalf_of: null,
    proration_behavior: "none",
    transfer_data: null,
    trial: false,
    trial_end: null,
  };
}

function scheduleFixture(input: {
  metadata: Stripe.Metadata;
  targetQuantity?: number;
  onePhase?: boolean;
}): Stripe.SubscriptionSchedule {
  const phases = [
    phase({ start: PERIOD_START, end: PERIOD_END, targetQuantity: 3 }),
  ];
  if (!input.onePhase) {
    phases.push(
      phase({
        start: PERIOD_END,
        end: Date.parse("2026-10-16T00:00:00.000Z") / 1_000,
        targetQuantity: input.targetQuantity ?? 1,
      })
    );
  }
  return {
    id: "sub_sched-1",
    status: "active",
    subscription: "sub-1",
    released_subscription: null,
    customer: "cus-1",
    current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
    end_behavior: "release",
    phases,
    metadata: input.metadata,
  } as unknown as Stripe.SubscriptionSchedule;
}

function token(
  input: {
    lookupKey?: string;
    currentQuantity?: number;
    targetQuantity?: number;
    action?: "increase" | "decrease" | "cancel";
  } = {}
) {
  return signCapacityChangePreview(
    {
      version: 1,
      accountId: "account-1",
      subscriptionId: "sub-1",
      subscriptionItemId: "si-addon",
      lookupKey: input.lookupKey ?? LOOKUP,
      currentQuantity: input.currentQuantity ?? 3,
      targetQuantity: input.targetQuantity ?? 1,
      action: input.action ?? "decrease",
      prorationDate: NOW.getTime() / 1_000,
      effectiveAt: PERIOD_END,
      expiresAt: NOW.getTime() / 1_000 + 600,
    },
    "secret"
  );
}

function depsFixture(
  input: {
    subscription?: Stripe.Subscription;
    retainedBytes?: bigint;
    calls?: Array<{ kind: string; value: unknown }>;
    existingSchedule?: Stripe.SubscriptionSchedule;
  } = {}
): CapacityStripeScheduleDeps {
  const calls = input.calls ?? [];
  const subscription = input.subscription ?? subscriptionFixture();
  let created: Stripe.SubscriptionSchedule | null = null;
  return {
    capacityBillingOperationsEnabled: () => true,
    now: () => NOW,
    retrieveSubscription: async (id) => {
      calls.push({ kind: "retrieve-subscription", value: id });
      return subscription;
    },
    resolvePriceId: async (lookupKey) => {
      calls.push({ kind: "resolve-price", value: lookupKey });
      return lookupKey.includes("retained_data") ? "price-retained" : PRICE_ID;
    },
    loadRetainedLogicalBytes: async (accountId) => {
      calls.push({ kind: "retained-data", value: accountId });
      return input.retainedBytes ?? BigInt(0);
    },
    createSchedule: async (params, options) => {
      calls.push({ kind: "create-schedule", value: { params, options } });
      created = scheduleFixture({
        metadata: params.metadata as Stripe.Metadata,
        onePhase: true,
      });
      return created;
    },
    retrieveSchedule: async (id) => {
      calls.push({ kind: "retrieve-schedule", value: id });
      return input.existingSchedule ?? created!;
    },
    updateSchedule: async (id, params, options) => {
      calls.push({ kind: "update-schedule", value: { id, params, options } });
      return scheduleFixture({
        metadata: params.metadata as Stripe.Metadata,
        targetQuantity:
          params.phases?.[1]?.items.find((item) => item.price === PRICE_ID)
            ?.quantity ?? 0,
      });
    },
  };
}

test("schedules a no-proration period-end decrease and preserves phase settings", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const result = await scheduleCapacityDecrease({
    account: accountFixture(),
    previewToken: token(),
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({ calls }),
  });

  assert.deepEqual(result, {
    status: "scheduled",
    subscriptionId: "sub-1",
    scheduleId: "sub_sched-1",
    action: "decrease",
    resultingQuantity: 1,
    effectiveAt: "2026-09-16T00:00:00.000Z",
    prorationBehavior: "none",
    entitlementStatus: "pending_webhook",
  });
  const created = calls.find((call) => call.kind === "create-schedule")!
    .value as {
    params: Stripe.SubscriptionScheduleCreateParams;
    options: Stripe.RequestOptions;
  };
  assert.equal(created.params.from_subscription, "sub-1");
  assert.equal(
    (created.params.metadata as Record<string, string>).target_quantity,
    "1"
  );
  assert.equal(
    created.options.idempotencyKey,
    `capacity-change:account-1:${ATTEMPT_ID}:schedule-create`
  );
  const updated = calls.find((call) => call.kind === "update-schedule")!
    .value as {
    params: Stripe.SubscriptionScheduleUpdateParams;
    options: Stripe.RequestOptions;
  };
  assert.equal(updated.params.proration_behavior, "none");
  assert.equal(updated.params.end_behavior, "release");
  assert.equal(updated.params.phases?.[0]?.end_date, PERIOD_END);
  assert.equal(updated.params.phases?.[1]?.start_date, PERIOD_END);
  assert.equal(updated.params.phases?.[1]?.proration_behavior, "none");
  assert.deepEqual(updated.params.phases?.[1]?.items, [
    {
      price: "price-pro",
      quantity: 1,
      discounts: [],
      metadata: {},
      tax_rates: [],
    },
    {
      price: PRICE_ID,
      quantity: 1,
      discounts: [],
      metadata: {},
      tax_rates: [],
    },
  ]);
  assert.deepEqual(updated.params.phases?.[0]?.automatic_tax, {
    enabled: true,
    liability: { type: "self" },
  });
  assert.equal(
    updated.options.idempotencyKey,
    `capacity-change:account-1:${ATTEMPT_ID}:schedule-update`
  );
});

test("preserves supported discounts, tax, invoice, transfer, and threshold settings", () => {
  const current = phase({
    start: PERIOD_START,
    end: PERIOD_END,
    targetQuantity: 3,
  });
  current.application_fee_percent = 7.5;
  current.billing_thresholds = {
    amount_gte: 5_000,
    reset_billing_cycle_anchor: false,
  };
  current.default_payment_method = { id: "pm-1" } as Stripe.PaymentMethod;
  current.default_tax_rates = [{ id: "txr-1" } as Stripe.TaxRate];
  current.description = "Capacity subscription";
  current.discounts = [
    {
      coupon: { id: "coupon-1" } as Stripe.Coupon,
      discount: null,
      promotion_code: null,
    },
    {
      coupon: null,
      discount: { id: "discount-1" } as Stripe.Discount,
      promotion_code: null,
    },
    {
      coupon: null,
      discount: null,
      promotion_code: { id: "promo-1" } as Stripe.PromotionCode,
    },
  ];
  current.invoice_settings = {
    account_tax_ids: [{ id: "tax-id-1" } as Stripe.TaxId],
    custom_fields: [{ name: "PO", value: "123" }],
    days_until_due: 14,
    description: "Invoice description",
    footer: "Invoice footer",
    issuer: {
      type: "account",
      account: { id: "acct-issuer" } as Stripe.Account,
    },
  };
  current.on_behalf_of = { id: "acct-behalf" } as Stripe.Account;
  current.transfer_data = {
    destination: { id: "acct-destination" } as Stripe.Account,
    amount_percent: 80,
  };
  current.automatic_tax = {
    enabled: true,
    disabled_reason: null,
    liability: {
      type: "account",
      account: { id: "acct-tax" } as Stripe.Account,
    },
  };
  current.items[0] = {
    ...current.items[0]!,
    billing_thresholds: { usage_gte: 100 },
    discounts: [
      {
        coupon: { id: "item-coupon" } as Stripe.Coupon,
        discount: null,
        promotion_code: null,
      },
    ],
    metadata: { source: "catalog" },
    price: { id: "price-pro" } as Stripe.Price,
    tax_rates: [{ id: "txr-item" } as Stripe.TaxRate],
  };
  const schedule = scheduleFixture({ metadata: {}, onePhase: true });
  schedule.phases = [current];
  const params = buildPeriodEndScheduleUpdate({
    schedule,
    intent: {
      accountId: "account-1",
      subscriptionId: "sub-1",
      subscriptionItemId: "si-addon",
      lookupKey: LOOKUP,
      priceId: PRICE_ID,
      currentQuantity: 3,
      targetQuantity: 1,
      effectiveAt: PERIOD_END,
      action: "decrease",
      attemptId: ATTEMPT_ID,
    },
  });
  const translated = params.phases?.[0];
  assert.equal(translated?.application_fee_percent, 7.5);
  assert.deepEqual(translated?.billing_thresholds, {
    amount_gte: 5_000,
    reset_billing_cycle_anchor: false,
  });
  assert.deepEqual(translated?.discounts, [
    { coupon: "coupon-1" },
    { discount: "discount-1" },
    { promotion_code: "promo-1" },
  ]);
  assert.deepEqual(translated?.automatic_tax, {
    enabled: true,
    liability: { type: "account", account: "acct-tax" },
  });
  assert.deepEqual(translated?.invoice_settings, {
    account_tax_ids: ["tax-id-1"],
    custom_fields: [{ name: "PO", value: "123" }],
    days_until_due: 14,
    description: "Invoice description",
    footer: "Invoice footer",
    issuer: { type: "account", account: "acct-issuer" },
  });
  assert.deepEqual(translated?.transfer_data, {
    destination: "acct-destination",
    amount_percent: 80,
  });
  assert.deepEqual(translated?.items[0], {
    price: "price-pro",
    quantity: 1,
    billing_thresholds: { usage_gte: 100 },
    discounts: [{ coupon: "item-coupon" }],
    metadata: { source: "catalog" },
    tax_rates: ["txr-item"],
  });
});

test("cancels only the selected add-on at period end", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const result = await scheduleCapacityDecrease({
    account: accountFixture(),
    previewToken: token({ targetQuantity: 0, action: "cancel" }),
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({ calls }),
  });
  assert.equal(result.action, "cancel");
  const params = (
    calls.find((call) => call.kind === "update-schedule")!.value as {
      params: Stripe.SubscriptionScheduleUpdateParams;
    }
  ).params;
  assert.deepEqual(
    params.phases?.[1]?.items.map((item) => item.price),
    ["price-pro"]
  );
});

test("an exact retry returns the existing confirmed schedule without new writes", async () => {
  const initialCalls: Array<{ kind: string; value: unknown }> = [];
  await scheduleCapacityDecrease({
    account: accountFixture(),
    previewToken: token(),
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({ calls: initialCalls }),
  });
  const metadata = (
    initialCalls.find((call) => call.kind === "create-schedule")!.value as {
      params: Stripe.SubscriptionScheduleCreateParams;
    }
  ).params.metadata as Stripe.Metadata;
  const calls: Array<{ kind: string; value: unknown }> = [];
  const result = await scheduleCapacityDecrease({
    account: accountFixture(),
    previewToken: token(),
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({
      calls,
      subscription: subscriptionFixture({ schedule: "sub_sched-1" }),
      existingSchedule: scheduleFixture({ metadata, targetQuantity: 1 }),
    }),
  });
  assert.equal(result.status, "scheduled");
  assert.equal(
    calls.some(
      (call) =>
        call.kind === "create-schedule" || call.kind === "update-schedule"
    ),
    false
  );
});

test("rejects an unrelated existing schedule without mutating Stripe", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  await assert.rejects(
    scheduleCapacityDecrease({
      account: accountFixture(),
      previewToken: token(),
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({
        calls,
        subscription: subscriptionFixture({ schedule: "sub_sched-foreign" }),
        existingSchedule: scheduleFixture({ metadata: {} }),
      }),
    }),
    (error: CapacityChangeError) => error.code === "change_pending"
  );
  assert.equal(
    calls.some((call) => call.kind === "update-schedule"),
    false
  );
});

test("blocks retained-data decreases below current logical usage", async () => {
  const retainedLookup = "capacity_v2_retained_data_10gb_monthly";
  const calls: Array<{ kind: string; value: unknown }> = [];
  await assert.rejects(
    scheduleCapacityDecrease({
      account: accountFixture(),
      previewToken: token({ lookupKey: retainedLookup }),
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({
        calls,
        retainedBytes: BigInt(25_000_000_001),
        subscription: subscriptionFixture({
          lookupKey: retainedLookup,
          priceId: "price-retained",
        }),
      }),
    }),
    (error: CapacityChangeError) => error.code === "retained_data_in_use"
  );
  assert.equal(
    calls.some((call) => call.kind === "create-schedule"),
    false
  );
});

test("fails closed before Stripe access and rejects increase previews", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  await assert.rejects(
    scheduleCapacityDecrease({
      account: accountFixture(),
      previewToken: "not-read",
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: {
        ...depsFixture({ calls }),
        capacityBillingOperationsEnabled: () => false,
      },
    }),
    (error: CapacityChangeError) => error.code === "operations_disabled"
  );
  assert.deepEqual(calls, []);

  await assert.rejects(
    scheduleCapacityDecrease({
      account: accountFixture(),
      previewToken: token({
        currentQuantity: 0,
        targetQuantity: 1,
        action: "increase",
      }),
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture(),
    }),
    (error: CapacityChangeError) => error.code === "checkout_required"
  );
});
