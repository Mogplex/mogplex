import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { stopSandboxRecord, updateSandboxRecord } from "@/lib/sandbox/records";
import { buildSandboxStopErrorUpdate } from "@/lib/sandbox/reaper-helpers";
import type { ReaperSandboxCredentials } from "@/lib/sandbox/reaper-helpers";
import type { SandboxLifecycleStatus } from "@/lib/types";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import {
  REAPER_ACTIVE_STOP_STATUSES,
  SANDBOX_PAUSING_STATUS,
  stopReasonForAction,
} from "@/lib/sandbox/reaper-types";
import type {
  ReaperSandboxRecord,
  AbandonedPausedSandboxRecord,
  ReaperResult,
  ReaperStopAction,
} from "@/lib/sandbox/reaper-types";

export type StopSandboxDeps = {
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};

export type StopSandboxOverrides = Omit<
  StopSandboxDeps,
  "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
> &
  Partial<
    Pick<
      StopSandboxDeps,
      "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
    >
  >;

const defaultStopSandboxDeps: StopSandboxDeps = {
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

/**
 * Actions that should soft-pause (preserve state for resume) rather than
 * hard-stop when the target sandbox is persistent. Idle timeouts and
 * lifetime expiry are user-recoverable; stuck-boot and vm-gone are not.
 *
 * Switch-based so TypeScript flags any new ReaperStopAction member that
 * isn't explicitly classified - must stay in sync with toPausedReaperAction.
 */
function isSoftPausableReaperAction(action: ReaperStopAction): boolean {
  switch (action) {
    case "stopped_idle":
    case "stopped_max_lifetime":
      return true;
    case "stopped_stuck_boot":
    case "stopped_vm_gone":
      return false;
    default: {
      const _exhaustive: never = action;
      throw new Error(
        `isSoftPausableReaperAction: unhandled action ${_exhaustive}`
      );
    }
  }
}

function toPausedReaperAction(
  action: ReaperStopAction
): "paused_idle" | "paused_max_lifetime" {
  switch (action) {
    case "stopped_idle":
      return "paused_idle";
    case "stopped_max_lifetime":
      return "paused_max_lifetime";
    case "stopped_stuck_boot":
    case "stopped_vm_gone": {
      // Callers must gate with isSoftPausableReaperAction. Throw loudly
      // rather than emit a raw stopped_* string as the action result.
      throw new Error(
        `toPausedReaperAction: action ${action} is not soft-pausable`
      );
    }
    default: {
      // If this line errors, a new ReaperStopAction member was added but
      // not classified here. Update both branches above and
      // isSoftPausableReaperAction.
      const _exhaustive: never = action;
      throw new Error(`toPausedReaperAction: unhandled action ${_exhaustive}`);
    }
  }
}

export function resolveRestoredPausingHealthStatus(
  healthStatus: string | null
) {
  return healthStatus && healthStatus !== SANDBOX_PAUSING_STATUS
    ? healthStatus
    : "running";
}

export async function finalizeStalePausingAsPaused(
  sandbox: ReaperSandboxRecord,
  deps: Pick<StopSandboxDeps, "updateSandboxRecord">,
  snapshotId?: string | null
) {
  const updated = await deps.updateSandboxRecord(
    sandbox.id,
    {
      status: "paused",
      health_status: "paused",
      stop_reason: "auto_pause",
      ...(snapshotId === undefined ? {} : { snapshot_id: snapshotId }),
    },
    {
      expectedSandboxId: sandbox.sandbox_id,
      fromStatuses: SANDBOX_PAUSING_STATUS,
    }
  );

  return updated !== null;
}

export async function restoreStalePausingAsRunning(
  sandbox: ReaperSandboxRecord,
  deps: Pick<StopSandboxDeps, "updateSandboxRecord">
) {
  const restored = await deps.updateSandboxRecord(
    sandbox.id,
    {
      status: "running",
      health_status: resolveRestoredPausingHealthStatus(sandbox.health_status),
      stop_reason: null,
    },
    {
      expectedSandboxId: sandbox.sandbox_id,
      fromStatuses: SANDBOX_PAUSING_STATUS,
    }
  );

  return restored !== null;
}

const defaultDeleteAbandonedPausedDeps: Pick<
  StopSandboxDeps,
  | "getSandbox"
  | "stopSandboxRecord"
  | "prepareSandboxBillingClose"
  | "finalizeSandboxBillingClose"
> = {
  getSandbox,
  stopSandboxRecord,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

export async function deleteAbandonedPausedSandbox(
  sandbox: AbandonedPausedSandboxRecord,
  credentials: ReaperSandboxCredentials,
  deps: Pick<
    StopSandboxDeps,
    | "getSandbox"
    | "stopSandboxRecord"
    | "prepareSandboxBillingClose"
    | "finalizeSandboxBillingClose"
  > = defaultDeleteAbandonedPausedDeps
): Promise<ReaperResult> {
  if (
    credentials.ok &&
    sandbox.sandbox_id &&
    sandbox.sandbox_id !== "pending"
  ) {
    const billingClose = await deps.prepareSandboxBillingClose(sandbox.id);
    try {
      const vm = await deps.getSandbox(sandbox.sandbox_id, {
        vercelToken: credentials.vercelToken,
        vercelTeamId: credentials.vercelTeamId,
        vercelProjectId: credentials.vercelProjectId,
      });
      await vm.delete();
      await deps.finalizeSandboxBillingClose(billingClose, new Date());
    } catch (err) {
      console.warn(
        `[sandbox-reaper] Failed to delete abandoned paused VM ${sandbox.sandbox_id}; keeping the record visible for retry:`,
        err
      );
      return { id: sandbox.id, action: "skipped_delete_failed" };
    }
  } else if (sandbox.sandbox_id && sandbox.sandbox_id !== "pending") {
    return { id: sandbox.id, action: "skipped_delete_failed" };
  }

  await deps.stopSandboxRecord(sandbox.id, {
    expectedSandboxId: sandbox.sandbox_id,
    fromStatuses: "paused",
    healthStatus: "stopped",
    stopReason: "lifetime_timeout",
  });

  return { id: sandbox.id, action: "deleted_abandoned_paused" };
}

export async function stopSandbox(
  sandbox: Pick<
    ReaperSandboxRecord,
    "id" | "sandbox_id" | "status" | "persistent"
  >,
  credentials: ReaperSandboxCredentials,
  options: {
    expectedHealthStatus?: string;
    onSuccessAction: ReaperStopAction;
    confirmedGone?: boolean;
    fromStatuses?: SandboxLifecycleStatus | readonly SandboxLifecycleStatus[];
  },
  overrides: StopSandboxOverrides = defaultStopSandboxDeps
) {
  const deps: StopSandboxDeps = {
    ...defaultStopSandboxDeps,
    ...overrides,
  };
  // Soft-pause path: persistent sandboxes keep their auto-snapshot so
  // the user can resume. We only soft-pause for user-recoverable causes
  // (idle, lifetime) - stuck-boot and vm-gone still hard-stop.
  const softPauseEligible =
    Boolean(sandbox.persistent) &&
    isSoftPausableReaperAction(options.onSuccessAction) &&
    !options.confirmedGone;

  if (!credentials.ok && sandbox.sandbox_id !== "pending") {
    await deps.updateSandboxRecord(
      sandbox.id,
      buildSandboxStopErrorUpdate(sandbox.status, credentials.error),
      {
        expectedSandboxId: sandbox.sandbox_id,
        fromStatuses: options.fromStatuses ?? REAPER_ACTIVE_STOP_STATUSES,
        expectedHealthStatus: options.expectedHealthStatus,
      }
    );

    return {
      stopped: false as const,
      action: "skipped_missing_billing_credentials",
    };
  }

  if (sandbox.sandbox_id === "pending" || options.confirmedGone) {
    if (options.confirmedGone) {
      // The liveness pass already proved the provider session is gone. Move
      // the ledger into closing before changing the record so scheduled
      // accrual cannot run past that observation. Reconciliation will use its
      // last confirmed provider timestamp for the final debit.
      await deps.prepareSandboxBillingClose(sandbox.id);
    }
    await deps.stopSandboxRecord(sandbox.id, {
      expectedSandboxId: sandbox.sandbox_id,
      expectedHealthStatus: options.expectedHealthStatus,
      fromStatuses: options.fromStatuses ?? REAPER_ACTIVE_STOP_STATUSES,
      stopReason: stopReasonForAction(options.onSuccessAction),
    });

    return {
      stopped: true as const,
      action: options.onSuccessAction,
    };
  }

  if (!credentials.ok) {
    return {
      stopped: false as const,
      action: "skipped_missing_billing_credentials",
    };
  }

  let currentSnapshotId: string | null;
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>>;
  let providerEndedAt: Date;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandbox.id);
    const vm = await deps.getSandbox(sandbox.sandbox_id, {
      vercelToken: credentials.vercelToken,
      vercelTeamId: credentials.vercelTeamId,
      vercelProjectId: credentials.vercelProjectId,
    });
    await vm.stop({ blocking: true });
    const providerSession = vm.currentSession();
    providerEndedAt =
      providerSession.stoppedAt ?? providerSession.updatedAt ?? new Date();
    currentSnapshotId = vm.currentSnapshotId ?? null;
  } catch (err) {
    console.warn(
      `[sandbox-reaper] Failed to stop VM ${sandbox.sandbox_id}:`,
      err
    );

    await deps.updateSandboxRecord(
      sandbox.id,
      buildSandboxStopErrorUpdate(
        sandbox.status,
        err instanceof Error ? err.message : "Failed to stop sandbox in Vercel"
      ),
      {
        expectedSandboxId: sandbox.sandbox_id,
        fromStatuses: options.fromStatuses ?? REAPER_ACTIVE_STOP_STATUSES,
        expectedHealthStatus: options.expectedHealthStatus,
      }
    );

    return {
      stopped: false as const,
      action: "skipped_stop_failed",
    };
  }

  try {
    await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
  } catch (billingError) {
    console.warn(
      `[sandbox-reaper] VM ${sandbox.sandbox_id} stopped, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }

  if (softPauseEligible) {
    await deps.updateSandboxRecord(
      sandbox.id,
      {
        status: "paused",
        health_status: "paused",
        ...(currentSnapshotId ? { snapshot_id: currentSnapshotId } : {}),
      },
      {
        expectedSandboxId: sandbox.sandbox_id,
        expectedHealthStatus: options.expectedHealthStatus,
        fromStatuses: options.fromStatuses ?? REAPER_ACTIVE_STOP_STATUSES,
      }
    );

    return {
      stopped: true as const,
      action: toPausedReaperAction(options.onSuccessAction),
    };
  }

  await deps.stopSandboxRecord(sandbox.id, {
    expectedSandboxId: sandbox.sandbox_id,
    expectedHealthStatus: options.expectedHealthStatus,
    fromStatuses: options.fromStatuses ?? REAPER_ACTIVE_STOP_STATUSES,
    stopReason: stopReasonForAction(options.onSuccessAction),
  });

  return {
    stopped: true as const,
    action: options.onSuccessAction,
  };
}
