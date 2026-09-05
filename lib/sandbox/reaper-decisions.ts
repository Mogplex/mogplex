import {
  resolveEffectiveSandboxIdleTimeoutMs,
  resolveEffectiveSandboxTimeoutMs,
  MAX_SANDBOX_TIMEOUT_MS,
} from "@/lib/repo-settings";
import {
  toReaperSandboxCredentials,
  type ReaperSandboxCredentials,
} from "@/lib/sandbox/reaper-helpers";
import {
  STUCK_BOOT_THRESHOLD_MS,
  SANDBOX_PAUSING_STATUS,
  buildReaperResult,
  handledReaperDecision,
  unhandledReaperDecision,
} from "@/lib/sandbox/reaper-types";
import type {
  ReaperSandboxRecord,
  ReaperResult,
  ReaperSandboxDecision,
  ReaperStopAction,
} from "@/lib/sandbox/reaper-types";
import type { SandboxReaperRunnerDeps } from "@/lib/sandbox/reaper-runner-deps";
import {
  finalizeStalePausingAsPaused,
  restoreStalePausingAsRunning,
} from "@/lib/sandbox/reaper-stop";

export type ActiveSandboxEvaluation = {
  credentials: ReaperSandboxCredentials;
  confirmedGone: boolean;
  vmRunning: boolean;
  idleThresholdMs: number;
  idleMs: number;
  ageMs: number;
  busy: boolean;
};

function resolveSandboxTimeoutThreshold(sandbox: ReaperSandboxRecord) {
  const repo = Array.isArray(sandbox.repo) ? sandbox.repo[0] : sandbox.repo;
  const workspace = repo?.workspace
    ? Array.isArray(repo.workspace)
      ? repo.workspace[0]
      : repo.workspace
    : null;

  const lifetime = resolveEffectiveSandboxTimeoutMs({
    repoTimeoutMs: repo?.sandbox_timeout_ms,
    workspaceTimeoutMs: workspace?.sandbox_timeout_ms,
  });

  return resolveEffectiveSandboxIdleTimeoutMs({
    repoIdleTimeoutMs: repo?.sandbox_idle_timeout_ms,
    workspaceIdleTimeoutMs: workspace?.sandbox_idle_timeout_ms,
    lifetimeTimeoutMs: lifetime,
  });
}

export function buildActiveSandboxEvaluation(
  sandbox: ReaperSandboxRecord,
  liveness: Parameters<typeof toReaperSandboxCredentials>[0],
  busySandboxIds: Set<string>,
  nowMs: number
): ActiveSandboxEvaluation {
  const idleThresholdMs = resolveSandboxTimeoutThreshold(sandbox);
  const lastActive = new Date(
    sandbox.last_active_at || sandbox.created_at
  ).getTime();
  const createdAt = new Date(sandbox.created_at).getTime();
  // Persistent records outlive their VM sessions. Boot and lifetime limits
  // apply to the current session, not the first creation of the record.
  const bootStartedAt = new Date(sandbox.last_boot_started_at ?? "").getTime();
  const sessionStartedAt = Number.isFinite(bootStartedAt)
    ? Math.max(createdAt, bootStartedAt)
    : createdAt;

  return {
    credentials: toReaperSandboxCredentials(liveness),
    confirmedGone: liveness?.kind === "stopped",
    vmRunning: liveness?.kind === "running",
    idleThresholdMs,
    idleMs: nowMs - lastActive,
    ageMs: nowMs - sessionStartedAt,
    busy:
      Boolean(sandbox.exec_lock_token) ||
      busySandboxIds.has(sandbox.id) ||
      busySandboxIds.has(sandbox.sandbox_id),
  };
}

async function stopActiveSandboxForReaper(
  sandbox: ReaperSandboxRecord,
  credentials: ReaperSandboxCredentials,
  options: {
    expectedHealthStatus?: string;
    confirmedGone?: boolean;
    onSuccessAction: ReaperStopAction;
  },
  deps: SandboxReaperRunnerDeps
): Promise<ReaperResult> {
  const stopResult = await deps.stopSandbox(sandbox, credentials, options);
  return buildReaperResult(sandbox.id, stopResult.action);
}

export async function tryStopMissingVmSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (!evaluation.confirmedGone || sandbox.sandbox_id === "pending") {
    return unhandledReaperDecision();
  }

  return handledReaperDecision(
    await stopActiveSandboxForReaper(
      sandbox,
      evaluation.credentials,
      {
        confirmedGone: true,
        onSuccessAction: "stopped_vm_gone",
      },
      deps
    )
  );
}

export async function tryReconcileStalePausingSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (sandbox.status !== SANDBOX_PAUSING_STATUS) {
    return unhandledReaperDecision();
  }

  if (evaluation.busy) {
    return handledReaperDecision(
      buildReaperResult(sandbox.id, "skipped_stale_pausing_busy")
    );
  }

  if (sandbox.persistent && evaluation.confirmedGone) {
    const finalized = await finalizeStalePausingAsPaused(sandbox, deps);
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        finalized
          ? "finalized_stale_pausing"
          : "stale_pausing_already_converged"
      )
    );
  }

  if (!sandbox.persistent && evaluation.confirmedGone) {
    const result = await deps.stopSandbox(sandbox, evaluation.credentials, {
      confirmedGone: true,
      fromStatuses: SANDBOX_PAUSING_STATUS,
      onSuccessAction: "stopped_vm_gone",
    });
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        result.stopped ? "stopped_stale_pausing" : result.action
      )
    );
  }

  if (!evaluation.credentials.ok) {
    return handledReaperDecision(
      buildReaperResult(sandbox.id, "skipped_missing_billing_credentials")
    );
  }

  if (sandbox.sandbox_id === "pending") {
    return handledReaperDecision(
      buildReaperResult(sandbox.id, "skipped_stale_pausing_pending")
    );
  }

  if (!evaluation.vmRunning) {
    return handledReaperDecision(
      buildReaperResult(sandbox.id, "skipped_stale_pausing_not_running")
    );
  }

  if (!sandbox.persistent) {
    const restored = await restoreStalePausingAsRunning(sandbox, deps);
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        restored ? "restored_stale_pausing" : "stale_pausing_already_converged"
      )
    );
  }

  let billingClose: Awaited<
    ReturnType<SandboxReaperRunnerDeps["prepareSandboxBillingClose"]>
  >;
  let vm: Awaited<ReturnType<SandboxReaperRunnerDeps["getSandbox"]>>;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandbox.id);
    vm = await deps.getSandbox(sandbox.sandbox_id, {
      vercelToken: evaluation.credentials.vercelToken,
      vercelTeamId: evaluation.credentials.vercelTeamId ?? null,
      vercelProjectId: evaluation.credentials.vercelProjectId,
    });
    await vm.stop({ blocking: true });
  } catch (error) {
    console.warn(
      `[sandbox-reaper] Failed to finish stale pausing sandbox ${sandbox.id}; restoring running state:`,
      error
    );
    const restored = await restoreStalePausingAsRunning(sandbox, deps);
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        restored ? "restored_stale_pausing" : "stale_pausing_already_converged"
      )
    );
  }

  try {
    const providerSession = vm.currentSession();
    await deps.finalizeSandboxBillingClose(
      billingClose,
      providerSession.stoppedAt ?? providerSession.updatedAt ?? new Date()
    );
  } catch (billingError) {
    console.warn(
      `[sandbox-reaper] Stale pausing VM ${sandbox.sandbox_id} stopped, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }

  try {
    const finalized = await finalizeStalePausingAsPaused(
      sandbox,
      deps,
      vm.currentSnapshotId ?? null
    );
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        finalized ? "paused_stale_pausing" : "stale_pausing_already_converged"
      )
    );
  } catch (error) {
    console.warn(
      `[sandbox-reaper] Failed to finish stale pausing sandbox ${sandbox.id}; restoring running state:`,
      error
    );
    const restored = await restoreStalePausingAsRunning(sandbox, deps);
    return handledReaperDecision(
      buildReaperResult(
        sandbox.id,
        restored ? "restored_stale_pausing" : "restore_stale_pausing_failed"
      )
    );
  }
}

export async function tryStopStuckBootSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  const isStuckBoot =
    (sandbox.status === "creating" || sandbox.status === "installing") &&
    evaluation.ageMs > STUCK_BOOT_THRESHOLD_MS;
  if (!isStuckBoot) {
    return unhandledReaperDecision();
  }

  return handledReaperDecision(
    await stopActiveSandboxForReaper(
      sandbox,
      evaluation.credentials,
      {
        confirmedGone: evaluation.confirmedGone,
        onSuccessAction: "stopped_stuck_boot",
      },
      deps
    )
  );
}

export async function tryStopExpiredSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (evaluation.ageMs <= MAX_SANDBOX_TIMEOUT_MS) {
    return unhandledReaperDecision();
  }

  return handledReaperDecision(
    await stopActiveSandboxForReaper(
      sandbox,
      evaluation.credentials,
      {
        confirmedGone: evaluation.confirmedGone,
        onSuccessAction: "stopped_max_lifetime",
      },
      deps
    )
  );
}

export async function tryHandleBusyRunningSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (sandbox.status !== "running" || !evaluation.busy) {
    return unhandledReaperDecision();
  }

  if (sandbox.health_status === "idle_warning") {
    await deps.updateSandboxRecord(
      sandbox.id,
      { health_status: "running" },
      {
        expectedSandboxId: sandbox.sandbox_id,
        fromStatuses: "running",
        expectedHealthStatus: "idle_warning",
      }
    );
    return handledReaperDecision(
      buildReaperResult(sandbox.id, "cleared_idle_warning_busy")
    );
  }

  return handledReaperDecision(buildReaperResult(sandbox.id, "skipped_busy"));
}

async function tryStopConfirmedIdleSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  const fresh = await deps.loadFreshIdleState(sandbox.id);
  if (!fresh) {
    return handledReaperDecision();
  }

  const freshLastActive = new Date(
    fresh.last_active_at || sandbox.created_at
  ).getTime();
  const freshIdleMs = deps.nowMs() - freshLastActive;
  if (
    fresh.health_status === "idle_warning" &&
    freshIdleMs > evaluation.idleThresholdMs
  ) {
    return handledReaperDecision(
      await stopActiveSandboxForReaper(
        sandbox,
        evaluation.credentials,
        {
          expectedHealthStatus: "idle_warning",
          confirmedGone: evaluation.confirmedGone,
          onSuccessAction: "stopped_idle",
        },
        deps
      )
    );
  }

  return handledReaperDecision(
    buildReaperResult(sandbox.id, "skipped_became_active")
  );
}

export async function tryHandleIdleRunningSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (
    sandbox.status !== "running" ||
    evaluation.idleMs <= evaluation.idleThresholdMs
  ) {
    return unhandledReaperDecision();
  }

  if (sandbox.health_status === "idle_warning") {
    return tryStopConfirmedIdleSandbox(sandbox, evaluation, deps);
  }

  await deps.updateSandboxRecord(
    sandbox.id,
    { health_status: "idle_warning" },
    {
      expectedSandboxId: sandbox.sandbox_id,
      fromStatuses: "running",
    }
  );
  return handledReaperDecision(
    buildReaperResult(sandbox.id, "marked_idle_warning")
  );
}

export async function tryClearRecoveredIdleWarning(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
): Promise<ReaperSandboxDecision> {
  if (
    sandbox.health_status !== "idle_warning" ||
    evaluation.idleMs > evaluation.idleThresholdMs
  ) {
    return unhandledReaperDecision();
  }

  await deps.updateSandboxRecord(
    sandbox.id,
    { health_status: "running" },
    {
      expectedSandboxId: sandbox.sandbox_id,
      fromStatuses: "running",
      expectedHealthStatus: "idle_warning",
    }
  );
  return handledReaperDecision(
    buildReaperResult(sandbox.id, "cleared_idle_warning")
  );
}
