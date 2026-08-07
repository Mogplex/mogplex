import * as Sentry from "@sentry/nextjs";
import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { meterReconciledTokenUsage } from "@/lib/billing/token-usage";
import { createObservabilityGatewayClient } from "@/lib/observability/gateway-client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  type AiCallCostReconciliationDeps,
  type AiCallCostReconciliationSummary,
  loadAiCallCostReconciliationRows,
  reconcileAiCallCostRow,
} from "./reconcile-ai-call-costs-lib";

// Re-export types and functions needed by tests
export type { AiCallCostReconciliationRow } from "./reconcile-ai-call-costs-lib/types";
export type { AiCallCostReconciliationSummary } from "./reconcile-ai-call-costs-lib/types";
export { loadAiCallCostReconciliationRows } from "./reconcile-ai-call-costs-lib/persistence";
export { persistGatewayAiCallCost } from "./reconcile-ai-call-costs-lib/persistence";

// Keep full batches inside the Trigger maxDuration without firing 500 Gateway calls at once.
const RECONCILE_CONCURRENCY = 20;

// Deliberate no-retroactive-billing policy: this scheduled reconciler repairs
// recent Gateway finalization lag only. It must never expand into an unbounded
// historical debit after billing is enabled for an existing account.
export const AI_COST_RECONCILIATION_BACKFILL_POLICY =
  "no-retroactive-billing" as const;

const defaultDeps: AiCallCostReconciliationDeps = {
  supabase: supabaseAdmin,
  sentry: Sentry,
  now: () => new Date(),
  meterReconciledTokenUsage,
};

export async function runAiCallCostReconciliation(
  overrides: Partial<AiCallCostReconciliationDeps> = {}
): Promise<AiCallCostReconciliationSummary> {
  const deps: AiCallCostReconciliationDeps = {
    ...defaultDeps,
    ...overrides,
  };
  // Build the client lazily so deploys without this optional key still load;
  // missing config should fail the scheduled run visibly at execution time.
  const gateway = deps.gateway ?? createObservabilityGatewayClient();
  const now = deps.now();
  const rows = await loadAiCallCostReconciliationRows(deps);
  const summary: AiCallCostReconciliationSummary = {
    scanned: rows.length,
    reconciled: 0,
    skipped: 0,
    errored: 0,
  };

  let nextRowIndex = 0;
  function takeNextRow() {
    // Keep the shared index increment synchronous and before any awaited work.
    if (nextRowIndex >= rows.length) return undefined;

    const row = rows[nextRowIndex];
    nextRowIndex += 1;
    return row;
  }

  const workers = Array.from(
    { length: Math.min(RECONCILE_CONCURRENCY, rows.length) },
    async () => {
      while (true) {
        const row = takeNextRow();
        if (!row) break;

        const outcome = await reconcileAiCallCostRow(deps, gateway, row, now);
        summary[outcome] += 1;
      }
    }
  );

  await Promise.all(workers);

  return summary;
}

type ScheduledAiCallCostReconciliationDeps = {
  runAiCallCostReconciliation: typeof runAiCallCostReconciliation;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const scheduledDefaultDeps: ScheduledAiCallCostReconciliationDeps = {
  runAiCallCostReconciliation,
  metadata,
  logger,
};

export async function runScheduledAiCallCostReconciliation(
  overrides: Partial<ScheduledAiCallCostReconciliationDeps> = {}
): Promise<AiCallCostReconciliationSummary> {
  const deps: ScheduledAiCallCostReconciliationDeps = {
    ...scheduledDefaultDeps,
    ...overrides,
  };

  const summary = await deps.runAiCallCostReconciliation();
  deps.metadata.set("scanned", summary.scanned);
  deps.metadata.set("reconciled", summary.reconciled);
  deps.metadata.set("skipped", summary.skipped);
  deps.metadata.set("errored", summary.errored);
  deps.logger.log("Reconciled ai_calls Gateway cost", summary);

  return summary;
}

export const reconcileAiCallCostsTask = schedules.task({
  id: TRIGGER_TASK_IDS.aiCallCostReconciliation,
  // Quoted as "every 10 minutes" in observability tooltip copy - update
  // observability-summary.tsx if this changes.
  cron: "*/10 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledAiCallCostReconciliation(),
});
