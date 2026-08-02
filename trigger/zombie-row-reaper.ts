import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { runZombieReaper } from "@/lib/zombies/zombie-reaper";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ZombieReaperSummary } from "@/lib/zombies/zombie-reaper";

type ScheduledZombieReaperDeps = {
  runZombieReaper: typeof runZombieReaper;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: ScheduledZombieReaperDeps = {
  runZombieReaper,
  metadata,
  logger,
};

export async function runScheduledZombieReaper(
  overrides: Partial<ScheduledZombieReaperDeps> = {}
): Promise<ZombieReaperSummary> {
  const deps: ScheduledZombieReaperDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const summary = await deps.runZombieReaper();

  deps.metadata.set("processed", summary.processed);
  deps.metadata.set("reaped", summary.reaped);
  for (const table of summary.tables) {
    deps.metadata.set(`reaped_${table.table}`, table.reaped);
    if (table.error) {
      deps.metadata.set(`error_${table.table}`, table.error);
    }
  }
  deps.logger.log(summary.message, summary);

  return summary;
}

export const zombieRowReaperTask = schedules.task({
  id: TRIGGER_TASK_IDS.zombieRowReaper,
  // Cadence matches sandbox-reaper. The chat ai_calls liveness window
  // is 5 min so anything coarser would let zombies linger across more
  // than two reap cycles.
  cron: "*/5 * * * *",
  // Capped 60s under the cron cadence so a slow run (e.g. many
  // cancelAutomationJobRun calls hitting the Trigger.dev API
  // sequentially) cannot overlap or queue against the next
  // scheduled invocation.
  maxDuration: 240,
  retry: {
    maxAttempts: 1,
  },
  run: async () => runScheduledZombieReaper(),
});
