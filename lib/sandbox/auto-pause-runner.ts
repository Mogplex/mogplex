import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import type { SandboxVmCredentials } from "@/lib/sandbox/liveness";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import {
  SANDBOX_AUTO_PAUSE_CLAIMED_STATUS,
  type SandboxAutoPausePayload,
  type SandboxAutoPauseRecord,
  type SandboxAutoPauseResult,
  type SandboxAutoPauseMode,
  type PresenceState,
  type SandboxAutoPauseClaimResult,
  type LifecycleEventInput,
} from "./auto-pause-types";
import { resolveSandboxAutoPauseMode } from "./auto-pause-presence";
import {
  loadSandboxRecord,
  loadPresenceState,
  hasActiveAiCall,
  hasRunningAutomation,
  claimAutoPause,
  resolveVmCredentials,
  normalizeAutoPauseClaimResult,
  recordAutoPauseDecision,
  buildAutoPauseResult,
  isClaimedOrFinalizedAutoPauseStatus,
  skipAutoPause,
  recordSandboxLifecycleEvent,
} from "./auto-pause-deps";

export type SandboxAutoPauseRunnerDeps = {
  loadSandboxRecord: (
    sandboxRecordId: string
  ) => Promise<SandboxAutoPauseRecord | null>;
  loadPresenceState: (input: {
    sandboxRecordId: string;
    releasedAt: string;
  }) => Promise<PresenceState>;
  hasActiveAiCall: (input: {
    sandboxRecordId: string;
    sandboxId: string;
  }) => Promise<boolean>;
  hasRunningAutomation: (sandboxRecordId: string) => Promise<boolean>;
  claimAutoPause: (input: {
    sandboxRecordId: string;
    sandboxId: string;
    releasedAt: string;
  }) => Promise<boolean | SandboxAutoPauseClaimResult>;
  resolveVmCredentials: (
    record: SandboxAutoPauseRecord
  ) => Promise<SandboxVmCredentials | null>;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  recordLifecycleEvent: (input: LifecycleEventInput) => Promise<string | null>;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
  resolveMode: (record: SandboxAutoPauseRecord) => SandboxAutoPauseMode;
  nowMs: () => number;
};

const defaultSandboxAutoPauseRunnerDeps: SandboxAutoPauseRunnerDeps = {
  loadSandboxRecord,
  loadPresenceState,
  hasActiveAiCall,
  hasRunningAutomation,
  claimAutoPause,
  resolveVmCredentials,
  getSandbox,
  updateSandboxRecord,
  recordLifecycleEvent: recordSandboxLifecycleEvent,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
  resolveMode: (record) => resolveSandboxAutoPauseMode(record.user_id),
  nowMs: () => Date.now(),
};

export async function runSandboxAutoPauseCheck(
  input: SandboxAutoPausePayload,
  overrides: Partial<SandboxAutoPauseRunnerDeps> = {}
): Promise<SandboxAutoPauseResult> {
  const deps: SandboxAutoPauseRunnerDeps = {
    ...defaultSandboxAutoPauseRunnerDeps,
    ...overrides,
  };
  const releasedAtMs = new Date(input.releasedAt).getTime();
  const elapsedMs = deps.nowMs() - releasedAtMs;
  if (!Number.isFinite(releasedAtMs) || elapsedMs < input.gracePeriodMs) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      null,
      "auto_pause_skipped_grace_period",
      "Auto-pause check ran before the grace period elapsed.",
      { elapsed_ms: Number.isFinite(elapsedMs) ? elapsedMs : null }
    );
  }

  const [record, presence, activeAiCall, runningAutomation] = await Promise.all(
    [
      deps.loadSandboxRecord(input.sandboxRecordId),
      deps.loadPresenceState({
        sandboxRecordId: input.sandboxRecordId,
        releasedAt: input.releasedAt,
      }),
      deps.hasActiveAiCall({
        sandboxRecordId: input.sandboxRecordId,
        sandboxId: input.sandboxId,
      }),
      deps.hasRunningAutomation(input.sandboxRecordId),
    ]
  );
  if (!record) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      null,
      "auto_pause_skipped_not_found",
      "Sandbox record no longer exists."
    );
  }

  if (record.sandbox_id !== input.sandboxId || record.status !== "running") {
    const statusChanged = isClaimedOrFinalizedAutoPauseStatus(record, input);
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      statusChanged
        ? "auto_pause_skipped_status_changed"
        : "auto_pause_skipped_not_running",
      statusChanged
        ? "Sandbox auto-pause was already claimed or finalized."
        : "Sandbox is no longer the released running VM.",
      { current_sandbox_id: record.sandbox_id, current_status: record.status }
    );
  }

  if (!record.persistent) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_not_persistent",
      "Sandbox is not persistent."
    );
  }

  if (record.exec_lock_token) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has an active exec lock.",
      { busy_reason: "exec_lock" }
    );
  }

  if (presence.activeSessionCount > 0 || presence.newerSessionEventCount > 0) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_new_session",
      "A workspace session is attached or a newer presence event exists.",
      presence
    );
  }

  if (activeAiCall) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has a pending or streaming AI call.",
      { busy_reason: "ai_call" }
    );
  }

  if (runningAutomation) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has a running automation.",
      { busy_reason: "automation" }
    );
  }

  const mode = deps.resolveMode(record);
  if (mode === "observe") {
    await recordAutoPauseDecision(
      deps.recordLifecycleEvent,
      input,
      record,
      "would_auto_pause",
      { mode }
    );
    return buildAutoPauseResult(
      "would_auto_pause",
      "Sandbox would auto-pause; observe-only mode is active."
    );
  }

  const credentials = await deps.resolveVmCredentials(record);
  if (!credentials) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      record,
      "auto_pause_skipped_missing_credentials",
      "Sandbox VM credentials could not be resolved."
    );
  }

  // Keep the final checks close to the state transition. This is deliberately
  // one sequential pass, not a retry loop, so attach/exec/AI races have one
  // last chance to block the atomic claim.
  const finalRecord = await deps.loadSandboxRecord(input.sandboxRecordId);
  if (!finalRecord) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      null,
      "auto_pause_skipped_not_found",
      "Sandbox record no longer exists."
    );
  }
  if (
    finalRecord.sandbox_id !== input.sandboxId ||
    finalRecord.status !== "running"
  ) {
    const statusChanged = isClaimedOrFinalizedAutoPauseStatus(
      finalRecord,
      input
    );
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      statusChanged
        ? "auto_pause_skipped_status_changed"
        : "auto_pause_skipped_not_running",
      statusChanged
        ? "Sandbox auto-pause was already claimed or finalized."
        : "Sandbox is no longer the released running VM.",
      {
        current_sandbox_id: finalRecord.sandbox_id,
        current_status: finalRecord.status,
      }
    );
  }
  if (!finalRecord.persistent) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_not_persistent",
      "Sandbox is not persistent."
    );
  }
  if (finalRecord.exec_lock_token) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has an active exec lock.",
      { busy_reason: "exec_lock", phase: "final_check" }
    );
  }

  const finalPresence = await deps.loadPresenceState({
    sandboxRecordId: input.sandboxRecordId,
    releasedAt: input.releasedAt,
  });
  if (
    finalPresence.activeSessionCount > 0 ||
    finalPresence.newerSessionEventCount > 0
  ) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_new_session",
      "A workspace session is attached or a newer presence event exists.",
      { ...finalPresence, phase: "final_check" }
    );
  }
  if (
    await deps.hasActiveAiCall({
      sandboxRecordId: input.sandboxRecordId,
      sandboxId: input.sandboxId,
    })
  ) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has a pending or streaming AI call.",
      { busy_reason: "ai_call", phase: "final_check" }
    );
  }
  if (await deps.hasRunningAutomation(input.sandboxRecordId)) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has a running automation.",
      { busy_reason: "automation", phase: "final_check" }
    );
  }

  const claimResult = normalizeAutoPauseClaimResult(
    await deps.claimAutoPause({
      sandboxRecordId: input.sandboxRecordId,
      sandboxId: input.sandboxId,
      releasedAt: input.releasedAt,
    })
  );
  if (!claimResult.claimed) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_status_changed",
      "Sandbox changed or became busy before the auto-pause claim committed.",
      { phase: "claim" }
    );
  }

  const previousHealthStatus =
    claimResult.previousHealthStatus ?? finalRecord.health_status ?? "running";
  let sandbox: Awaited<ReturnType<typeof getSandbox>>;
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
    null;
  try {
    billingClose = await deps.prepareSandboxBillingClose(finalRecord.id);
  } catch (billingError) {
    console.warn(
      "[sandbox/auto-pause] Billing close preparation failed; stopping idle compute and leaving ledger closure to reconciliation:",
      billingError
    );
  }
  try {
    sandbox = await deps.getSandbox(finalRecord.sandbox_id, credentials);
    await sandbox.stop({ blocking: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Auto-pause failed";
    await deps
      .updateSandboxRecord(
        finalRecord.id,
        {
          status: "running",
          health_status: previousHealthStatus,
          stop_reason: null,
        },
        {
          expectedSandboxId: finalRecord.sandbox_id,
          fromStatuses: SANDBOX_AUTO_PAUSE_CLAIMED_STATUS,
        }
      )
      .catch((restoreError) => {
        console.warn(
          "[sandbox/auto-pause] Failed to restore running state after auto-pause stop failure:",
          restoreError
        );
      });
    await recordAutoPauseDecision(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_failed",
      { error: message }
    );
    return buildAutoPauseResult("auto_pause_failed", message);
  }

  try {
    const providerSession = sandbox.currentSession();
    await deps.finalizeSandboxBillingClose(
      billingClose,
      providerSession.stoppedAt ?? providerSession.updatedAt ?? new Date()
    );
  } catch (billingError) {
    console.warn(
      "[sandbox/auto-pause] Sandbox stopped, but billing finalization failed; reconciliation will retry:",
      billingError
    );
  }

  const snapshotId = sandbox.currentSnapshotId ?? null;
  if (!snapshotId && finalRecord.persistent) {
    console.warn(
      "[sandbox/auto-pause] Persistent sandbox stopped without a snapshot ID:",
      { sandboxRecordId: finalRecord.id, sandboxId: finalRecord.sandbox_id }
    );
  }

  let finalized = false;
  try {
    const finalUpdate = await deps.updateSandboxRecord(
      finalRecord.id,
      {
        status: "paused",
        health_status: "paused",
        stop_reason: "auto_pause",
        snapshot_id: snapshotId,
      },
      {
        expectedSandboxId: finalRecord.sandbox_id,
        fromStatuses: SANDBOX_AUTO_PAUSE_CLAIMED_STATUS,
      }
    );
    finalized = Boolean(finalUpdate);
  } catch (finalizeError) {
    console.warn(
      "[sandbox/auto-pause] Sandbox stopped, but paused-state finalize failed:",
      finalizeError
    );
  }

  if (!finalized) {
    return skipAutoPause(
      deps.recordLifecycleEvent,
      input,
      finalRecord,
      "auto_pause_skipped_status_changed",
      "Sandbox auto-pause finalize was superseded after the VM stopped.",
      { phase: "finalize", snapshot_id: snapshotId }
    );
  }

  await recordAutoPauseDecision(
    deps.recordLifecycleEvent,
    input,
    finalRecord,
    "auto_pause_succeeded",
    { snapshot_id: snapshotId }
  );
  return buildAutoPauseResult(
    "auto_pause_succeeded",
    "Sandbox auto-paused.",
    true
  );
}
