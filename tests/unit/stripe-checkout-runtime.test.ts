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
    status: "active",
    ...overrides,
  };
}

test("customer creation uses one stable idempotency key per billing account", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  const calls: Array<{ params: unknown; options: Stripe.RequestOptions }> = [];
  const updates: Array<{ id: string; customerId: string }> = [];

  const customerId = await ensureStripeCustomer(accountFixture(), {
    createCustomer: async (params, options) => {
      calls.push({ params, options: options ?? {} });
      return { id: "cus_new" };
    },
    updateAccountCustomer: async (id, stripeCustomerId) => {
      updates.push({ id, customerId: stripeCustomerId });
    },
  });

  assert.equal(customerId, "cus_new");
  assert.equal(calls[0]?.options.idempotencyKey, "billing-customer:acct-1");
  assert.deepEqual(updates, [{ id: "acct-1", customerId: "cus_new" }]);
});

test("existing Stripe customers do not call Stripe or update the account", async () => {
  const { ensureStripeCustomer } = await loadCheckoutRuntime();
  let called = false;
  const customerId = await ensureStripeCustomer(
    accountFixture({ stripe_customer_id: "cus_existing" }),
    {
      createCustomer: async () => {
        called = true;
        return { id: "cus_wrong" };
      },
      updateAccountCustomer: async () => {
        called = true;
      },
    }
  );

  assert.equal(customerId, "cus_existing");
  assert.equal(called, false);
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

test("subscription checkout idempotency serializes every plan for one billing period", async () => {
  const { subscriptionCheckoutIdempotencyKey } = await loadCheckoutRuntime();

  assert.equal(
    subscriptionCheckoutIdempotencyKey(accountFixture()),
    "billing-subscribe:acct-1:new"
  );
  assert.equal(
    subscriptionCheckoutIdempotencyKey(
      accountFixture({ tier: "pro", period_anchor: "2026-08-01" })
    ),
    "billing-subscribe:acct-1:2026-08-01"
  );
  assert.equal(
    subscriptionCheckoutIdempotencyKey(
      accountFixture({
        period_anchor: "2026-08-01",
        updated_at: "2026-08-04T21:00:00.000Z",
      })
    ),
    "billing-subscribe:acct-1:cancelled:2026-08-04T21:00:00.000Z"
  );
});

test("top-up checkout retries reuse an attempt-scoped idempotency key", async () => {
  const { topupCheckoutIdempotencyKey } = await loadCheckoutRuntime();

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
