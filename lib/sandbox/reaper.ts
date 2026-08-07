import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { resolveCrossUserActiveSandboxLivenessMap } from "@/lib/sandbox/liveness";
import {
  loadStaleStoppedSandboxes,
  repairStoppedSandboxHealthStatus,
} from "@/lib/sandbox/reaper-helpers";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import {
  loadActiveSandboxes,
  loadBusySandboxIds,
  loadFreshIdleState,
  loadAbandonedPausedSandboxes,
} from "@/lib/sandbox/reaper-loaders";
import {
  stopSandbox,
  deleteAbandonedPausedSandbox,
} from "@/lib/sandbox/reaper-stop";
import {
  loadReaperSandboxes,
  processAbandonedPausedSandboxes,
  loadBusySandboxIdsForReaper,
  processStaleStoppedSandboxes,
  processActiveSandboxes,
} from "@/lib/sandbox/reaper-processing";
import {
  buildNoMaintenanceSummary,
  buildProcessedSandboxesSummary,
} from "@/lib/sandbox/reaper-types";
import type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper-runner-deps";

// Re-export all public types
export type {
  ReaperSandboxRecord,
  ReaperResult,
  SandboxReaperSummary,
  AbandonedPausedSandboxRecord,
  ReaperStopAction,
} from "@/lib/sandbox/reaper-types";

export {
  SandboxReaperRunError,
  isReapedAction,
  stopReasonForAction,
  buildSandboxReaperResponse,
} from "@/lib/sandbox/reaper-types";

export type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper-runner-deps";

export {
  deleteAbandonedPausedSandbox,
  stopSandbox,
} from "@/lib/sandbox/reaper-stop";

const defaultSandboxReaperRunnerDeps: SandboxReaperRunnerDeps = {
  loadActiveSandboxes,
  loadStaleStoppedSandboxes,
  loadAbandonedPausedSandboxes,
  loadBusySandboxIds,
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
  resolveCrossUserActiveSandboxLivenessMap,
  repairStoppedSandboxHealthStatus,
  stopSandbox,
  getSandbox,
  deleteAbandonedPausedSandbox,
  updateSandboxRecord,
  loadFreshIdleState,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
  nowMs: () => Date.now(),
};

export function createSandboxReaperRunner(
  overrides: Partial<SandboxReaperRunnerDeps> = {}
) {
  const deps: SandboxReaperRunnerDeps = {
    ...defaultSandboxReaperRunnerDeps,
    ...overrides,
  };

  return async function runSandboxReaper() {
    const nowMs = deps.nowMs();
    const { activeSandboxes, staleStoppedSandboxes, abandonedPausedSandboxes } =
      await loadReaperSandboxes(deps);

    if (
      activeSandboxes.length === 0 &&
      staleStoppedSandboxes.length === 0 &&
      abandonedPausedSandboxes.length === 0
    ) {
      return buildNoMaintenanceSummary();
    }

    const staleStoppedResults = await processStaleStoppedSandboxes(
      staleStoppedSandboxes,
      deps
    );

    const platformCredentials = deps.getPlatformSandboxCredentials();
    const abandonedPausedResults = await processAbandonedPausedSandboxes(
      abandonedPausedSandboxes,
      platformCredentials,
      deps
    );

    if (activeSandboxes.length === 0) {
      return buildProcessedSandboxesSummary(
        staleStoppedSandboxes.length + abandonedPausedSandboxes.length,
        [...staleStoppedResults, ...abandonedPausedResults]
      );
    }

    const busySandboxIds = await loadBusySandboxIdsForReaper(deps);
    const livenessById = await deps.resolveCrossUserActiveSandboxLivenessMap({
      platformCredentials: {
        vercelToken: platformCredentials.vercelToken,
        vercelTeamId: platformCredentials.vercelTeamId,
        vercelProjectId: platformCredentials.vercelProjectId,
      },
      loadUserVercelCredentials: deps.loadUserVercelCredentials,
      records: activeSandboxes,
    });

    const activeSandboxResults = await processActiveSandboxes(
      activeSandboxes,
      busySandboxIds,
      livenessById,
      nowMs,
      deps
    );

    return buildProcessedSandboxesSummary(
      activeSandboxes.length +
        staleStoppedSandboxes.length +
        abandonedPausedSandboxes.length,
      [
        ...staleStoppedResults,
        ...abandonedPausedResults,
        ...activeSandboxResults,
      ]
    );
  };
}

export const runSandboxReaper = createSandboxReaperRunner();
