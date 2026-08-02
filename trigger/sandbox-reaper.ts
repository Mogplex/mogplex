import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { runSandboxReaper } from "@/lib/sandbox/reaper";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { SandboxReaperSummary } from "@/lib/sandbox/reaper";

type ScheduledSandboxReaperDeps = {
  runSandboxReaper: typeof runSandboxReaper;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: ScheduledSandboxReaperDeps = {
  runSandboxReaper,
  metadata,
  logger,
};

export async function runScheduledSandboxReaper(
  overrides: Partial<ScheduledSandboxReaperDeps> = {}
): Promise<SandboxReaperSummary> {
  const deps: ScheduledSandboxReaperDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const summary = await deps.runSandboxReaper();

  deps.metadata.set("processed", summary.processed);
  deps.metadata.set("reaped", summary.reaped);
  deps.logger.log(summary.message, summary);

  return summary;
}

export const sandboxReaperTask = schedules.task({
  id: TRIGGER_TASK_IDS.sandboxReaper,
  cron: "*/5 * * * *",
  maxDuration: 300,
  retry: {
    maxAttempts: 1,
  },
  run: async () => runScheduledSandboxReaper(),
});
