import type { StaleStoppedSandboxRecord } from "@/lib/sandbox/reaper-helpers";
import type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper-runner-deps";
import {
  buildReaperResult,
  buildReaperLoadError,
} from "@/lib/sandbox/reaper-types";
import type {
  ReaperSandboxRecord,
  ReaperResult,
} from "@/lib/sandbox/reaper-types";
import {
  buildActiveSandboxEvaluation,
  tryReconcileStalePausingSandbox,
  tryStopMissingVmSandbox,
  tryStopStuckBootSandbox,
  tryStopExpiredSandbox,
  tryHandleBusyRunningSandbox,
  tryHandleIdleRunningSandbox,
  tryClearRecoveredIdleWarning,
} from "@/lib/sandbox/reaper-decisions";

export async function loadReaperSandboxes(deps: SandboxReaperRunnerDeps) {
  try {
    const [activeSandboxes, staleStoppedSandboxes] =
      await deps.withSupabaseAdminConnection((client) =>
        Promise.all([
          deps.loadActiveSandboxes(client),
          deps.loadStaleStoppedSandboxes(client),
        ])
      );

    return {
      activeSandboxes,
      staleStoppedSandboxes,
    };
  } catch (error) {
    console.error("[sandbox-reaper] DB query failed:", error);
    throw buildReaperLoadError("Database query failed");
  }
}

export async function loadBusySandboxIdsForReaper(
  deps: SandboxReaperRunnerDeps
): Promise<Set<string>> {
  try {
    return await deps.loadBusySandboxIds();
  } catch (error) {
    console.error("[sandbox-reaper] Failed to load active ai_calls:", error);
    throw buildReaperLoadError("Failed to load active ai_calls");
  }
}

export async function processStaleStoppedSandboxes(
  staleStoppedSandboxes: StaleStoppedSandboxRecord[],
  deps: SandboxReaperRunnerDeps
): Promise<ReaperResult[]> {
  const results: ReaperResult[] = [];

  for (const sandbox of staleStoppedSandboxes) {
    try {
      const repairResult = await deps.repairStoppedSandboxHealthStatus(sandbox);
      results.push(buildReaperResult(sandbox.id, repairResult.action));
    } catch (error) {
      console.error(
        `[sandbox-reaper] Failed to repair stopped health status for ${sandbox.id}:`,
        error
      );
      results.push(
        buildReaperResult(sandbox.id, "repair_stopped_health_status_failed")
      );
    }
  }

  return results;
}

async function processActiveSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ReturnType<typeof buildActiveSandboxEvaluation>,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperResult | null> {
  const handlers = [
    tryReconcileStalePausingSandbox,
    tryStopMissingVmSandbox,
    tryStopStuckBootSandbox,
    tryStopExpiredSandbox,
    tryHandleBusyRunningSandbox,
    tryHandleIdleRunningSandbox,
    tryClearRecoveredIdleWarning,
  ] as const;

  for (const handler of handlers) {
    const decision = await handler(sandbox, evaluation, deps);
    if (decision.handled) {
      return decision.result ?? null;
    }
  }

  return null;
}

export async function processActiveSandboxes(
  activeSandboxes: ReaperSandboxRecord[],
  busySandboxIds: Set<string>,
  livenessById: Awaited<
    ReturnType<
      SandboxReaperRunnerDeps["resolveCrossUserActiveSandboxLivenessMap"]
    >
  >,
  nowMs: number,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperResult[]> {
  const results: ReaperResult[] = [];

  for (const sandbox of activeSandboxes) {
    const evaluation = buildActiveSandboxEvaluation(
      sandbox,
      livenessById.get(sandbox.id),
      busySandboxIds,
      nowMs
    );
    const result = await processActiveSandbox(sandbox, evaluation, deps);
    if (result) {
      results.push(result);
    }
  }

  return results;
}
