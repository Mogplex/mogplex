import type {
  StaleStoppedSandboxRecord,
  ReaperSandboxCredentials,
} from "@/lib/sandbox/reaper-helpers";
import type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper-runner-deps";
import {
  buildReaperResult,
  buildReaperLoadError,
} from "@/lib/sandbox/reaper-types";
import type {
  ReaperSandboxRecord,
  AbandonedPausedSandboxRecord,
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
    const [activeSandboxes, staleStoppedSandboxes, abandonedPausedSandboxes] =
      await Promise.all([
        deps.loadActiveSandboxes(),
        deps.loadStaleStoppedSandboxes(),
        deps.loadAbandonedPausedSandboxes(),
      ]);

    return {
      activeSandboxes,
      staleStoppedSandboxes,
      abandonedPausedSandboxes,
    };
  } catch (error) {
    console.error("[sandbox-reaper] DB query failed:", error);
    throw buildReaperLoadError("Database query failed");
  }
}

export async function processAbandonedPausedSandboxes(
  abandoned: AbandonedPausedSandboxRecord[],
  platformCredentials: {
    vercelToken: string | null;
    vercelTeamId?: string | null;
    vercelProjectId: string | null;
  },
  deps: SandboxReaperRunnerDeps
): Promise<ReaperResult[]> {
  if (abandoned.length === 0) return [];
  // Platform creds missing means we can't call delete() - still mark
  // records stopped so they stop appearing in the UI.
  const platformOk =
    Boolean(platformCredentials.vercelToken) &&
    Boolean(platformCredentials.vercelProjectId);
  const results: ReaperResult[] = [];
  for (const sandbox of abandoned) {
    try {
      // Platform credentials only for now - user-linked Vercel projects
      // with abandoned paused records will need their own credential
      // resolution pass (mirror of resolveCrossUserActiveSandboxLivenessMap).
      // Simplest correct behaviour: attempt delete with platform creds
      // when the sandbox was platform-billed; mark the record stopped
      // either way so it stops clogging the UI.
      const credentials: ReaperSandboxCredentials =
        sandbox.billing_source === "user_vercel_project" || !platformOk
          ? {
              ok: false,
              error:
                sandbox.billing_source === "user_vercel_project"
                  ? "user-billed cleanup not yet implemented"
                  : "platform credentials unavailable",
            }
          : {
              ok: true,
              vercelToken: platformCredentials.vercelToken!,
              vercelTeamId: platformCredentials.vercelTeamId ?? null,
              vercelProjectId:
                sandbox.vercel_project_id ??
                sandbox.billing_project_id ??
                platformCredentials.vercelProjectId!,
            };
      const result = await deps.deleteAbandonedPausedSandbox(
        sandbox,
        credentials
      );
      results.push(result);
    } catch (err) {
      console.error(
        `[sandbox-reaper] Failed to delete abandoned paused sandbox ${sandbox.id}:`,
        err
      );
      results.push({ id: sandbox.id, action: "skipped_delete_failed" });
    }
  }
  return results;
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
