import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import {
  reconcileSandboxBillingSessions,
  type SandboxBillingReconciliationSummary,
} from "@/lib/billing/sandbox-reconciliation";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type ScheduledSandboxBillingDeps = {
  reconcile: typeof reconcileSandboxBillingSessions;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log" | "error">;
};

const defaultDeps: ScheduledSandboxBillingDeps = {
  reconcile: reconcileSandboxBillingSessions,
  metadata,
  logger,
};

export async function runScheduledSandboxBillingReconciliation(
  overrides: Partial<ScheduledSandboxBillingDeps> = {}
): Promise<SandboxBillingReconciliationSummary> {
  const deps = { ...defaultDeps, ...overrides };
  const summary = await deps.reconcile();
  for (const key of [
    "processed",
    "accrued",
    "finalized",
    "rotated",
    "opened",
    "depleted",
    "skipped",
    "failed",
  ] as const) {
    deps.metadata.set(key, summary[key]);
  }
  if (summary.failed > 0) {
    deps.logger.error(summary.message, { errors: summary.errors });
  } else {
    deps.logger.log(summary.message, summary);
  }
  return summary;
}

export const sandboxBillingReconciliationTask = schedules.task({
  id: TRIGGER_TASK_IDS.sandboxBillingReconciliation,
  // Usage admission is balance-based, so enforcement must run at the same
  // one-minute granularity as the provider rate instead of waiting for the
  // broader five-minute sandbox hygiene pass.
  cron: "* * * * *",
  maxDuration: 240,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledSandboxBillingReconciliation(),
});
