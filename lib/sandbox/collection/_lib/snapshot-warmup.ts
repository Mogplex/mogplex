import { SANDBOX_SNAPSHOT_WARMUP_ENV } from "./constants";
import { isTruthyEnvFlag } from "./utils";
import type { DeferredSnapshotWarmupQueueResult } from "./types";

export function shouldQueueSnapshotWarmupOnSandboxLaunch(
  env: NodeJS.ProcessEnv = process.env
) {
  return isTruthyEnvFlag(env[SANDBOX_SNAPSHOT_WARMUP_ENV]);
}

export function summarizeDeferredSnapshotWarmupQueueResult(
  result: DeferredSnapshotWarmupQueueResult
) {
  if (result.queued) {
    return {
      logLevel: "info" as const,
      logMessage: "[sandbox/create] Queued deferred snapshot build",
      warningMessage: null,
      details: {
        runtimeProvider: result.runtimeProvider,
        runtimeRunId: result.runtimeRunId,
        workflowRunId: result.workflowRunId,
      },
    };
  }

  switch (result.reason) {
    case "snapshot_exists":
      return {
        logLevel: "info" as const,
        logMessage:
          "[sandbox/create] Skipped deferred snapshot build because a snapshot already exists",
        warningMessage: null,
        details: { reason: result.reason },
      };
    case "in_progress":
      return {
        logLevel: "info" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build is already in progress",
        warningMessage: null,
        details: { reason: result.reason },
      };
    case "repo_not_found":
    case "not_found":
      return {
        logLevel: "warn" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build could not be queued because the repo state was unavailable",
        warningMessage: "Automatic snapshot warmup could not be queued.",
        details: { reason: result.reason },
      };
    default:
      return {
        logLevel: "warn" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build was skipped for an unexpected reason",
        warningMessage: "Automatic snapshot warmup could not be queued.",
        details: { reason: result.reason },
      };
  }
}
