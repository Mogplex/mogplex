/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import { describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BillingAccount } from "./accounts";
import {
  meterReconciledTokenUsage,
  type TokenUsageMeteringInput,
} from "./token-usage";

const input: TokenUsageMeteringInput = {
  aiCallId: "call-exempt",
  userId: "user-exempt",
  model: "anthropic/claude-sonnet-4",
  costUsd: 0.0834,
  completedAt: "2026-09-21T12:00:00.000Z",
  generationIds: ["gen-1", "gen-2"],
  metadata: { product_team_id: "team-1" },
};
const account = {
  id: "account-1",
  created_at: "2026-09-22T00:00:00.000Z",
  owner_type: "user",
  owner_user_id: "user-exempt",
  product_team_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  tier: "free",
  period_anchor: null,
  subscription_checkout_generation: 0,
  status: "active",
} satisfies BillingAccount;

function dependencies(allowPlatformAi = true) {
  return {
    loadExplicitPlatformAccess: vi.fn(async () => ({
      allowPlatformAi,
      allowPlatformSandbox: false,
    })),
    findBillingAccountForScope: vi.fn(async () => account),
    accrueTokenUsage: vi.fn(async () => ({
      posted: true,
      debitedCents: 8,
      remainderCostUnits: 340_000,
    })),
    recordProviderCost: vi.fn(async () => ({ posted: true })),
  };
}

describe("unbilled AI provider costs", () => {
  it("uses the production provider ledger recorder when no override is supplied", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const prior = Object.getOwnPropertyDescriptor(supabaseAdmin, "rpc");
    Object.defineProperty(supabaseAdmin, "rpc", {
      configurable: true,
      value: rpc,
    });
    try {
      await meterReconciledTokenUsage(input, {
        loadExplicitPlatformAccess: async () => ({
          allowPlatformAi: true,
          allowPlatformSandbox: false,
        }),
      });
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        "record_billing_provider_cost_event",
        expect.objectContaining({
          p_provider: "vercel-ai-gateway",
          p_provider_event_id: "tok:call-exempt",
          p_account: null,
          p_shared_overhead_category: "platform_operations",
          p_provider_cost_micros: "83400",
          p_retail_debit_micros: "0",
        })
      );
    } finally {
      if (prior) Object.defineProperty(supabaseAdmin, "rpc", prior);
      else Reflect.deleteProperty(supabaseAdmin, "rpc");
    }
  });

  it.each([
    [true, "allowlisted"],
    [false, "before_billing_account"],
  ] as const)(
    "records overhead for %s access without debiting credits",
    async (allowPlatformAi, reason) => {
      const deps = dependencies(allowPlatformAi);
      expect(await meterReconciledTokenUsage(input, deps)).toEqual({
        metered: false,
        reason,
        amountCents: 0,
        costUnits: 8_340_000,
      });
      expect(deps.accrueTokenUsage).not.toHaveBeenCalled();
      expect(deps.recordProviderCost).toHaveBeenCalledExactlyOnceWith({
        provider: "vercel-ai-gateway",
        providerEventId: "tok:call-exempt",
        costSource: "ai",
        owner: { sharedOverheadCategory: "platform_operations" },
        providerCostMicros: BigInt(83_400),
        normalizedCostMicros: BigInt(83_400),
        retailDebitMicros: BigInt(0),
        billingTreatment: "shared_overhead",
        pricingRuleVersion: "gateway_passthrough_2026_08_18",
        measuredQuantity: "8340000",
        measuredUnit: "1e-8_usd",
        occurredAt: new Date(input.completedAt),
        refs: { operationRef: input.aiCallId },
        metadata: {
          ai_call_id: input.aiCallId,
          user_id: input.userId,
          product_team_id: "team-1",
          model: input.model,
          gateway_generation_ids: input.generationIds,
          exemption_reason: reason,
        },
      });
      if (allowPlatformAi)
        expect(deps.findBillingAccountForScope).not.toHaveBeenCalled();
    }
  );

  it("keeps sub-micro costs and legacy team ownership in the audit fact", async () => {
    const deps = dependencies();
    await meterReconciledTokenUsage(
      { ...input, costUsd: 0.00000001, metadata: { team_id: "legacy-team" } },
      deps
    );
    expect(deps.recordProviderCost).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCostMicros: BigInt(1),
        measuredQuantity: "1",
        metadata: expect.objectContaining({ product_team_id: "legacy-team" }),
      })
    );
  });

  it("uses stable facts on replay even when the first write was already posted", async () => {
    const deps = dependencies();
    deps.recordProviderCost
      .mockResolvedValueOnce({ posted: true })
      .mockResolvedValueOnce({ posted: false });
    const personal = { ...input, metadata: null };
    const first = await meterReconciledTokenUsage(personal, deps);
    expect(await meterReconciledTokenUsage(personal, deps)).toEqual(first);
    expect(deps.recordProviderCost.mock.calls[0]).toEqual(
      deps.recordProviderCost.mock.calls[1]
    );
    expect(deps.recordProviderCost).toHaveBeenCalledTimes(2);
    expect(deps.accrueTokenUsage).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "propagates an overhead write failure so reconciliation remains retryable (%s)",
    async (exempt) => {
      const deps = dependencies(exempt);
      deps.recordProviderCost.mockRejectedValueOnce(
        new Error("ledger unavailable")
      );
      await expect(meterReconciledTokenUsage(input, deps)).rejects.toThrow(
        "ledger unavailable"
      );
      expect(deps.accrueTokenUsage).not.toHaveBeenCalled();
    }
  );

  it("leaves billed AI facts to the existing transactional database trigger", async () => {
    const deps = dependencies(false);
    deps.findBillingAccountForScope.mockResolvedValue({
      ...account,
      created_at: "2026-09-01T00:00:00Z",
    });
    expect((await meterReconciledTokenUsage(input, deps)).reason).toBe(
      "posted"
    );
    expect(deps.recordProviderCost).not.toHaveBeenCalled();
    expect(deps.accrueTokenUsage).toHaveBeenCalledTimes(1);
  });

  it("does not classify missing billing accounts as exempt", async () => {
    const deps = {
      ...dependencies(false),
      findBillingAccountForScope: async () => null,
    };
    expect((await meterReconciledTokenUsage(input, deps)).reason).toBe(
      "no_billing_account"
    );
    expect(deps.recordProviderCost).not.toHaveBeenCalled();
    expect(deps.accrueTokenUsage).not.toHaveBeenCalled();
  });

  it("does not write overhead for zero cost", async () => {
    const deps = dependencies();
    expect(
      (await meterReconciledTokenUsage({ ...input, costUsd: 0 }, deps)).reason
    ).toBe("zero_cost");
    expect(deps.recordProviderCost).not.toHaveBeenCalled();
    expect(deps.loadExplicitPlatformAccess).not.toHaveBeenCalled();
  });
});
