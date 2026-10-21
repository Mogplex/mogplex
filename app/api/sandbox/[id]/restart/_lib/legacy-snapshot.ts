import {
  readSandboxProviderSession,
  isSandboxProviderSessionTerminal,
} from "@/lib/billing/sandbox-usage";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import type { SandboxRestartDeps } from "./types";

type CaptureInput = {
  deps: SandboxRestartDeps;
  recordId: string;
  sandboxId: string;
  snapshotProjectId: string | null;
  snapshotTeamId: string | null;
  credentials: Parameters<SandboxRestartDeps["getSandbox"]>[1];
};
type CloseAttempt = NonNullable<
  Awaited<ReturnType<SandboxRestartDeps["prepareSandboxBillingClose"]>>
>;

export class LegacySnapshotError extends Error {
  constructor(
    readonly status: 409 | 503,
    cause?: unknown
  ) {
    super(
      status === 409
        ? "The workspace could not restart. Try again."
        : "Mogplex could not save the workspace snapshot. Contact support for recovery.",
      { cause }
    );
    this.name = "LegacySnapshotError";
  }
}

async function settleClose(
  input: CaptureInput,
  attempt: CloseAttempt,
  previousSessionId: string,
  snapshotCompletedAt: Date | null
) {
  let observed;
  try {
    // One read establishes the outcome; never wake or stop a VM to recover billing.
    observed = await input.deps.getSandbox(input.sandboxId, input.credentials, {
      resume: false,
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    const endedAt = snapshotCompletedAt ?? attempt.meteredThroughAt;
    if (!endedAt)
      throw new Error("Billing close watermark is unavailable", {
        cause: error,
      });
    await input.deps.finalizeSandboxBillingClose(attempt, endedAt);
    return true;
  }
  const current = readSandboxProviderSession(observed);
  if (current.sessionId !== previousSessionId) {
    const endedAt = current.hasReliableStartedAt
      ? current.startedAt
      : attempt.meteredThroughAt;
    if (!endedAt) throw new Error("Provider session boundary is unavailable");
    await input.deps.finalizeSandboxBillingClose(attempt, endedAt);
    return false;
  }
  if (isSandboxProviderSessionTerminal(current)) {
    await input.deps.finalizeSandboxBillingClose(
      attempt,
      current.stoppedAt ?? current.updatedAt
    );
    return true;
  }
  if (current.status === "running") {
    await input.deps.reopenSandboxBillingClose(attempt);
    return false;
  }
  // An unknown transition keeps its close generation for existing reconciliation.
  throw new Error("Provider session outcome is not yet known");
}

export async function captureLegacyWorkspaceSnapshot(
  input: CaptureInput
): Promise<string | null> {
  let sandbox;
  try {
    sandbox = await input.deps.getSandbox(input.sandboxId, input.credentials, {
      resume: false,
      onResume: async (resumed) => {
        await input.deps.requireSandboxBillingSession(input.recordId, resumed);
      },
    });
  } catch (error) {
    console.error("[sandbox/restart] Snapshot provider lookup failed", {
      sandboxRecordId: input.recordId,
      providerNotFound: isNotFoundError(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (!isNotFoundError(error)) throw error;
    return null;
  }
  const attempt = await input.deps.prepareSandboxBillingClose(input.recordId);
  const previousSessionId = attempt
    ? readSandboxProviderSession(sandbox).sessionId
    : "";
  let snapshotId: string | null = null;
  let snapshotCompletedAt: Date | null = null;
  try {
    // The provider uses 0 for no expiry; saved work must never age out.
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    snapshotId = snapshot.snapshotId;
    snapshotCompletedAt = new Date();
  } catch (error) {
    console.error("[sandbox/restart] Snapshot capture failed", {
      sandboxRecordId: input.recordId,
      providerNotFound: isNotFoundError(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
  let storageError: LegacySnapshotError | null = null;
  if (snapshotId) {
    try {
      // Save the recovery reference before any billing outcome can block restart.
      const saved = await input.deps.updateSandboxRecord(
        input.recordId,
        {
          snapshot_id: snapshotId,
          snapshot_billing_project_id: input.snapshotProjectId,
          snapshot_billing_team_id: input.snapshotTeamId,
        },
        { expectedSandboxId: input.sandboxId }
      );
      if (!saved)
        throw new Error(
          "Saved workspace changed before its snapshot was stored"
        );
    } catch (error) {
      console.error("[sandbox/restart] Failed to persist snapshot metadata:", {
        sandboxRecordId: input.recordId,
        snapshotId,
        error,
      });
      storageError = new LegacySnapshotError(503, error);
    }
  }
  // Even a failed metadata write must settle the prepared billing generation.
  const settled = attempt
    ? await settleClose(input, attempt, previousSessionId, snapshotCompletedAt)
    : true;
  if (storageError) throw storageError;
  if (!settled) throw new LegacySnapshotError(409);
  return snapshotId;
}
