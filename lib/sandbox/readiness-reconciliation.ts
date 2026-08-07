import { metadata, tasks, wait } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { getSandbox, previewAllowsRoot404 } from "@/lib/sandbox/client";
import { createSandboxBillingOnResume } from "@/lib/billing/sandbox-usage";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import { stopSandboxRecord, updateSandboxRecord } from "@/lib/sandbox/records";
import {
  resolveSandboxPath,
  resolveSandboxRootDirectory,
} from "@/lib/repo-settings";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import {
  ACTIVE_RECONCILE_STATUSES,
  SANDBOX_RECONCILE_SELECT,
  TRANSIENT_HEALTH_STATUSES,
  buildClientRecord,
  getAuthModeFromBillingSource,
  isSettledSandbox,
  normalizeRecordedLiveSandboxStatus,
  recoverPreviewUrlFromLiveSandbox,
  shouldClearBootError,
  shouldLoadProjectVercelDiagnostics,
  toRepo,
} from "@/lib/sandbox/readiness-helpers";
import type { SandboxReconcileRecord } from "@/lib/sandbox/readiness-helpers";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";
import type { SandboxRecord } from "@/lib/types";

import { isSnapshotNotFoundSandboxError } from "@/lib/sandbox/readiness-errors";
// Re-export for API compatibility
export { isSnapshotNotFoundSandboxError } from "@/lib/sandbox/readiness-errors";

const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 45_000];
export type SandboxReadinessReconciliationInput = {
  sandboxRecordId: string;
  expectedSandboxId?: string | null;
  source: "launch" | "manual" | "health";
};

type StartSandboxReadinessDeps = {
  isTriggerRuntimeConfigured: typeof isTriggerRuntimeConfigured;
  startTriggerRun: typeof tasks.trigger;
};
type ReconcileSandboxReadinessDeps = {
  loadSandboxRecord: (
    sandboxRecordId: string
  ) => Promise<SandboxReconcileRecord | null>;
  loadLatestSandboxRecord: (
    sandboxRecordId: string
  ) => Promise<SandboxReconcileRecord | null>;
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  loadUserPlatformAccess: typeof loadUserPlatformAccess;
  getSandbox: typeof getSandbox;
  resolveSandboxRecordContext: typeof resolveSandboxRecordContext;
  checkSandboxHealth: typeof checkSandboxHealth;
  updateSandboxRecord: typeof updateSandboxRecord;
  stopSandboxRecord: typeof stopSandboxRecord;
  loadSandboxVercelDiagnostics: typeof loadSandboxVercelDiagnostics;
};

type ReconcileSandboxReadinessOptions = {
  includeDiagnostics?: boolean;
};

type ReconcileSandboxReadinessResult = {
  sandbox: SandboxRecord;
  rawRecord: SandboxReconcileRecord;
  isSettled: boolean;
};

const defaultStartDeps: StartSandboxReadinessDeps = {
  isTriggerRuntimeConfigured,
  startTriggerRun: tasks.trigger,
};

const defaultReconcileDeps: ReconcileSandboxReadinessDeps = {
  async loadSandboxRecord(sandboxRecordId) {
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select(SANDBOX_RECONCILE_SELECT)
      .eq("id", sandboxRecordId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to load sandbox ${sandboxRecordId}: ${error.message}`
      );
    }

    return (data as SandboxReconcileRecord | null) ?? null;
  },
  async loadLatestSandboxRecord(sandboxRecordId) {
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select(SANDBOX_RECONCILE_SELECT)
      .eq("id", sandboxRecordId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to reload sandbox ${sandboxRecordId}: ${error.message}`
      );
    }

    return (data as SandboxReconcileRecord | null) ?? null;
  },
  loadUserVercelCredentials,
  loadUserPlatformAccess,
  getSandbox,
  resolveSandboxRecordContext,
  checkSandboxHealth,
  updateSandboxRecord,
  stopSandboxRecord,
  loadSandboxVercelDiagnostics,
};

export function createStartSandboxReadinessReconciliation(
  overrides: Partial<StartSandboxReadinessDeps> = {}
) {
  const deps: StartSandboxReadinessDeps = {
    ...defaultStartDeps,
    ...overrides,
  };

  return async function startSandboxReadinessReconciliation(
    input: SandboxReadinessReconciliationInput
  ) {
    if (!deps.isTriggerRuntimeConfigured()) {
      return {
        queued: false as const,
        runtimeProvider: null,
        runtimeRunId: null,
        reason: "trigger_not_configured" as const,
      };
    }

    const handle = await deps.startTriggerRun(
      TRIGGER_TASK_IDS.sandboxReadinessReconciliation,
      input,
      {
        idempotencyKey: [
          "sandbox-readiness",
          input.sandboxRecordId,
          input.expectedSandboxId ?? "latest",
          input.source,
        ].join(":"),
        concurrencyKey: `sandbox:${input.sandboxRecordId}`,
        maxAttempts: 1,
        tags: [`sandbox:${input.sandboxRecordId}`, `source:${input.source}`],
        metadata: {
          sandboxRecordId: input.sandboxRecordId,
          expectedSandboxId: input.expectedSandboxId ?? null,
          source: input.source,
        },
      }
    );

    return {
      queued: true as const,
      runtimeProvider: "trigger" as const,
      runtimeRunId: handle.id ?? null,
      reason: null,
    };
  };
}

export const startSandboxReadinessReconciliation =
  createStartSandboxReadinessReconciliation();

export async function reconcileSandboxReadiness(
  input: SandboxReadinessReconciliationInput,
  options: ReconcileSandboxReadinessOptions = {},
  overrides: Partial<ReconcileSandboxReadinessDeps> = {}
): Promise<ReconcileSandboxReadinessResult | null> {
  const deps: ReconcileSandboxReadinessDeps = {
    ...defaultReconcileDeps,
    ...overrides,
  };

  const record = await deps.loadSandboxRecord(input.sandboxRecordId);
  if (!record) return null;
  if (
    input.expectedSandboxId &&
    record.sandbox_id !== input.expectedSandboxId
  ) {
    return {
      sandbox: buildClientRecord(record),
      rawRecord: record,
      isSettled: isSettledSandbox(record),
    };
  }

  if (record.sandbox_id === "pending") {
    return {
      sandbox: buildClientRecord(record),
      rawRecord: record,
      isSettled: false,
    };
  }

  const [userVercelCredentials, platformAccess] = await Promise.all([
    deps.loadUserVercelCredentials(record.user_id),
    deps
      .loadUserPlatformAccess(record.user_id, record.product_team_id)
      .catch((error) => {
        console.warn(
          `[sandbox/readiness] Failed to load platform access for ${record.user_id}; assuming access is disabled`,
          error
        );
        return {
          allowPlatformAi: false,
          allowPlatformSandbox: false,
        };
      }),
  ]);

  const contextResult = await deps.resolveSandboxRecordContext({
    sandboxCredentials: {
      userId: record.user_id,
      productTeamId: record.product_team_id,
      ...getPlatformSandboxCredentials(),
      allowPlatformSandbox: platformAccess.allowPlatformSandbox,
      ...userVercelCredentials,
    },
    record,
    includeAi: false,
  });

  if (!contextResult.ok) {
    return {
      sandbox: buildClientRecord(record),
      rawRecord: record,
      isSettled: isSettledSandbox(record),
    };
  }

  const { credentials, ownership } = contextResult.context;
  let resolvedPreviewUrl = record.preview_url;
  const liveSandboxStatus: "running" | "pending" | "stopped" =
    await (async () => {
      const sandbox = await deps.getSandbox(
        record.sandbox_id,
        {
          vercelToken: credentials.vercelToken,
          vercelTeamId: credentials.vercelTeamId,
          vercelProjectId: credentials.vercelProjectId,
        },
        {
          resume: false,
          onResume: createSandboxBillingOnResume(record.id),
        }
      );
      const nextStatus =
        sandbox.status === "running"
          ? "running"
          : sandbox.status === "pending"
            ? "pending"
            : "stopped";

      // Guard on the live VM status (this inner `nextStatus`), not the reconciled
      // record status computed later in the outer function.
      if (nextStatus === "running") {
        resolvedPreviewUrl = recoverPreviewUrlFromLiveSandbox(record, sandbox);
        try {
          const devLog = await sandbox.readFile({
            // Read dev.log from the workspace the sandbox actually
            // booted in. Same fix as the health route — falling back
            // to repo.root_directory silently corrupts the log read
            // for monorepo users on a non-default workspace.
            path: resolveSandboxPath(
              resolveSandboxRootDirectory(record, toRepo(record)),
              ".mogplex/dev.log"
            ),
          });
          if (typeof devLog === "string") {
            record.dev_log = devLog;
          }
        } catch (error) {
          if (isSnapshotNotFoundSandboxError(error)) {
            console.debug(
              "Skipped sandbox dev log read during readiness reconciliation because no snapshot exists",
              error
            );
          } else {
            console.error(
              "Failed to read sandbox dev log during readiness reconciliation",
              error
            );
          }
        }
      }
      return nextStatus;
    })().catch((error) => {
      console.warn(
        `[sandbox/readiness] Failed to load sandbox ${record.sandbox_id}; reusing persisted lifecycle state`,
        error
      );
      return normalizeRecordedLiveSandboxStatus(record.status);
    });

  let diagnostics = null;
  const timestamp = new Date().toISOString();

  if (liveSandboxStatus === "stopped") {
    // Route through stopSandboxRecord so cost telemetry (compute_seconds,
    // cost_cents_estimate, stopped_at) stays consistent with other stop paths,
    // including the rate-override branch the DB trigger doesn't cover. The
    // preview-error/dev-log metadata is folded in via additionalUpdates so the
    // whole transition lands atomically — splitting into two writes would
    // leave a window where the row is stopped but error fields are stale.
    await deps.stopSandboxRecord(record.id, {
      expectedSandboxId: record.sandbox_id,
      fromStatuses: ACTIVE_RECONCILE_STATUSES,
      stopReason: "vm_gone",
      additionalUpdates: {
        last_health_check_at: timestamp,
        last_preview_http_status: null,
        last_preview_error: "Sandbox is no longer running",
        dev_log: record.dev_log ?? "",
      },
    });

    // stopSandboxRecord returns a narrow record (id, sandbox_id, status,
    // health_status) by design, so reload the full record for the response.
    // Fallback literal fires only when the record was concurrently deleted —
    // dev_log carries whatever was read from the VM mid-flight.
    const latestRecord = (await deps.loadLatestSandboxRecord(record.id)) ?? {
      ...record,
      status: "stopped",
      health_status: "stopped",
      stop_reason: "vm_gone",
      last_health_check_at: timestamp,
      last_preview_error: "Sandbox is no longer running",
    };

    // stopSandboxRecord is a no-op when the row was concurrently moved out of
    // ACTIVE_RECONCILE_STATUSES (e.g. another reconciler or the reaper already
    // settled it). Derive isSettled from the reloaded record so a row that is
    // still "running" doesn't prematurely terminate the retry loop.
    return {
      sandbox: buildClientRecord(latestRecord),
      rawRecord: latestRecord,
      isSettled: isSettledSandbox(latestRecord),
    };
  }

  const previewHealth = await deps.checkSandboxHealth(
    resolvedPreviewUrl,
    {
      sandboxId: record.sandbox_id,
      token: credentials.vercelToken,
      projectId: credentials.vercelProjectId,
      teamId: credentials.vercelTeamId,
    },
    {
      treatRoot404AsReady: previewAllowsRoot404({
        runtime: record.runtime as SandboxRuntime | null | undefined,
      }),
    }
  );

  const healthStatus =
    record.health_status === "idle_warning" &&
    previewHealth.status === "running"
      ? "idle_warning"
      : previewHealth.status;

  if (
    shouldLoadProjectVercelDiagnostics({
      includeDiagnostics: options.includeDiagnostics,
      recordStatus: record.status,
      previewUrl: resolvedPreviewUrl,
      previewHealthStatus: previewHealth.status,
    })
  ) {
    try {
      diagnostics = await deps.loadSandboxVercelDiagnostics({
        authMode: getAuthModeFromBillingSource(ownership.billingSource),
        vercelToken: credentials.vercelToken,
        teamId: credentials.vercelTeamId,
        projectId: credentials.vercelProjectId,
      });
    } catch (error) {
      console.error(
        "Failed to load Vercel diagnostics during readiness reconciliation",
        error
      );
    }
  }

  // During bootstrap the VM is "running" long before install + dev server
  // finish.  Only promote to "running" when preview health confirms readiness,
  // so the SSE bootstrap stream can complete without being superseded.
  const isBootstrapping =
    record.status === "creating" || record.status === "installing";

  const shouldPromoteToRunning = isBootstrapping
    ? previewHealth.status === "running" || previewHealth.status === "app_error"
    : liveSandboxStatus === "running" ||
      (!TRANSIENT_HEALTH_STATUSES.has(previewHealth.status) &&
        previewHealth.status !== "stopped") ||
      previewHealth.status === "starting";

  const nextStatus =
    previewHealth.status === "stopped"
      ? "stopped"
      : shouldPromoteToRunning
        ? "running"
        : record.status === "creating"
          ? "creating"
          : "installing";

  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    health_status: healthStatus,
    preview_url: resolvedPreviewUrl,
    last_health_check_at: timestamp,
    last_preview_http_status: previewHealth.statusCode ?? null,
    last_preview_error:
      previewHealth.status === "running" ||
      previewHealth.status === "idle_warning"
        ? null
        : diagnostics?.buildSummary || previewHealth.message,
    dev_log: record.dev_log ?? "",
    error: nextStatus === "running" ? null : record.error,
  };

  if (nextStatus === "running") {
    updatePayload.last_active_at = timestamp;
  }

  if (shouldClearBootError(nextStatus, healthStatus)) {
    updatePayload.last_boot_completed_at = timestamp;
    updatePayload.last_boot_error = null;
    updatePayload.error = null;
  }

  const updated = await deps.updateSandboxRecord(record.id, updatePayload, {
    expectedSandboxId: record.sandbox_id,
    fromStatuses: ACTIVE_RECONCILE_STATUSES,
    select: SANDBOX_RECONCILE_SELECT,
  });

  const latestRecord = (updated as SandboxReconcileRecord | null) ??
    (await deps.loadLatestSandboxRecord(record.id)) ?? {
      ...record,
      ...(updatePayload as Partial<SandboxReconcileRecord>),
    };

  return {
    sandbox: buildClientRecord(latestRecord, diagnostics),
    rawRecord: latestRecord,
    isSettled: isSettledSandbox(latestRecord),
  };
}

export async function executeSandboxReadinessReconciliation(
  input: SandboxReadinessReconciliationInput
) {
  metadata.set("sandboxRecordId", input.sandboxRecordId);
  metadata.set("expectedSandboxId", input.expectedSandboxId ?? null);
  metadata.set("source", input.source);

  let latestResult: ReconcileSandboxReadinessResult | null = null;

  for (const delayMs of [0, ...DEFAULT_RETRY_DELAYS_MS]) {
    if (delayMs > 0) {
      await wait.until({ date: new Date(Date.now() + delayMs) });
    }

    latestResult = await reconcileSandboxReadiness(input);
    if (!latestResult || latestResult.isSettled) {
      break;
    }
  }

  return {
    success: latestResult !== null,
    sandbox: latestResult?.sandbox ?? null,
    isSettled: latestResult?.isSettled ?? false,
  };
}
