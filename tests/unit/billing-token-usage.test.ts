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

test("token costs round to whole cents without a minimum charge", async () => {
  const { tokenCostUsdToCents } = await loadTokenUsage();
  assert.equal(tokenCostUsdToCents(0.0834), 8);
  assert.equal(tokenCostUsdToCents(0.005), 1);
  assert.equal(tokenCostUsdToCents(0.004), 0);
  assert.equal(tokenCostUsdToCents(Number.NaN), 0);
});

test("billing-disabled installs never read or write billing data", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let calls = 0;
  const result = await meterReconciledTokenUsage(input(), {
    isBillingEnabled: () => false,
    findBillingAccountForScope: async () => {
      calls += 1;
      return account;
    },
    postBillingUsageDebit: async () => {
      calls += 1;
      throw new Error("should not post");
    },
  });

  assert.deepEqual(result, {
    metered: false,
    reason: "billing_disabled",
    amountCents: 8,
  });
  assert.equal(calls, 0);
});

test("personal usage posts an idempotent token debit", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  const scopes: unknown[] = [];
  const debits: unknown[] = [];
  const result = await meterReconciledTokenUsage(input(), {
    isBillingEnabled: () => true,
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async (scope) => {
      scopes.push(scope);
      return account;
    },
    postBillingUsageDebit: async (debit) => {
      debits.push(debit);
      return {
        posted: true,
        debitedCents: 8,
        includedDebitedCents: 0,
        purchasedDebitedCents: 8,
      };
    },
  });

  assert.deepEqual(scopes, [
    { kind: "personal", userId: "user-1", productTeamId: null },
  ]);
  assert.deepEqual(debits, [
    {
      accountId: "account-1",
      amountCents: 8,
      kind: "usage_tokens",
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
  });
});

test("team metadata charges the team account", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let scope: unknown;
  await meterReconciledTokenUsage(
    input({ metadata: { product_team_id: "team-1" } }),
    {
      isBillingEnabled: () => true,
      loadExplicitPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      findBillingAccountForScope: async (value) => {
        scope = value;
        return { ...account, owner_type: "team", product_team_id: "team-1" };
      },
      postBillingUsageDebit: async () => ({
        posted: false,
        debitedCents: 0,
        includedDebitedCents: 0,
        purchasedDebitedCents: 0,
      }),
    }
  );

  assert.deepEqual(scope, {
    kind: "team",
    userId: "user-1",
    productTeamId: "team-1",
  });
});

test("pre-account calls and sub-cent calls are not debited", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let debitCalls = 0;
  const deps = {
    isBillingEnabled: () => true,
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => account,
    postBillingUsageDebit: async () => {
      debitCalls += 1;
      throw new Error("should not post");
    },
  };

  const beforeAccount = await meterReconciledTokenUsage(
    input({ completedAt: "2026-07-31T23:59:59.000Z" }),
    deps
  );
  const belowOneCent = await meterReconciledTokenUsage(
    input({ costUsd: 0.004 }),
    deps
  );

  assert.equal(beforeAccount.reason, "before_billing_account");
  assert.equal(belowOneCent.reason, "below_one_cent");
  assert.equal(debitCalls, 0);
});

test("explicitly allowlisted users are not debited from funded accounts", async () => {
  const { meterReconciledTokenUsage } = await loadTokenUsage();
  let billingCalls = 0;
  const result = await meterReconciledTokenUsage(input(), {
    isBillingEnabled: () => true,
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: true,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => {
      billingCalls += 1;
      return account;
    },
    postBillingUsageDebit: async () => {
      billingCalls += 1;
      throw new Error("should not post");
    },
  });

  assert.deepEqual(result, {
    metered: false,
    reason: "allowlisted",
    amountCents: 8,
  });
  assert.equal(billingCalls, 0);
});
