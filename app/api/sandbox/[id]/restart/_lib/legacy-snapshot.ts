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
  credentials: Parameters<SandboxRestartDeps["getSandbox"]>[1];
};
type CloseAttempt = NonNullable<
  Awaited<ReturnType<SandboxRestartDeps["prepareSandboxBillingClose"]>>
>;

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
    });
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
    });
  }
  if (
    attempt &&
    !(await settleClose(input, attempt, previousSessionId, snapshotCompletedAt))
  )
    return null;
  return snapshotId;
}
