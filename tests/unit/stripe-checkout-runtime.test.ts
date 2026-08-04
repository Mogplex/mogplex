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
    listProducts: () => {
      throw new Error("unused");
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
      listProducts: () => {
        throw new Error("unused");
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
    createCustomer: async () => {
      throw new Error("unused");
    },
    listProducts: () => paginateProducts(),
    updateAccountCustomer: async () => {
      throw new Error("unused");
    },
  });

  assert.equal(productId, "prod_100");
});

test("subscription checkout idempotency changes after a completed billing period", async () => {
  const { subscriptionCheckoutIdempotencyKey } = await loadCheckoutRuntime();

  assert.equal(
    subscriptionCheckoutIdempotencyKey(accountFixture(), "pro_monthly"),
    "billing-subscribe:acct-1:new:pro_monthly"
  );
  assert.equal(
    subscriptionCheckoutIdempotencyKey(
      accountFixture({ period_anchor: "2026-08-01" }),
      "pro_monthly"
    ),
    "billing-subscribe:acct-1:2026-08-01:pro_monthly"
  );
});
