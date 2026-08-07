import type { getSandbox } from "@/lib/sandbox/client";
import { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/records";
import type { SandboxLifecycleConflictEvent } from "@/lib/sandbox/lifecycle-conflict";
import type { prepareSandboxBillingClose } from "@/lib/billing/sandbox-usage";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { PersistentRestartRecord, SandboxRestartDeps } from "./types";

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
    SandboxRestartDeps,
    "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
  >
) {
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
    null;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandboxRecordId);
  } catch (billingError) {
    console.warn(
      `[sandbox/restart] Billing close preparation failed after ${label} CAS conflict; reconciliation will recover:`,
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
      `[sandbox/restart] stop() after ${label} CAS conflict surfaced: ${
        stopErr instanceof Error ? stopErr.message : String(stopErr)
      }`
    );
    return;
  }
  try {
    await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
  } catch (billingError) {
    console.warn(
      `[sandbox/restart] VM stopped after ${label} CAS conflict, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }
}

export async function markSandboxRecordNonPersistent(
  deps: Pick<SandboxRestartDeps, "updateSandboxRecord">,
  record: Pick<PersistentRestartRecord, "id" | "sandbox_id">
) {
  try {
    const updated = await deps.updateSandboxRecord(
      record.id,
      { persistent: false },
      { expectedSandboxId: record.sandbox_id }
    );
    if (!updated) {
      console.warn(
        `[sandbox/restart] skipped marking ${record.id} as non-persistent before legacy fallback because the sandbox id changed`
      );
    }
  } catch (error) {
    console.warn(
      `[sandbox/restart] failed to mark ${record.id} as non-persistent before legacy fallback`,
      error
    );
  }
}

export function buildClientSnapshot(
  record: PersistentRestartRecord,
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

export function isActiveSandboxStatus(status: string) {
  return ACTIVE_SANDBOX_STATUSES.includes(
    status as (typeof ACTIVE_SANDBOX_STATUSES)[number]
  );
}

export function releaseSandboxBootLimitClaim(
  deps: Pick<SandboxRestartDeps, "releaseLimitClaim">,
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
