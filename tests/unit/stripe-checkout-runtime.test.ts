import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { BillingAccount } from "../../lib/billing/accounts";

async function loadCheckoutRuntime() {
  return import("../../lib/billing/stripe-checkout");
}

function accountFixture(
  overrides: Partial<BillingAccount> = {}
): BillingAccount {
  return {
    id: "acct-1",
    owner_type: "team",
    owner_user_id: null,
    product_team_id: "team-1",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    tier: "free",
    period_anchor: null,
    subscription_checkout_generation: 0,
    status: "active",
    ...overrides,
  };
}

function customerDepsFixture(overrides: Record<string, unknown> = {}) {
  return {
    createCustomer: async () => ({ id: "cus_new" }),
    updateAccountCustomer: async () => {},
    retrieveCustomer: async () => null,
    updateCustomerEmail: async () => {},
    ...overrides,
  };
}

test("customer creation uses one stable idempotency key per billing account", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  const calls: Array<{ params: unknown; options: Stripe.RequestOptions }> = [];
  const updates: Array<{ id: string; customerId: string }> = [];

  const customerId = await ensureStripeCustomer(
    accountFixture(),
    "charlie@example.com",
    customerDepsFixture({
      createCustomer: async (
        params: Stripe.CustomerCreateParams,
        options?: Stripe.RequestOptions
      ) => {
        calls.push({ params, options: options ?? {} });
        return { id: "cus_new" };
      },
      updateAccountCustomer: async (id: string, stripeCustomerId: string) => {
        updates.push({ id, customerId: stripeCustomerId });
      },
    })
  );

  assert.equal(customerId, "cus_new");
  assert.equal(calls[0]?.options.idempotencyKey, "billing-customer:acct-1");
  // Email is pinned at creation so Checkout locks its email field to the
  // login email instead of letting Link autofill an unrelated account.
  assert.equal(
    (calls[0]?.params as Stripe.CustomerCreateParams).email,
    "charlie@example.com"
  );
  assert.deepEqual(updates, [{ id: "acct-1", customerId: "cus_new" }]);
});

test("existing Stripe customers with an email are left untouched", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  let mutated = false;
  const customerId = await ensureStripeCustomer(
    accountFixture({ stripe_customer_id: "cus_existing" }),
    "charlie@example.com",
    customerDepsFixture({
      createCustomer: async () => {
        mutated = true;
        return { id: "cus_wrong" };
      },
      updateAccountCustomer: async () => {
        mutated = true;
      },
      retrieveCustomer: async () => ({ email: "billing@example.com" }),
      updateCustomerEmail: async () => {
        mutated = true;
      },
    })
  );

  assert.equal(customerId, "cus_existing");
  assert.equal(mutated, false);
});

test("existing Stripe customers missing an email get the actor's backfilled", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  const emailUpdates: Array<{ customerId: string; email: string }> = [];
  const customerId = await ensureStripeCustomer(
    accountFixture({ stripe_customer_id: "cus_existing" }),
    "charlie@example.com",
    customerDepsFixture({
      retrieveCustomer: async () => ({ email: null }),
      updateCustomerEmail: async (targetId: string, email: string) => {
        emailUpdates.push({ customerId: targetId, email });
      },
    })
  );

  assert.equal(customerId, "cus_existing");
  assert.deepEqual(emailUpdates, [
    { customerId: "cus_existing", email: "charlie@example.com" },
  ]);
});

test("no actor email skips the customer lookup entirely", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  let looked = false;
  const customerId = await ensureStripeCustomer(
    accountFixture({ stripe_customer_id: "cus_existing" }),
    null,
    customerDepsFixture({
      retrieveCustomer: async () => {
        looked = true;
        return { email: null };
      },
    })
  );

  assert.equal(customerId, "cus_existing");
  assert.equal(looked, false);
});

test("top-up product lookup follows Stripe pagination beyond 100 products", async () => {
  const { resolveTopupProductId } = await loadCheckoutRuntime();
  const products: Array<{ id: string; metadata: Record<string, string> }> =
    Array.from({ length: 101 }, (_, index) => {
      const metadata: Record<string, string> = {};
      if (index === 100) metadata.mogplex_key = "usage_topup";
      return { id: `prod_${index}`, metadata };
    });
  async function* paginateProducts() {
    yield* products;
  }

  const productId = await resolveTopupProductId({
    listProducts: () => paginateProducts(),
  });

  assert.equal(productId, "prod_100");
});

test("top-up product lookup is shared across checkout requests", async () => {
  const { resolveTopupProductId } = await loadCheckoutRuntime();
  let calls = 0;
  const deps = {
    async *listProducts() {
      calls += 1;
      yield { id: "prod_topup", metadata: { mogplex_key: "usage_topup" } };
    },
  };

  assert.equal(await resolveTopupProductId(deps), "prod_topup");
  assert.equal(await resolveTopupProductId(deps), "prod_topup");
  assert.equal(calls, 1);
});

test("subscription checkout idempotency advances only with cancellation generation", async () => {
  const { subscriptionCheckoutIdempotencyKey } = await loadCheckoutRuntime();

  assert.equal(
    subscriptionCheckoutIdempotencyKey(accountFixture()),
    "billing-subscribe:acct-1:0"
  );
  assert.equal(
    subscriptionCheckoutIdempotencyKey(
      accountFixture({
        tier: "free",
        period_anchor: "2026-08-01",
        updated_at: "2026-08-04T21:00:00.000Z",
        subscription_checkout_generation: 1,
      })
    ),
    "billing-subscribe:acct-1:1"
  );
  assert.equal(
    subscriptionCheckoutIdempotencyKey(
      accountFixture({
        status: "past_due",
        updated_at: "2026-08-04T22:00:00.000Z",
        subscription_checkout_generation: 1,
      })
    ),
    "billing-subscribe:acct-1:1"
  );
});

test("top-up checkout retries reuse an attempt-scoped idempotency key", async () => {
  const { TOPUP_INVOICE_CREATION, topupCheckoutIdempotencyKey } =
    await loadCheckoutRuntime();

  assert.deepEqual(TOPUP_INVOICE_CREATION, { enabled: true });

  assert.equal(
    topupCheckoutIdempotencyKey(
      "acct-1",
      "0198f3e8-9c41-4d40-8cb9-4afdfac76f01"
    ),
    "billing-topup:acct-1:0198f3e8-9c41-4d40-8cb9-4afdfac76f01"
  );
});

test("catalog price lookup rejects amount, currency, and interval drift", async () => {
  const { resolveCatalogPriceId } = await loadCheckoutRuntime();
  const matchingPlan = {
    id: "price_pro",
    active: true,
    unit_amount: 2000,
    currency: "usd",
    recurring: { interval: "month" as const },
  };

  assert.equal(
    await resolveCatalogPriceId("pro_monthly", async () => ({
      data: [matchingPlan],
    })),
    "price_pro"
  );
  for (const drifted of [
    { ...matchingPlan, unit_amount: 2500 },
    { ...matchingPlan, currency: "cad" },
    { ...matchingPlan, recurring: { interval: "year" as const } },
  ]) {
    await assert.rejects(
      resolveCatalogPriceId("pro_monthly", async () => ({ data: [drifted] })),
      /does not match the local catalog/
    );
  }
});

test("catalog price lookup validates one-time top-up prices", async () => {
  const { resolveCatalogPriceId } = await loadCheckoutRuntime();

  assert.equal(
    await resolveCatalogPriceId("topup_25", async () => ({
      data: [
        {
          id: "price_topup",
          active: true,
          unit_amount: 2500,
          currency: "usd",
          recurring: null,
        },
      ],
    })),
    "price_topup"
  );
});

test("catalog price lookup validates capacity hosted-usage presets", async () => {
  const { resolveCatalogPriceId } = await loadCheckoutRuntime();

  assert.equal(
    await resolveCatalogPriceId(
      "capacity_v2_hosted_usage_credit_25",
      async () => ({
        data: [
          {
            id: "price_hosted_usage",
            active: true,
            unit_amount: 2_500,
            currency: "usd",
            recurring: null,
          },
        ],
      })
    ),
    "price_hosted_usage"
  );
});

test("catalog price lookup validates capacity plans and add-ons", async () => {
  const { resolveCatalogPriceId } = await loadCheckoutRuntime();

  for (const [lookupKey, id, amountCents, interval] of [
    ["capacity_v2_max_annual", "price_max", 204000, "year"],
    ["capacity_v2_retained_data_10gb_monthly", "price_storage", 1500, "month"],
  ] as const) {
    assert.equal(
      await resolveCatalogPriceId(lookupKey, async () => ({
        data: [
          {
            id,
            active: true,
            unit_amount: amountCents,
            currency: "usd",
            recurring: { interval },
          },
        ],
      })),
      id
    );
  }
});
