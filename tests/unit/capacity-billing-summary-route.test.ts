import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { BillingAccount } from "../../lib/billing/accounts";
import type { CapacityBillingSummaryV2 } from "../../lib/billing/capacity-summary-types";

async function loadCapacityBillingSummaryRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/billing/capacity/route");
}

const personalScopeResolution = {
  ok: true as const,
  scope: {
    kind: "personal" as const,
    userId: "user-1",
    productTeamId: null,
  },
};

const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  tier: "pro",
  period_anchor: "2026-08-16",
  subscription_checkout_generation: 0,
  status: "active",
};

const summary: CapacityBillingSummaryV2 = {
  version: "capacity_v2",
  asOf: "2026-08-16T12:00:00.000Z",
  billingOperationsEnabled: false,
  account: {
    id: "account-1",
    scope: "personal",
    displayName: "Personal workspace",
    status: "active",
    canManageBilling: true,
  },
  plan: {
    ref: "pro",
    name: "Pro",
    offerKind: "individual",
    interval: "month",
    recurringAmountCents: 2_000,
    renewsAt: "2026-09-16T00:00:00.000Z",
    cancelsAt: null,
    namedUserLimit: 1,
  },
  concurrency: {
    active: 1,
    included: 5,
    addOn: 0,
    limit: 5,
    wouldBlock: false,
  },
  retainedData: {
    logicalBytes: "0",
    includedBytes: "1000000000",
    addOnBytes: "0",
    limitBytes: "1000000000",
    percentUsed: 0,
    wouldBlock: false,
    overLimitAfterPendingChange: false,
  },
  hostedUsage: {
    includedRemainingCents: 500,
    purchasedRemainingCents: 0,
    openReservationsCents: 0,
    spendableCents: 500,
    grantResetsAt: "2026-09-16T00:00:00.000Z",
    purchasesFrozen: false,
  },
  addOns: [],
  openReservations: [],
  recentCosts: [],
};

test("GET /api/billing/capacity requires authentication before scope lookup", async () => {
  const { createCapacityBillingSummaryGetHandler } =
    await loadCapacityBillingSummaryRoute();
  let scopeCalls = 0;
  const handler = createCapacityBillingSummaryGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    resolveProductResourceScope: async () => {
      scopeCalls += 1;
      return personalScopeResolution;
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity")
  );

  assert.equal(response.status, 401);
  assert.equal(scopeCalls, 0);
});

test("GET /api/billing/capacity returns the canonical personal summary", async () => {
  const { createCapacityBillingSummaryGetHandler } =
    await loadCapacityBillingSummaryRoute();
  let loadedInput: unknown;
  const handler = createCapacityBillingSummaryGetHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    getOrCreateBillingAccount: async (scope) => {
      assert.deepEqual(scope, personalScopeResolution.scope);
      return account;
    },
    getBillingBalance: async (accountId) => {
      assert.equal(accountId, account.id);
      return { includedCents: 500, purchasedCents: 0, totalCents: 500 };
    },
    areCapacityBillingOperationsEnabled: () => false,
    loadCapacityBillingSummary: async (input) => {
      loadedInput = input;
      return summary;
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), summary);
  assert.deepEqual(loadedInput, {
    accountId: "account-1",
    balance: { includedCents: 500, purchasedCents: 0, totalCents: 500 },
    scope: "personal",
    canManageBilling: true,
    billingOperationsEnabled: false,
  });
});

test("GET /api/billing/capacity lets team viewers read but not manage", async () => {
  const { createCapacityBillingSummaryGetHandler } =
    await loadCapacityBillingSummaryRoute();
  let canManageBilling: boolean | undefined;
  const handler = createCapacityBillingSummaryGetHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async () => ({
      ok: true,
      scope: {
        kind: "team",
        userId: "viewer-1",
        productTeamId: "team-1",
      },
      capabilities: new Set(),
    }),
    getOrCreateBillingAccount: async () => ({
      ...account,
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    }),
    getBillingBalance: async () => ({
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    }),
    areCapacityBillingOperationsEnabled: () => false,
    loadCapacityBillingSummary: async (input) => {
      canManageBilling = input.canManageBilling;
      return {
        ...summary,
        account: {
          ...summary.account,
          scope: "team",
          canManageBilling: input.canManageBilling,
        },
      };
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity")
  );

  assert.equal(response.status, 200);
  assert.equal(canManageBilling, false);
  assert.equal((await response.json()).account.canManageBilling, false);
});

test("GET /api/billing/capacity returns a generic failure", async (context) => {
  const { createCapacityBillingSummaryGetHandler } =
    await loadCapacityBillingSummaryRoute();
  const logged = context.mock.method(console, "error", () => {});
  const handler = createCapacityBillingSummaryGetHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    getOrCreateBillingAccount: async () => account,
    getBillingBalance: async () => {
      throw new Error("secret provider detail");
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity")
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Billing summary is unavailable",
  });
  assert.equal(logged.mock.callCount(), 1);
});
