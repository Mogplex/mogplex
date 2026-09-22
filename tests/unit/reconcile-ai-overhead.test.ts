import assert from "node:assert/strict";
import test from "node:test";
import { meterReconciledTokenUsage } from "../../lib/billing/token-usage";
import {
  loadReconcileModule,
  createRow,
  createReconcileSupabase,
} from "./helpers/reconcile-ai-call-costs-fixtures";

test("overhead persistence must succeed before Gateway reconciliation completes", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);
  const errors: unknown[] = [];
  let providerWrites = 0;
  let accruals = 0;
  const overrides = {
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: (error: unknown) => {
        errors.push(error);
      },
      captureMessage: () => undefined,
    },
    gateway: { getGenerationInfo: async () => ({ cost: 0.0834 }) },
    meterReconciledTokenUsage: (
      input: Parameters<typeof meterReconciledTokenUsage>[0]
    ) =>
      meterReconciledTokenUsage(input, {
        loadExplicitPlatformAccess: async () => ({
          allowPlatformAi: true,
          allowPlatformSandbox: false,
        }),
        accrueTokenUsage: async () => {
          accruals++;
          throw new Error("must not debit");
        },
        recordProviderCost: async () => {
          providerWrites++;
          if (providerWrites === 1) throw new Error("temporary ledger failure");
          return { posted: true };
        },
      }),
  };
  const first = await runAiCallCostReconciliation(overrides);
  assert.equal(first.errored, 1);
  assert.equal(first.reconciled, 0);
  assert.equal(errors.length, 1);
  assert.equal(updates.length, 0);
  const retried = await runAiCallCostReconciliation(overrides);
  assert.equal(retried.reconciled, 1);
  assert.equal(retried.errored, 0);
  assert.equal(updates.length, 1);
  assert.equal(providerWrites, 2);
  assert.equal(accruals, 0);
});
