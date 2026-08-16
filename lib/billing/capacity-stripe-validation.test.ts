import assert from "node:assert/strict";
import type Stripe from "stripe";
import { test } from "vitest";
import type { BillingAccount } from "./accounts";
import { signCapacityChangePreview } from "./capacity-change-contract";
import {
  CapacityChangeError,
  defaultCapacityStripeChangeDeps,
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
    current_period_start: NOW.getTime() / 1_000,
    current_period_end: PERIOD_END,
  } as unknown as Stripe.SubscriptionItem;
}

function subscriptionFixture(
  input: {
    addOnQuantity?: number;
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
        lookupKey: "capacity_v2_concurrency_10_monthly",
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
    lines: { data: [] },
  } as unknown as Stripe.Invoice;
}

function depsFixture(
  input: {
    subscription?: Stripe.Subscription;
    invoice?: Stripe.Invoice;
    calls?: Array<{ kind: string; value: unknown }>;
    now?: Date;
  } = {}
): CapacityStripeChangeDeps {
  const calls = input.calls ?? [];
  const subscription = input.subscription ?? subscriptionFixture();
  return {
    capacityBillingOperationsEnabled: () => true,
    now: () => input.now ?? NOW,
    retrieveSubscription: async (id) => {
      calls.push({ kind: "retrieve", value: id });
      return subscription;
    },
    resolvePriceId: async (lookupKey) => {
      calls.push({ kind: "price", value: lookupKey });
      return "price-concurrency-10";
    },
    createInvoicePreview: async (params) => {
      calls.push({ kind: "preview", value: params });
      return input.invoice ?? previewInvoice();
    },
    updateSubscription: async (id, params, options) => {
      calls.push({ kind: "update", value: { id, params, options } });
      return subscription;
    },
  };
}

const INCREASE_REQUEST = {
  lookupKey: "capacity_v2_concurrency_10_monthly",
  quantity: 1,
  effectiveAction: "increase" as const,
};

test("default Stripe dependencies fail before Stripe initialization", () => {
  const originalFlag = process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  try {
    delete process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
    assert.throws(
      () => defaultCapacityStripeChangeDeps(),
      (error: CapacityChangeError) => error.code === "operations_disabled"
    );
  } finally {
    if (originalFlag === undefined) {
      delete process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
    } else {
      process.env.CAPACITY_BILLING_OPERATIONS_ENABLED = originalFlag;
    }
    if (originalKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalKey;
    }
  }
});

test("preview rejects inconsistent account and Stripe subscription states", async () => {
  const invalidQuantity = subscriptionFixture({ addOnQuantity: 1 });
  invalidQuantity.items.data[1]!.quantity = 0;
  const missingLookup = subscriptionFixture();
  missingLookup.items.data[0]!.price.lookup_key = null;
  const unknownPrice = subscriptionFixture();
  unknownPrice.items.data[0]!.price.lookup_key = "capacity_v2_unknown";
  const duplicatePrice = subscriptionFixture();
  duplicatePrice.items.data.push(
    item({
      id: "si-plan-duplicate",
      priceId: "price-pro-duplicate",
      lookupKey: "capacity_v2_pro_monthly",
    })
  );
  const inactive = subscriptionFixture();
  inactive.status = "canceled";
  const missingPlan = subscriptionFixture();
  missingPlan.items.data = [];
  const multiplePlanQuantity = subscriptionFixture();
  multiplePlanQuantity.items.data[0]!.quantity = 2;

  const cases: Array<{
    account?: BillingAccount;
    subscription: Stripe.Subscription;
    code: string;
  }> = [
    { subscription: invalidQuantity, code: "invalid_subscription" },
    { subscription: missingLookup, code: "invalid_subscription" },
    { subscription: unknownPrice, code: "invalid_subscription" },
    { subscription: duplicatePrice, code: "invalid_subscription" },
    { subscription: inactive, code: "subscription_inactive" },
    {
      subscription: subscriptionFixture({ pending: true }),
      code: "change_pending",
    },
    { subscription: missingPlan, code: "invalid_subscription" },
    { subscription: multiplePlanQuantity, code: "invalid_subscription" },
    {
      account: accountFixture({ plan_code: "plus" }),
      subscription: subscriptionFixture(),
      code: "subscription_mismatch",
    },
    {
      subscription: { ...subscriptionFixture(), id: "sub-other" },
      code: "subscription_mismatch",
    },
  ];

  for (const entry of cases) {
    await assert.rejects(
      previewCapacityChange({
        account: entry.account ?? accountFixture(),
        request: INCREASE_REQUEST,
        signingSecret: "secret",
        deps: depsFixture({ subscription: entry.subscription }),
      }),
      (error: CapacityChangeError) => error.code === entry.code
    );
  }
});

test("preview rejects unavailable accounts before Stripe access", async () => {
  for (const account of [
    accountFixture({ status: "past_due" }),
    accountFixture({ stripe_customer_id: null }),
    accountFixture({ stripe_subscription_id: null }),
  ]) {
    const calls: Array<{ kind: string; value: unknown }> = [];
    await assert.rejects(
      previewCapacityChange({
        account,
        request: INCREASE_REQUEST,
        signingSecret: "secret",
        deps: depsFixture({ calls }),
      }),
      (error: CapacityChangeError) =>
        error.code === "account_inactive" ||
        error.code === "subscription_required"
    );
    assert.deepEqual(calls, []);
  }
});

test("preview rejects unsafe, unchanged, and provider-incompatible changes", async () => {
  const missingPeriod = subscriptionFixture({ addOnQuantity: 1 });
  Reflect.deleteProperty(missingPeriod.items.data[1]!, "current_period_end");
  const manualCollection = subscriptionFixture();
  manualCollection.collection_method = "send_invoice";
  const cases: Array<{
    subscription: Stripe.Subscription;
    quantity: number;
    action: "increase" | "cancel";
    code: string;
    invoice?: Stripe.Invoice;
  }> = [
    {
      subscription: subscriptionFixture({ addOnQuantity: 1 }),
      quantity: 1,
      action: "increase",
      code: "quantity_unchanged",
    },
    {
      subscription: subscriptionFixture(),
      quantity: Number.MAX_SAFE_INTEGER,
      action: "increase",
      code: "quantity_too_large",
    },
    {
      subscription: missingPeriod,
      quantity: 0,
      action: "cancel",
      code: "invalid_subscription",
    },
    {
      subscription: manualCollection,
      quantity: 1,
      action: "increase",
      code: "payment_method_unsupported",
    },
    {
      subscription: subscriptionFixture(),
      quantity: 1,
      action: "increase",
      code: "currency_mismatch",
      invoice: { ...previewInvoice(), currency: "eur" },
    },
    {
      subscription: subscriptionFixture({
        addOnQuantity: 1,
        addOnPriceId: "price-not-canonical",
      }),
      quantity: 2,
      action: "increase",
      code: "catalog_mismatch",
    },
  ];

  for (const entry of cases) {
    await assert.rejects(
      previewCapacityChange({
        account: accountFixture(),
        request: {
          ...INCREASE_REQUEST,
          quantity: entry.quantity,
          effectiveAction: entry.action,
        },
        signingSecret: "secret",
        deps: depsFixture({
          subscription: entry.subscription,
          invoice: entry.invoice,
        }),
      }),
      (error: CapacityChangeError) => error.code === entry.code
    );
  }
});

test("preview handles invoice-item prorations and never shows a negative due-now amount", async () => {
  const invoice = {
    ...previewInvoice(),
    automatic_tax: { enabled: false, status: null },
    lines: {
      data: [
        {
          amount: -50,
          taxes: [{ amount: 5, tax_behavior: "inclusive" }],
          parent: {
            subscription_item_details: null,
            invoice_item_details: { proration: true },
          },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: INCREASE_REQUEST,
    signingSecret: "secret",
    deps: depsFixture({ invoice }),
  });
  assert.equal(preview.amountDueNowCents, 0);
  assert.equal(preview.taxStatus, "not_calculated");
});

test("confirmation rejects invalid, expired, and cross-account previews", async () => {
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: "not-signed",
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture(),
    }),
    (error: CapacityChangeError) => error.code === "preview_invalid"
  );

  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: INCREASE_REQUEST,
    signingSecret: "secret",
    deps: depsFixture(),
  });
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: preview.previewToken,
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({ now: new Date("2026-08-16T12:11:00.000Z") }),
    }),
    (error: CapacityChangeError) => error.code === "preview_expired"
  );
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture({ id: "account-other" }),
      previewToken: preview.previewToken,
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture(),
    }),
    (error: CapacityChangeError) => error.code === "preview_scope_mismatch"
  );
});

test("confirmation updates an existing capacity item", async () => {
  const subscription = subscriptionFixture({ addOnQuantity: 1 });
  const preview = await previewCapacityChange({
    account: accountFixture(),
    request: { ...INCREASE_REQUEST, quantity: 2 },
    signingSecret: "secret",
    deps: depsFixture({ subscription }),
  });
  const calls: Array<{ kind: string; value: unknown }> = [];
  await confirmCapacityIncrease({
    account: accountFixture(),
    previewToken: preview.previewToken,
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
    deps: depsFixture({ subscription, calls }),
  });
  const update = calls.find((call) => call.kind === "update")!.value as {
    params: Stripe.SubscriptionUpdateParams;
  };
  assert.deepEqual(update.params.items, [{ id: "si-addon", quantity: 2 }]);
});

test("confirmation rejects a signed payload that is not an increase", async () => {
  const token = signCapacityChangePreview(
    {
      version: 1,
      accountId: "account-1",
      subscriptionId: "sub-1",
      subscriptionItemId: "si-addon",
      lookupKey: "capacity_v2_concurrency_10_monthly",
      currentQuantity: 1,
      targetQuantity: 1,
      action: "increase",
      prorationDate: NOW.getTime() / 1_000,
      effectiveAt: NOW.getTime() / 1_000,
      expiresAt: NOW.getTime() / 1_000 + 600,
    },
    "secret"
  );
  await assert.rejects(
    confirmCapacityIncrease({
      account: accountFixture(),
      previewToken: token,
      attemptId: ATTEMPT_ID,
      signingSecret: "secret",
      deps: depsFixture({
        subscription: subscriptionFixture({ addOnQuantity: 1 }),
      }),
    }),
    (error: CapacityChangeError) => error.code === "preview_invalid"
  );
});
