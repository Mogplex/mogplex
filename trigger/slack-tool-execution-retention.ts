import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { deleteExpiredSlackToolExecutions } from "@/lib/agents/slack-tool-retention";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type ScheduledSlackToolExecutionRetentionDeps = {
  deleteExpiredSlackToolExecutions: typeof deleteExpiredSlackToolExecutions;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log" | "warn">;
};

const defaultDeps: ScheduledSlackToolExecutionRetentionDeps = {
  deleteExpiredSlackToolExecutions,
  metadata,
  logger,
};

export async function runScheduledSlackToolExecutionRetention(
  overrides: Partial<ScheduledSlackToolExecutionRetentionDeps> = {}
) {
  const deps: ScheduledSlackToolExecutionRetentionDeps = {
    ...defaultDeps,
    ...overrides,
  };
  const summary = await deps.deleteExpiredSlackToolExecutions();

  deps.metadata.set("deleted", summary.deleted);
  deps.metadata.set("cutoff", summary.cutoff);
  deps.metadata.set("batches", summary.batches);
  deps.metadata.set("has_more", summary.hasMore);
  deps.logger.log(
    `Deleted ${summary.deleted} expired Slack tool execution records`,
    summary
  );
  if (summary.hasMore) {
    deps.logger.warn(
      "Slack tool execution retention reached its batch limit; the next hourly run will continue cleanup",
      summary
    );
  }
  return summary;
}

export const slackToolExecutionRetentionTask = schedules.task({
  id: TRIGGER_TASK_IDS.slackToolExecutionRetention,
  cron: "17 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 3 },
  run: async () => runScheduledSlackToolExecutionRetention(),
});
