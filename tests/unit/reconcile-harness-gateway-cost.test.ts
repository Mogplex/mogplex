import assert from "node:assert/strict";
import test from "node:test";
import {
  createReconcileSupabase,
  createRow,
  loadReconcileModule,
} from "./helpers/reconcile-ai-call-costs-fixtures";
import { reconcileAiCallCostRow } from "../../trigger/reconcile-ai-call-costs-lib/reconcile-row";

test("reconciles the entire platform harness run without inventing generation IDs", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const row = createRow({
    model: "harness:codex",
    gateway_generation_id: null,
    metadata: {
      gateway_cost_tracking: "report-v1",
      ai_billing_source: "platform_ai_gateway",
    },
  });
  const { client, updates } = createReconcileSupabase([row]);
  const metered: number[] = [];
  const result = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00Z"),
    gateway: {
      getGenerationInfo: async () => {
        throw new Error("No generation ID was captured");
      },
      getSpendReport: async (params) => {
        assert.deepEqual(params, {
          startDate: "2026-05-16",
          endDate: "2026-05-16",
          groupBy: "day",
          tags: ["ai-call:call_1"],
        });
        return { results: [{ totalCost: 0.4, requestCount: 3 }] };
      },
    },
    meterReconciledTokenUsage: async (input) => {
      assert.deepEqual(input.generationIds, []);
      metered.push(input.costUsd);
      return {
        metered: true,
        reason: "posted",
        amountCents: 40,
        costUnits: 40_000_000,
      };
    },
    sentry: {
      captureException: (error) => {
        throw error;
      },
      captureMessage: () => {},
    },
  });
  assert.equal(result.reconciled, 1);
  assert.deepEqual(metered, [0.4]);
  assert.deepEqual(updates[0].payload, {
    cost_usd: 0.4,
    cost_source: "gateway",
  });
});

for (const scenario of [
  "settling",
  "untagged",
  "byok",
  "no-report",
  "no-account",
  "invalid-report",
] as const) {
  test(`harness reconciliation does not debit ${scenario}`, async () => {
    const row = createRow({
      model: "harness:codex",
      gateway_generation_id: null,
      completed_at:
        scenario === "settling"
          ? "2026-05-16T10:59:00Z"
          : "2026-05-16T10:00:00Z",
      metadata:
        scenario === "untagged"
          ? null
          : {
              gateway_cost_tracking: "report-v1",
              ai_billing_source:
                scenario === "byok" ? "user_ai_gateway" : "platform_ai_gateway",
            },
    });
    const { client, updates } = createReconcileSupabase([row]);
    const errors: unknown[] = [];
    const outcome = await reconcileAiCallCostRow(
      {
        supabase: client as never,
        sentry: {
          captureMessage: () => {},
          captureException: (error) => {
            errors.push(error);
          },
        },
        meterReconciledTokenUsage: async () => {
          assert.equal(scenario, "no-account");
          return {
            metered: false,
            reason: "no_billing_account",
            amountCents: 0,
            costUnits: 0,
          };
        },
      },
      {
        getGenerationInfo: async () => {
          throw new Error("Unexpected generation lookup");
        },
        getSpendReport: async () => {
          assert.ok(
            ["no-report", "no-account", "invalid-report"].includes(scenario)
          );
          return {
            results:
              scenario === "no-report"
                ? []
                : [
                    {
                      totalCost:
                        scenario === "invalid-report" ? Number.NaN : 0.4,
                      requestCount: 1,
                    },
                  ],
          };
        },
      },
      row,
      new Date("2026-05-16T11:00:00Z")
    );
    assert.equal(
      outcome,
      scenario === "invalid-report" ? "errored" : "skipped"
    );
    assert.equal(errors.length, scenario === "invalid-report" ? 1 : 0);
    assert.equal(updates.length, 0);
  });
}
