import type { getSandbox } from "@/lib/sandbox/client";
import type { SandboxLifecycleConflictEvent } from "@/lib/sandbox/lifecycle-conflict";
import type { prepareSandboxBillingClose } from "@/lib/billing/sandbox-usage";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxResumeRecord, SandboxResumeDeps } from "./types";

/**
 * toSandboxClientRecord expects non-null base_branch/working_branch. Our
 * record columns are NOT NULL in practice, but the type stays nullable
 * to match the DB schema — this helper normalizes for the client cast.
 */
export function buildClientSnapshot(
  record: SandboxResumeRecord,
  overrides: {
    status: string;
    health_status: string;
    preview_url?: string | null;
  }
) {
  return toSandboxClientRecord({
    id: record.id,
    user_id: record.user_id,
    repo_id: record.repo_id,
    sandbox_id: record.sandbox_id,
    base_branch: record.base_branch ?? "main",
    working_branch: record.working_branch ?? record.base_branch ?? "main",
    snapshot_id: record.snapshot_id,
    install_log: null,
    dev_log: null,
    runtime: record.runtime,
    terminal_cwd: record.terminal_cwd,
    root_directory: record.root_directory,
    created_at: record.created_at,
    last_active_at: record.last_active_at,
    status: overrides.status,
    health_status: overrides.health_status,
    preview_url:
      overrides.preview_url === undefined
        ? record.preview_url
        : overrides.preview_url,
    persistent: record.persistent,
  });
}

export function sseEncode(
  event: SandboxEvent | SandboxLifecycleConflictEvent
): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function stopSandboxAfterLifecycleConflict(
  sandbox: Awaited<ReturnType<typeof getSandbox>>,
  sandboxRecordId: string,
  label: string,
  deps: Pick<
    SandboxResumeDeps,
    "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
  >
) {
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
    null;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandboxRecordId);
  } catch (billingError) {
    console.warn(
      `[sandbox/resume] Billing close preparation failed after ${label} CAS conflict; reconciliation will recover:`,
      billingError
    );
  }
  let providerEndedAt: Date;
  try {
    await sandbox.stop({ blocking: true });
    // Conflict cleanup is best-effort and also accepts the lightweight
    // handles used by lifecycle recovery tests. Primary lifecycle paths use a
    // fully typed SDK Sandbox and call currentSession directly.
    const providerSession =
      typeof sandbox.currentSession === "function"
        ? sandbox.currentSession()
        : null;
    providerEndedAt =
      providerSession?.stoppedAt ?? providerSession?.updatedAt ?? new Date();
  } catch (stopErr) {
    console.warn(
      `[sandbox/resume] stop() after ${label} CAS conflict surfaced: ${
        stopErr instanceof Error ? stopErr.message : String(stopErr)
      }`
    );
    return;
  }
  try {
    await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
  } catch (billingError) {
    console.warn(
      `[sandbox/resume] VM stopped after ${label} CAS conflict, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }
}

export function releaseSandboxBootLimitClaim(
  deps: Pick<SandboxResumeDeps, "releaseLimitClaim">,
  userId: string,
  claimId: string | null
) {
  if (!claimId) return Promise.resolve(false);
  return deps.releaseLimitClaim({
    userId,
    routeKey: "sandbox_boot",
    claimId,
  });
}
