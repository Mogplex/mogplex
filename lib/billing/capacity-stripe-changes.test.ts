import assert from "node:assert/strict";
import type Stripe from "stripe";
import { test } from "vitest";
import type { BillingAccount } from "./accounts";
import {
  CapacityChangeError,
  previewCapacityChange,
  type CapacityStripeChangeDeps,
} from "./capacity-stripe-changes";
import { confirmCapacityIncrease } from "./capacity-stripe-increase";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const PERIOD_END = Date.parse("2026-09-16T00:00:00.000Z") / 1_000;
const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

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

function item(input: {
  id: string;
  priceId: string;
  lookupKey: string;
  quantity?: number;
}): Stripe.SubscriptionItem {
  return {
    id: input.id,
    price: { id: input.priceId, lookup_key: input.lookupKey },
    quantity: input.quantity ?? 1,
    current_period_start: Date.parse("2026-08-16T00:00:00.000Z") / 1_000,
    current_period_end: PERIOD_END,
  } as unknown as Stripe.SubscriptionItem;
}

function subscriptionFixture(
  input: {
    addOnQuantity?: number;
    addOnLookupKey?: string;
    addOnPriceId?: string;
    pending?: boolean;
  } = {}
): Stripe.Subscription {
  const items = [
    item({
      id: "si-plan",
      priceId: "price-pro",
      lookupKey: "capacity_v2_pro_monthly",
    }),
  ];
  if (input.addOnQuantity) {
    items.push(
      item({
        id: "si-addon",
        priceId: input.addOnPriceId ?? "price-concurrency-10",
        lookupKey: input.addOnLookupKey ?? "capacity_v2_concurrency_10_monthly",
        quantity: input.addOnQuantity,
      })
    );
  }
  return {
    id: "sub-1",
    customer: "cus-1",
    status: "active",
    collection_method: "charge_automatically",
    pending_update: input.pending ? { expires_at: PERIOD_END } : null,
    items: { data: items },
    latest_invoice: null,
  } as unknown as Stripe.Subscription;
}

function previewInvoice(): Stripe.Invoice {
  return {
    id: "upcoming_in_1",
    currency: "usd",
    automatic_tax: { enabled: true, status: "complete" },
    lines: {
      data: [
        {
          amount: 217,
          taxes: [{ amount: 17, tax_behavior: "exclusive" }],
          parent: {
            subscription_item_details: { proration: true },
            invoice_item_details: null,
          },
        },
        {
          amount: 2_000,
          taxes: null,
          parent: {
            subscription_item_details: { proration: false },
            invoice_item_details: null,
          },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
}

function depsFixture(
  input: {
    subscription?: Stripe.Subscription;
    invoice?: Stripe.Invoice;
    calls?: Array<{ kind: string; value: unknown }>;
    updated?: Stripe.Subscription;
  } = {}
): CapacityStripeChangeDeps {
  const calls = input.calls ?? [];
  const subscription = input.subscription ?? subscriptionFixture();
  return {
    capacityBillingOperationsEnabled: () => true,
    now: () => NOW,
    retrieveSubscription: async (id) => {
      calls.push({ kind: "retrieve", value: id });
      return subscription;
    },
    resolvePriceId: async (lookupKey) => {
      calls.push({ kind: "price", value: lookupKey });
      return lookupKey.includes("retained_data")
        ? "price-retained"
        : "price-concurrency-10";
    },
    createInvoicePreview: async (params) => {
      calls.push({ kind: "preview", value: params });
      return input.invoice ?? previewInvoice();
    },
    updateSubscription: async (id, params, options) => {
      calls.push({ kind: "update", value: { id, params, options } });
      return input.updated ?? subscription;
    },
  };
}

test("price preview derives capacity, proration, tax, and a signed token", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: depsFixture({ calls }),
  });

  assert.deepEqual(
    {
      resource: preview.resource,
      action: preview.action,
      currentAllowance: preview.currentAllowance,
      resultingAllowance: preview.resultingAllowance,
      recurringChangeCents: preview.recurringChangeCents,
      amountDueNowCents: preview.amountDueNowCents,
      taxStatus: preview.taxStatus,
      effectiveTiming: preview.effectiveTiming,
    },
    {
      resource: "concurrency",
      action: "increase",
      currentAllowance: "5",
      resultingAllowance: "15",
      recurringChangeCents: 500,
      amountDueNowCents: 234,
      taxStatus: "calculated",
      effectiveTiming: "after_payment",
    }
  );
  assert.match(preview.previewToken, /^[^.]+\.[^.]+$/);
  const stripePreview = calls.find((call) => call.kind === "preview")!
    .value as Stripe.InvoiceCreatePreviewParams;
  assert.deepEqual(stripePreview.subscription_details, {
    items: [{ price: "price-concurrency-10", quantity: 1 }],
    proration_behavior: "always_invoice",
    proration_date: NOW.getTime() / 1_000,
  });
});

test("preview uses the current item and includes other add-ons in the allowance", async () => {
  const subscription = subscriptionFixture({ addOnQuantity: 1 });
  subscription.items.data.push(
    item({
      id: "si-concurrency-50",
      priceId: "price-concurrency-50",
      lookupKey: "capacity_v2_concurrency_50_monthly",
      quantity: 1,
    })
  );
  const calls: Array<{ kind: string; value: unknown }> = [];
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 2,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: depsFixture({ subscription, calls }),
  });

  assert.equal(preview.currentAllowance, "65");
  assert.equal(preview.resultingAllowance, "75");
  assert.equal(preview.currentRecurringAmountCents, 500);
  assert.equal(preview.resultingRecurringAmountCents, 1_000);
  const stripePreview = calls.find((call) => call.kind === "preview")!
    .value as Stripe.InvoiceCreatePreviewParams;
  assert.deepEqual(stripePreview.subscription_details?.items, [
    { id: "si-addon", quantity: 2 },
  ]);
});

test("decrease preview is free now and takes effect at period end", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 0,
      effectiveAction: "cancel",
    },
    signingSecret: "secret",
    deps: depsFixture({
      subscription: subscriptionFixture({ addOnQuantity: 2 }),
      calls,
    }),
  });

  assert.equal(preview.action, "cancel");
  assert.equal(preview.amountDueNowCents, 0);
  assert.equal(preview.taxStatus, "not_applicable");
  assert.equal(preview.effectiveTiming, "period_end");
  assert.equal(preview.effectiveAt, "2026-09-16T00:00:00.000Z");
  assert.equal(
    calls.some((call) => call.kind === "preview"),
    false
  );
});

test("preview rejects action mismatches and ineligible accounts", async () => {
  await assert.rejects(
    previewCapacityChange({
      account: accountFixture(),
      request: {
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "decrease",
      },
      signingSecret: "secret",
      deps: depsFixture(),
    }),
    (error: CapacityChangeError) => error.code === "action_mismatch"
  );
  await assert.rejects(
    previewCapacityChange({
      account: accountFixture({ plan_code: "business" }),
      request: {
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "increase",
      },
      signingSecret: "secret",
      deps: depsFixture(),
    }),
    (error: CapacityChangeError) => error.code === "self_service_unavailable"
  );
});

test("preview and confirmation fail closed before Stripe access", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const disabledDeps = {
    ...depsFixture({ calls }),
    capacityBillingOperationsEnabled: () => false,
  };
  await assert.rejects(
    previewCapacityChange({
      account: accountFixture(),
      request: {
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "increase",
      },
      signingSecret: "secret",
      deps: disabledDeps,
    }),
    (error: CapacityChangeError) => error.code === "operations_disabled"
  );
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: "not-inspected-while-disabled",
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: disabledDeps,
    }),
    (error: CapacityChangeError) => error.code === "operations_disabled"
  );
  assert.deepEqual(calls, []);
});

test("confirm submits a payment-gated, idempotent Stripe increase", async () => {
  const baseDeps = depsFixture();
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: baseDeps,
  });
  const calls: Array<{ kind: string; value: unknown }> = [];
  const updated = {
    ...subscriptionFixture(),
    pending_update: { expires_at: PERIOD_END },
    latest_invoice: {
      id: "in-proration",
      hosted_invoice_url: "https://invoice.stripe.test/in-proration",
      confirmation_secret: { client_secret: "pi_secret" },
    },
  } as unknown as Stripe.Subscription;
  const result = await confirmCapacityIncrease({
    account: accountFixture(),
    previewToken: preview.previewToken,
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({ calls, updated }),
  });

  assert.deepEqual(result, {
    status: "payment_required",
    subscriptionId: "sub-1",
    invoiceId: "in-proration",
    paymentUrl: "https://invoice.stripe.test/in-proration",
    paymentClientSecret: "pi_secret",
    entitlementStatus: "pending_webhook",
  });
  const update = calls.find((call) => call.kind === "update")!.value as {
    id: string;
    params: Stripe.SubscriptionUpdateParams;
    options: Stripe.RequestOptions;
  };
  assert.deepEqual(update.params.items, [
    { price: "price-concurrency-10", quantity: 1 },
  ]);
  assert.equal(update.params.payment_behavior, "pending_if_incomplete");
  assert.equal(update.params.proration_behavior, "always_invoice");
  assert.equal(update.params.proration_date, NOW.getTime() / 1_000);
  assert.equal(
    update.options.idempotencyKey,
    `capacity-change:account-1:${ATTEMPT_ID}`
  );
});

test("confirm rejects stale and decrease previews before Stripe mutation", async () => {
  const increasePreview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: depsFixture(),
  });
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: increasePreview.previewToken,
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({
        subscription: subscriptionFixture({ addOnQuantity: 2 }),
      }),
    }),
    (error: CapacityChangeError) => error.code === "preview_stale"
  );

  const decreasePreview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 0,
      effectiveAction: "cancel",
    },
    signingSecret: "secret",
    deps: depsFixture({
      subscription: subscriptionFixture({ addOnQuantity: 1 }),
    }),
  });
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: decreasePreview.previewToken,
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({
        subscription: subscriptionFixture({ addOnQuantity: 1 }),
      }),
    }),
    (error: CapacityChangeError) => error.code === "schedule_required"
  );
});

test("confirm reaches Stripe idempotency when retrying a pending update", async () => {
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: depsFixture(),
  });
  const calls: Array<{ kind: string; value: unknown }> = [];
  const pendingSubscription = subscriptionFixture({ pending: true });
  await confirmCapacityIncrease({
    account: accountFixture(),
    previewToken: preview.previewToken,
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({
      subscription: pendingSubscription,
      updated: pendingSubscription,
      calls,
    }),
  });
  assert.equal(calls.filter((call) => call.kind === "update").length, 1);
});

test("confirm treats an already-applied increase as a harmless retry", async () => {
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
    deps: depsFixture(),
  });
  const calls: Array<{ kind: string; value: unknown }> = [];
  const result = await confirmCapacityIncrease({
    account: accountFixture(),
    previewToken: preview.previewToken,
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({
      subscription: subscriptionFixture({ addOnQuantity: 1 }),
      calls,
    }),
  });
  assert.equal(result.status, "submitted");
  assert.equal(
    calls.some((call) => call.kind === "update"),
    false
  );
});
