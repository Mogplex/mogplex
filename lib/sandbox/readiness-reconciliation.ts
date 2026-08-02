import { metadata, tasks, wait } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { getSandbox, previewAllowsRoot404 } from "@/lib/sandbox/client";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import { stopSandboxRecord, updateSandboxRecord } from "@/lib/sandbox/records";
import {
  normalizeDevPort,
  resolveConfiguredDevPort,
  resolveSandboxPath,
  resolveSandboxRootDirectory,
} from "@/lib/repo-settings";
import { getStrategy } from "@/lib/sandbox/runtimes";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";
import type { SandboxRecord, SandboxRecordRow } from "@/lib/types";
import type { VercelAuthMode } from "@/lib/vercel/service";

const SANDBOX_RECONCILE_SELECT = [
  "id",
  "user_id",
  "repo_id",
  "sandbox_id",
  "base_branch",
  "working_branch",
  "snapshot_id",
  "install_log",
  "dev_log",
  "runtime",
  "terminal_cwd",
  // Per-launch path snapshot — preferred over repo.root_directory when
  // resolving paths inside the sandbox (e.g. .mogplex/dev.log reads).
  "root_directory",
  "status",
  "stop_reason",
  "preview_url",
  "health_status",
  "last_health_check_at",
  "last_active_at",
  "last_preview_http_status",
  "last_preview_error",
  "last_boot_error",
  "boot_attempts",
  "last_boot_started_at",
  "last_boot_completed_at",
  "billing_source",
  "billing_team_id",
  "billing_project_id",
  "vercel_team_id",
  "vercel_project_id",
  "error",
  "created_at",
  "repo:repos(root_directory, dev_port, dev_port_auto)",
].join(", ");

const ACTIVE_RECONCILE_STATUSES = [
  "creating",
  "installing",
  "running",
] as const;
const TRANSIENT_HEALTH_STATUSES = new Set(["starting", "not_available"]);
const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 45_000];

type SandboxReconcileRecord = SandboxRecordRow & {
  repo?:
    | {
        root_directory?: string | null;
        dev_port?: number | null;
        dev_port_auto?: unknown;
      }
    | {
        root_directory?: string | null;
        dev_port?: number | null;
        dev_port_auto?: unknown;
      }[]
    | null;
};

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

function toRepo(record: SandboxReconcileRecord) {
  return Array.isArray(record.repo) ? record.repo[0] : record.repo;
}

function isSettledSandbox(record: SandboxReconcileRecord) {
  if (record.status === "stopped" || record.status === "error") return true;
  return !TRANSIENT_HEALTH_STATUSES.has(
    record.health_status ?? "not_available"
  );
}

function normalizeRecordedLiveSandboxStatus(
  status: string
): "running" | "pending" | "stopped" {
  if (status === "running") return "running";
  if (status === "creating" || status === "installing") return "pending";
  return "stopped";
}

function shouldClearBootError(status: string, healthStatus: string) {
  return status === "running" && !TRANSIENT_HEALTH_STATUSES.has(healthStatus);
}

function recoverPreviewUrlFromLiveSandbox(
  record: SandboxReconcileRecord,
  sandbox: { domain?: (port: number) => string }
) {
  if (record.preview_url) return record.preview_url;
  if (typeof sandbox.domain !== "function") return null;

  const repo = toRepo(record);
  const configuredPort = resolveConfiguredDevPort(
    repo?.dev_port,
    repo?.dev_port_auto
  );
  const strategy = getStrategy(record.runtime as SandboxRuntime | null);
  const port = normalizeDevPort(configuredPort ?? strategy.defaultPort);
  return sandbox.domain(port);
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

// Bail at 5 levels — guards against accidental cycles (e.g. error.cause === error)
// in SDK or JSON-parsed error chains that would otherwise blow the stack.
const MAX_ERROR_INSPECTION_DEPTH = 5;

function getErrorCode(value: unknown, depth = 0): string | null {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return null;
  const object = getObject(value);
  if (!object) return null;
  if (typeof object.code === "string") return object.code;

  return getErrorCode(object.error, depth + 1);
}

function getHttpStatus(error: unknown, depth = 0): number | null {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return null;
  const object = getObject(error);
  if (!object) return null;
  if (typeof object.status === "number") return object.status;
  if (typeof object.statusCode === "number") return object.statusCode;
  return getHttpStatus(object.response, depth + 1);
}

function bodyIncludesSnapshotNotFound(value: unknown, depth = 0): boolean {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return false;
  if (typeof value === "string") {
    return value.includes("snapshot_not_found");
  }

  const object = getObject(value);
  if (!object) return false;
  return (
    getErrorCode(object, depth + 1) === "snapshot_not_found" ||
    bodyIncludesSnapshotNotFound(object.body, depth + 1) ||
    bodyIncludesSnapshotNotFound(object.data, depth + 1)
  );
}

// Three-level detection so we catch snapshot_not_found across the shapes the
// Vercel sandbox SDK and REST envelopes return it in:
//   1. SDK errors expose the code at `.json.error.code`.
//   2. Plain errors expose `.code` directly at the top level.
//   3. REST envelopes return HTTP 400 with the marker buried in `.body`/`.data`
//      (string or nested object), so scan only those fields — scanning the
//      whole error object would risk a false positive from an unrelated
//      message/URL that happened to contain "snapshot_not_found".
export function isSnapshotNotFoundSandboxError(error: unknown): boolean {
  const object = getObject(error);
  if (!object) return false;
  if (getErrorCode(object.json) === "snapshot_not_found") return true;
  if (object.code === "snapshot_not_found") return true;

  return (
    getHttpStatus(object) === 400 &&
    (bodyIncludesSnapshotNotFound(object.body) ||
      bodyIncludesSnapshotNotFound(object.data))
  );
}

function shouldLoadProjectVercelDiagnostics(input: {
  includeDiagnostics?: boolean;
  recordStatus: string;
  previewUrl: string | null;
  previewHealthStatus: string;
}) {
  if (!input.includeDiagnostics) return false;
  if (!input.previewUrl) return false;
  if (
    input.previewHealthStatus === "running" ||
    input.previewHealthStatus === "idle_warning"
  ) {
    return false;
  }
  if (
    input.recordStatus === "creating" ||
    input.recordStatus === "installing" ||
    TRANSIENT_HEALTH_STATUSES.has(input.previewHealthStatus)
  ) {
    return false;
  }
  return true;
}

function getAuthModeFromBillingSource(source?: string | null): VercelAuthMode {
  return source === "user_vercel_project" ? "personal" : "platform";
}

function buildClientRecord(
  record: SandboxReconcileRecord,
  diagnostics?: Awaited<ReturnType<typeof loadSandboxVercelDiagnostics>> | null
) {
  return toSandboxClientRecord({
    ...record,
    ...(diagnostics ? { vercel_diagnostics: diagnostics } : {}),
  });
}

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
    deps.loadUserPlatformAccess(record.user_id).catch((error) => {
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
      const sandbox = await deps.getSandbox(record.sandbox_id, {
        vercelToken: credentials.vercelToken,
        vercelTeamId: credentials.vercelTeamId,
        vercelProjectId: credentials.vercelProjectId,
      });
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
