import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import {
  runAnnualIncludedUsageGrants,
  type AnnualGrantSummary,
} from "@/lib/billing/annual-grants";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type ScheduledAnnualGrantDeps = {
  runAnnualIncludedUsageGrants: typeof runAnnualIncludedUsageGrants;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: ScheduledAnnualGrantDeps = {
  runAnnualIncludedUsageGrants,
  metadata,
  logger,
};

export async function runScheduledAnnualIncludedUsageGrants(
  overrides: Partial<ScheduledAnnualGrantDeps> = {}
): Promise<AnnualGrantSummary> {
  const deps = { ...defaultDeps, ...overrides };
  const summary = await deps.runAnnualIncludedUsageGrants();

  deps.metadata.set("scanned", summary.scanned);
  deps.metadata.set("granted", summary.granted);
  deps.metadata.set("duplicates", summary.duplicates);
  deps.metadata.set("skipped", summary.skipped);
  deps.metadata.set("errored", summary.errored);
  deps.metadata.set("disabled", summary.disabled);
  deps.logger.log("Granted annual-plan monthly included usage", summary);
  return summary;
}

export const annualIncludedUsageGrantTask = schedules.task({
  id: TRIGGER_TASK_IDS.annualIncludedUsageGrant,
  // Daily retries after the UTC anchor day are safe because grant source refs
  // are idempotent. The invoice webhook owns initial and renewal months.
  cron: "30 6 * * *",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledAnnualIncludedUsageGrants(),
});
