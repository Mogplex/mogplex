import assert from "node:assert/strict";
import test from "node:test";
import type { BillingAccount } from "../../lib/billing/accounts";

async function loadTokenUsage() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/billing/token-usage");
}

const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: "cus_1",
  stripe_subscription_id: null,
  tier: "free",
  period_anchor: null,
  subscription_checkout_generation: 0,
  status: "active",
  created_at: "2026-08-01T00:00:00.000Z",
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    aiCallId: "call-1",
    userId: "user-1",
    model: "anthropic/claude-sonnet-4",
    costUsd: 0.0834,
    completedAt: "2026-08-04T20:00:00.000Z",
    generationIds: ["gen-1", "gen-2"],
    metadata: null,
    ...overrides,
  };
}

test("token costs preserve Gateway's eight-decimal USD precision", async () => {
  const { tokenCostUsdToCostUnits } = await loadTokenUsage();
  assert.equal(tokenCostUsdToCostUnits(25), 2_500_000_000);
  assert.equal(tokenCostUsdToCostUnits(0.0834), 8_340_000);
  assert.equal(tokenCostUsdToCostUnits(0.005), 500_000);
  assert.equal(tokenCostUsdToCostUnits(0.004), 400_000);
  assert.equal(tokenCostUsdToCostUnits(0.00000001), 1);
  assert.equal(tokenCostUsdToCostUnits(Number.NaN), 0);
});

test("$25 of Gateway inference costs exactly $25 of inference credit", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let postedCostUnits = 0;
  const result = await meterReconciledTokenUsage(input({ costUsd: 25 }), {
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => account,
    accrueTokenUsage: async (accrual) => {
      postedCostUnits = accrual.costUnits;
      return {
        posted: true,
        debitedCents: 2_500,
        remainderCostUnits: 0,
      };
    },
  });

  assert.equal(postedCostUnits, 2_500_000_000);
  assert.equal(result.amountCents, 2_500);
});

test("zero-cost calls never read or write billing data", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let calls = 0;
  const result = await meterReconciledTokenUsage(input({ costUsd: 0 }), {
    loadExplicitPlatformAccess: async () => {
      calls += 1;
      throw new Error("should not load access");
    },
    findBillingAccountForScope: async () => {
      calls += 1;
      return account;
    },
    accrueTokenUsage: async () => {
      calls += 1;
      throw new Error("should not post");
    },
  });

  assert.deepEqual(result, {
    metered: false,
    reason: "zero_cost",
    amountCents: 0,
    costUnits: 0,
  });
  assert.equal(calls, 0);
});

test("personal usage posts an idempotent token debit", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  const scopes: unknown[] = [];
  const accruals: unknown[] = [];
  const result = await meterReconciledTokenUsage(input(), {
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async (scope) => {
      scopes.push(scope);
      return account;
    },
    accrueTokenUsage: async (accrual) => {
      accruals.push(accrual);
      return {
        posted: true,
        debitedCents: 8,
        remainderCostUnits: 340_000,
      };
    },
  });

  assert.deepEqual(scopes, [
    { kind: "personal", userId: "user-1", productTeamId: null },
  ]);
  assert.deepEqual(accruals, [
    {
      accountId: "account-1",
      costUnits: 8_340_000,
      sourceRef: "tok:call-1",
      period: "2026-08",
      metadata: {
        ai_call_id: "call-1",
        gateway_generation_ids: ["gen-1", "gen-2"],
        model: "anthropic/claude-sonnet-4",
        cost_usd: 0.0834,
      },
    },
  ]);
  assert.deepEqual(result, {
    metered: true,
    reason: "posted",
    amountCents: 8,
    costUnits: 8_340_000,
  });
});

test("team metadata charges the team account", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let scope: unknown;
  await meterReconciledTokenUsage(
    input({ metadata: { product_team_id: "team-1" } }),
    {
      loadExplicitPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      findBillingAccountForScope: async (value) => {
        scope = value;
        return { ...account, owner_type: "team", product_team_id: "team-1" };
      },
      accrueTokenUsage: async () => ({
        posted: false,
        debitedCents: 8,
        remainderCostUnits: 340_000,
      }),
    }
  );

  assert.deepEqual(scope, {
    kind: "team",
    userId: "user-1",
    productTeamId: "team-1",
  });
});

test("pre-account calls are not accrued", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let accrualCalls = 0;
  const deps = {
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => account,
    accrueTokenUsage: async () => {
      accrualCalls += 1;
      throw new Error("should not post");
    },
  };

  const beforeAccount = await meterReconciledTokenUsage(
    input({ completedAt: "2026-07-31T23:59:59.000Z" }),
    deps
  );

  assert.equal(beforeAccount.reason, "before_billing_account");
  assert.equal(accrualCalls, 0);
});

test("sub-cent calls are accrued instead of discarded", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  const accruals: unknown[] = [];
  const result = await meterReconciledTokenUsage(input({ costUsd: 0.004 }), {
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => account,
    accrueTokenUsage: async (accrual) => {
      accruals.push(accrual);
      return {
        posted: true,
        debitedCents: 0,
        remainderCostUnits: 400_000,
      };
    },
  });

  assert.equal(result.reason, "posted");
  assert.equal(result.amountCents, 0);
  assert.equal(result.costUnits, 400_000);
  assert.equal((accruals[0] as { costUnits: number }).costUnits, 400_000);
});

test("explicitly allowlisted users are not debited from funded accounts", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let billingCalls = 0;
  const result = await meterReconciledTokenUsage(input(), {
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: true,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => {
      billingCalls += 1;
      return account;
    },
    accrueTokenUsage: async () => {
      billingCalls += 1;
      throw new Error("should not post");
    },
  });

  assert.deepEqual(result, {
    metered: false,
    reason: "allowlisted",
    amountCents: 0,
    costUnits: 8_340_000,
  });
  assert.equal(billingCalls, 0);
});
