import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { BillingAccount } from "../../lib/billing/accounts";

const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  tier: "free",
  period_anchor: null,
  subscription_checkout_generation: 0,
  status: "active",
  plan_code: null,
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
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/billing/capacity/plan/checkout/route");
}

test("Individual plan checkout authenticates and requires billing.manage", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  let scopeCalls = 0;
  const unauthenticated = createIndividualPlanCheckoutPostHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    resolveProductResourceScope: async () => {
      scopeCalls += 1;
      return scopeResolution;
    },
  });
  const unauthorizedResponse = await unauthenticated(
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
    })
  );
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(scopeCalls, 0);

  let requiredCapability: string | undefined;
  const forbidden = createIndividualPlanCheckoutPostHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async (input) => {
      requiredCapability = input.requiredCapability;
      return { ok: false, status: 403, error: "Forbidden" };
    },
  });
  const forbiddenResponse = await forbidden(
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
    })
  );
  assert.equal(forbiddenResponse.status, 403);
  assert.equal(requiredCapability, "billing.manage");
});

test("Individual plan checkout fails closed before account access", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  let touched = false;
  const handler = createIndividualPlanCheckoutPostHandler({
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
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode: "pro", interval: "month" }),
    })
  );
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test("Individual plan checkout rejects team scope before account creation", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  let touched = false;
  const handler = createIndividualPlanCheckoutPostHandler({
    requireUserId: async () => "owner-1",
    resolveProductResourceScope: async () => ({
      ok: true,
      scope: {
        kind: "team",
        userId: "owner-1",
        productTeamId: "team-1",
      },
      capabilities: new Set(["billing.manage"]),
    }),
    capacityBillingOperationsEnabled: () => true,
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
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode: "pro", interval: "month" }),
    })
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "self_service_unavailable");
  assert.equal(touched, false);
});

test("Individual plan checkout validates before loading an account", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  let touched = false;
  const handler = createIndividualPlanCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => {
      touched = true;
      return account;
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode: "business", interval: "month" }),
    })
  );
  assert.equal(response.status, 400);
  assert.equal(touched, false);
});

test("Individual plan checkout passes the scoped account and actor email", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  let serviceInput: unknown;
  const handler = createIndividualPlanCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    getActorEmail: async () => "owner@example.com",
    createIndividualPlanCheckout: async (input) => {
      serviceInput = input;
      return {
        status: "checkout_created",
        url: "https://checkout.stripe.test/cs-1",
        plan: {
          code: "max",
          name: "Max",
          interval: "year",
          amountCents: 204_000,
          currency: "usd",
          maxNamedUsers: 1,
        },
        entitlementStatus: "pending_webhook",
      };
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
      body: JSON.stringify({
        planCode: "max",
        interval: "year",
        returnPath: "/personal/settings?tab=billing",
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entitlementStatus, "pending_webhook");
  assert.deepEqual(serviceInput, {
    account,
    actorEmail: "owner@example.com",
    request: {
      planCode: "max",
      interval: "year",
      returnPath: "/personal/settings?tab=billing",
    },
  });
});

test("Individual plan checkout preserves safe errors and hides provider failures", async () => {
  const { createIndividualPlanCheckoutPostHandler } = await routeModule();
  const { CapacityPlanCheckoutError } =
    await import("../../lib/billing/capacity-plan-checkout");
  const base = {
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    getActorEmail: async () => null,
  };
  const safe = createIndividualPlanCheckoutPostHandler({
    ...base,
    createIndividualPlanCheckout: async () => {
      throw new CapacityPlanCheckoutError(
        "Individual plan checkout is not available for company workspaces.",
        409,
        "self_service_unavailable"
      );
    },
  });
  const internal = createIndividualPlanCheckoutPostHandler({
    ...base,
    createIndividualPlanCheckout: async () => {
      throw new Error("secret Stripe detail");
    },
  });
  const request = () =>
    new Request("https://example.com/api/billing/capacity/plan/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode: "pro", interval: "month" }),
    });
  const safeResponse = await safe(request());
  assert.equal(safeResponse.status, 409);
  assert.equal((await safeResponse.json()).code, "self_service_unavailable");
  const internalResponse = await internal(request());
  assert.equal(internalResponse.status, 500);
  assert.doesNotMatch(JSON.stringify(await internalResponse.json()), /secret/);
});
