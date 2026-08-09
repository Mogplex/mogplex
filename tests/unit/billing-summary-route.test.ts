import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadBillingSummaryRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/billing/route");
}

const personalScopeResolution = {
  ok: true as const,
  scope: {
    kind: "personal" as const,
    userId: "user-1",
    productTeamId: null,
  },
};

test("GET /api/billing requires authentication even when Stripe is disabled", async () => {
  const { createBillingSummaryGetHandler } = await loadBillingSummaryRoute();
  let scopeResolutionCalls = 0;
  const handler = createBillingSummaryGetHandler({
    isBillingEnabled: () => false,
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    resolveProductResourceScope: async () => {
      scopeResolutionCalls += 1;
      return personalScopeResolution;
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing")
  );

  assert.equal(response.status, 401);
  assert.equal(scopeResolutionCalls, 0);
});

test("GET /api/billing reports disabled operations and zero balance without an account", async () => {
  const { createBillingSummaryGetHandler } = await loadBillingSummaryRoute();
  const handler = createBillingSummaryGetHandler({
    isBillingEnabled: () => false,
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    findBillingAccountForScope: async () => null,
    getBillingBalance: async () => {
      throw new Error("must not be called when no billing account exists");
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    billingOperationsEnabled: false,
    canManageBilling: true,
    tier: "free",
    status: "active",
    hasSubscription: false,
    hasStripeCustomer: false,
    balance: { includedCents: 0, purchasedCents: 0, totalCents: 0 },
  });
});
