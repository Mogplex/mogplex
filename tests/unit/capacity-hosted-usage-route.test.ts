import assert from "node:assert/strict";
import test from "node:test";
import type { BillingAccount } from "../../lib/billing/accounts";

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

const account: BillingAccount = {
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
};

const scopeResolution = {
  ok: true as const,
  scope: {
    kind: "personal" as const,
    userId: "user-1",
    productTeamId: null,
  },
};

async function routeModule() {
  return import("../../app/api/billing/hosted-usage/checkout/route");
}

test("hosted-usage checkout requires billing.manage", async () => {
  const { createHostedUsageCheckoutPostHandler } = await routeModule();
  let requiredCapability: string | undefined;
  const handler = createHostedUsageCheckoutPostHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async (input) => {
      requiredCapability = input.requiredCapability;
      return { ok: false, status: 403, error: "Forbidden" };
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/hosted-usage/checkout", {
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
  assert.equal(requiredCapability, "billing.manage");
});

test("hosted-usage checkout fails closed before account and profile access", async () => {
  const { createHostedUsageCheckoutPostHandler } = await routeModule();
  let touched = false;
  const handler = createHostedUsageCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => false,
    getOrCreateBillingAccount: async () => {
      touched = true;
      return account;
    },
    getActorEmail: async () => {
      touched = true;
      return null;
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/hosted-usage/checkout", {
      method: "POST",
      body: JSON.stringify({
        amountCents: 1_000,
        attemptId: ATTEMPT_ID,
      }),
    })
  );
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test("hosted-usage checkout validates before loading an account", async () => {
  const { createHostedUsageCheckoutPostHandler } = await routeModule();
  let touched = false;
  const handler = createHostedUsageCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => {
      touched = true;
      return account;
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/hosted-usage/checkout", {
      method: "POST",
      body: JSON.stringify({ amountCents: 99, attemptId: ATTEMPT_ID }),
    })
  );
  assert.equal(response.status, 400);
  assert.equal(touched, false);
});

test("hosted-usage checkout passes scoped account and actor email to the service", async () => {
  const { createHostedUsageCheckoutPostHandler } = await routeModule();
  let serviceInput: unknown;
  const handler = createHostedUsageCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    getActorEmail: async () => "owner@example.com",
    createHostedUsageCheckout: async (input) => {
      serviceInput = input;
      return {
        status: "checkout_created",
        url: "https://checkout.stripe.test/cs-1",
        creditCents: 2_500,
        subtotalCents: 2_500,
        currency: "usd",
        balanceStatus: "pending_webhook",
      };
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/hosted-usage/checkout", {
      method: "POST",
      body: JSON.stringify({
        preset: "capacity_v2_hosted_usage_credit_25",
        attemptId: ATTEMPT_ID,
        returnPath: "/personal/settings?tab=billing",
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "checkout_created",
    url: "https://checkout.stripe.test/cs-1",
    creditCents: 2_500,
    subtotalCents: 2_500,
    currency: "usd",
    balanceStatus: "pending_webhook",
  });
  assert.deepEqual(serviceInput, {
    account,
    actorEmail: "owner@example.com",
    request: {
      preset: "capacity_v2_hosted_usage_credit_25",
      attemptId: ATTEMPT_ID,
      returnPath: "/personal/settings?tab=billing",
    },
  });
});

test("hosted-usage checkout preserves safe errors and hides internal failures", async () => {
  const { createHostedUsageCheckoutPostHandler } = await routeModule();
  const { HostedUsagePurchaseError } =
    await import("../../lib/billing/capacity-hosted-usage");
  const base = {
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    getActorEmail: async () => null,
  };
  const safe = createHostedUsageCheckoutPostHandler({
    ...base,
    createHostedUsageCheckout: async () => {
      throw new HostedUsagePurchaseError(
        "This account cannot buy inference now. Contact support for help.",
        403,
        "purchases_frozen"
      );
    },
  });
  const internal = createHostedUsageCheckoutPostHandler({
    ...base,
    createHostedUsageCheckout: async () => {
      throw new Error("secret provider detail");
    },
  });
  const request = () =>
    new Request("https://example.com/api/billing/hosted-usage/checkout", {
      method: "POST",
      body: JSON.stringify({
        amountCents: 1_000,
        attemptId: ATTEMPT_ID,
      }),
    });
  const safeResponse = await safe(request());
  assert.equal(safeResponse.status, 403);
  assert.equal((await safeResponse.json()).code, "purchases_frozen");
  const internalResponse = await internal(request());
  assert.equal(internalResponse.status, 500);
  assert.doesNotMatch(JSON.stringify(await internalResponse.json()), /secret/);
});
