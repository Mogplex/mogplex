import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  buildVercelLinkReconciliationMessage,
  runVercelLinkReconciliation,
} from "@/lib/vercel/reconcile-links-runner";
import type { VercelLinkReconciliationSummary } from "@/lib/vercel/reconcile-links-runner";

type ScheduledVercelLinkReconciliationDeps = {
  runVercelLinkReconciliation: typeof runVercelLinkReconciliation;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: ScheduledVercelLinkReconciliationDeps = {
  runVercelLinkReconciliation,
  metadata,
  logger,
};

export async function runScheduledVercelLinkReconciliation(
  overrides: Partial<ScheduledVercelLinkReconciliationDeps> = {}
): Promise<VercelLinkReconciliationSummary> {
  const deps: ScheduledVercelLinkReconciliationDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const summary = await deps.runVercelLinkReconciliation();

  deps.metadata.set("processed", summary.processed);
  deps.metadata.set("failed", summary.failed);
  deps.metadata.set("valid", summary.valid);
  deps.metadata.set("missingProject", summary.missing_project);
  deps.metadata.set("authInvalid", summary.auth_invalid);
  deps.metadata.set("inaccessible", summary.inaccessible);
  deps.logger.log(buildVercelLinkReconciliationMessage(summary), summary);

  return summary;
}

export const reconcileVercelLinksTask = schedules.task({
  id: TRIGGER_TASK_IDS.vercelLinkReconciliation,
  cron: "*/15 * * * *",
  maxDuration: 300,
  retry: {
    maxAttempts: 1,
  },
  run: async () => runScheduledVercelLinkReconciliation(),
});
