import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
// Migrated to sdk-adapter per plan Phase 2 — makes the adapter the
// canonical choke-point for SDK-level calls from this module.
import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  MAX_SANDBOX_TIMEOUT_MS,
  resolveEffectiveSandboxIdleTimeoutMs,
  resolveEffectiveSandboxTimeoutMs,
} from "@/lib/repo-settings";
import { stopSandboxRecord, updateSandboxRecord } from "@/lib/sandbox/records";
import { resolveCrossUserActiveSandboxLivenessMap } from "@/lib/sandbox/liveness";
import {
  buildSandboxStopErrorUpdate,
  loadStaleStoppedSandboxes,
  repairStoppedSandboxHealthStatus,
  toReaperSandboxCredentials,
} from "@/lib/sandbox/reaper-helpers";
import type {
  ReaperSandboxCredentials,
  StaleStoppedSandboxRecord,
} from "@/lib/sandbox/reaper-helpers";
import type { SandboxLifecycleStatus, StopReason } from "@/lib/types";

/** How long a sandbox can be stuck in creating/installing before we clean it up */
const STUCK_BOOT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const STALE_PAUSING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SANDBOX_PAUSING_STATUS = "pausing" satisfies SandboxLifecycleStatus;
const REAPER_ACTIVE_STOP_STATUSES = [
  "creating",
  "installing",
  "running",
] as const satisfies readonly SandboxLifecycleStatus[];

/**
 * How long a paused persistent sandbox can linger before we destroy
 * it to release the auto-snapshot storage. Matches the 7-day
 * snapshotExpiration we pass at create time.
 */
const PAUSED_SANDBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ReaperSandboxRecord = {
  id: string;
  sandbox_id: string;
  user_id: string;
  status: string;
  health_status: string;
  exec_lock_token: string | null;
  created_at: string;
  last_active_at: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  /**
   * When true, idle reaping soft-pauses the record (status → 'paused')
   * so the user can resume. When false/missing, the idle path hard-stops
   * the record (legacy ephemeral sandboxes).
   */
  persistent?: boolean | null;
  repo:
    | {
        sandbox_timeout_ms?: number | null;
        sandbox_idle_timeout_ms?: number | null;
        workspace?:
          | {
              sandbox_timeout_ms?: number | null;
              sandbox_idle_timeout_ms?: number | null;
            }
          | {
              sandbox_timeout_ms?: number | null;
              sandbox_idle_timeout_ms?: number | null;
            }[]
          | null;
      }
    | Array<{
        sandbox_timeout_ms?: number | null;
        sandbox_idle_timeout_ms?: number | null;
        workspace?:
          | {
              sandbox_timeout_ms?: number | null;
              sandbox_idle_timeout_ms?: number | null;
            }
          | {
              sandbox_timeout_ms?: number | null;
              sandbox_idle_timeout_ms?: number | null;
            }[]
          | null;
      }>
    | null;
};

type FreshIdleState = {
  last_active_at: string | null;
  health_status: string;
};

export type ReaperResult = {
  id: string;
  action: string;
};

export type SandboxReaperSummary = {
  processed: number;
  message: string;
  reaped: number;
  results: ReaperResult[];
};

export class SandboxReaperRunError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "SandboxReaperRunError";
    this.status = status;
  }
}

type StopSandboxDeps = {
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
};

const defaultStopSandboxDeps: StopSandboxDeps = {
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
};

export type AbandonedPausedSandboxRecord = {
  id: string;
  sandbox_id: string;
  user_id: string;
  last_active_at: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

export type SandboxReaperRunnerDeps = {
  loadActiveSandboxes: () => Promise<ReaperSandboxRecord[]>;
  loadStaleStoppedSandboxes: () => Promise<StaleStoppedSandboxRecord[]>;
  loadAbandonedPausedSandboxes: () => Promise<AbandonedPausedSandboxRecord[]>;
  loadBusySandboxIds: () => Promise<Set<string>>;
  getPlatformSandboxCredentials: typeof getPlatformSandboxCredentials;
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  resolveCrossUserActiveSandboxLivenessMap: typeof resolveCrossUserActiveSandboxLivenessMap;
  repairStoppedSandboxHealthStatus: typeof repairStoppedSandboxHealthStatus;
  stopSandbox: typeof stopSandbox;
  getSandbox: typeof getSandbox;
  deleteAbandonedPausedSandbox: typeof deleteAbandonedPausedSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  loadFreshIdleState: (sandboxId: string) => Promise<FreshIdleState | null>;
  nowMs: () => number;
};

async function loadActiveSandboxes() {
  const select =
    "id, sandbox_id, user_id, status, health_status, exec_lock_token, persistent, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(sandbox_timeout_ms, sandbox_idle_timeout_ms, workspace:workspaces(sandbox_timeout_ms, sandbox_idle_timeout_ms))";
  const pausingCutoffIso = new Date(
    Date.now() - STALE_PAUSING_THRESHOLD_MS
  ).toISOString();
  const [activeResult, stalePausingResult] = await Promise.all([
    // Oldest first + capped: if the active set ever exceeds the cap, the
    // stalest sandboxes are still seen this sweep and the rest next sweep.
    supabaseAdmin
      .from("sandboxes")
      .select(select)
      .in("status", ["running", "installing", "creating"])
      .order("created_at", { ascending: true })
      .limit(10000),
    supabaseAdmin
      .from("sandboxes")
      .select(select)
      .eq("status", SANDBOX_PAUSING_STATUS)
      .or(`last_active_at.is.null,last_active_at.lt.${pausingCutoffIso}`)
      .limit(50),
  ]);

  if (activeResult.error) {
    throw new Error(
      `Failed to load active sandboxes: ${activeResult.error.message}`
    );
  }
  if (stalePausingResult.error) {
    throw new Error(
      `Failed to load stale pausing sandboxes: ${stalePausingResult.error.message}`
    );
  }

  return [
    ...((activeResult.data ?? []) as ReaperSandboxRecord[]),
    ...((stalePausingResult.data ?? []) as ReaperSandboxRecord[]),
  ];
}

async function loadBusySandboxIds() {
  // These build the busy set that protects sandboxes from reaping; the sets
  // are inherently small (in-flight work only), so a generous cap bounds a
  // raised PostgREST max_rows without ever clipping real workloads.
  const [aiCallsResult, sessionsResult, automationResult] = await Promise.all([
    supabaseAdmin
      .from("ai_calls")
      .select("metadata")
      .in("status", ["pending", "streaming"])
      .limit(10000),
    supabaseAdmin
      .from("sandbox_client_sessions")
      .select("sandbox_record_id")
      .is("released_at", null)
      .limit(10000),
    supabaseAdmin
      .from("external_agent_runs")
      .select("sandbox_record_id")
      .in("status", ["pending", "streaming"])
      .limit(10000),
  ]);

  if (aiCallsResult.error) {
    throw new Error(
      `Failed to load active ai_calls: ${aiCallsResult.error.message}`
    );
  }
  if (sessionsResult.error) {
    throw new Error(
      `Failed to load active sandbox sessions: ${sessionsResult.error.message}`
    );
  }
  if (automationResult.error) {
    throw new Error(
      `Failed to load active external agent runs: ${automationResult.error.message}`
    );
  }

  return new Set([
    ...(aiCallsResult.data ?? [])
      .flatMap((call) => {
        const metadata = call.metadata as Record<string, unknown> | null;
        return [metadata?.sandbox_record_id, metadata?.sandbox_id];
      })
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
    ...(sessionsResult.data ?? [])
      .map((session) => session.sandbox_record_id)
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
    ...(automationResult.data ?? [])
      .map((run) => run.sandbox_record_id)
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
  ]);
}

async function loadFreshIdleState(sandboxId: string) {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select("last_active_at, health_status")
    .eq("id", sandboxId)
    .single();

  if (error) {
    console.warn(
      `[sandbox-reaper] Failed to refresh idle state for ${sandboxId}:`,
      error
    );
    return null;
  }

  return data as FreshIdleState | null;
}

async function loadAbandonedPausedSandboxes(): Promise<
  AbandonedPausedSandboxRecord[]
> {
  const cutoffIso = new Date(Date.now() - PAUSED_SANDBOX_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, user_id, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id"
    )
    .eq("status", "paused")
    .or(`last_active_at.is.null,last_active_at.lt.${cutoffIso}`)
    .limit(50);

  if (error) {
    throw new Error(
      `Failed to load abandoned paused sandboxes: ${error.message}`
    );
  }
  return (data ?? []) as AbandonedPausedSandboxRecord[];
}

const defaultDeleteAbandonedPausedDeps: Pick<
  StopSandboxDeps,
  "getSandbox" | "stopSandboxRecord"
> = {
  getSandbox,
  stopSandboxRecord,
};

export async function deleteAbandonedPausedSandbox(
  sandbox: AbandonedPausedSandboxRecord,
  credentials: ReaperSandboxCredentials,
  deps: Pick<
    StopSandboxDeps,
    "getSandbox" | "stopSandboxRecord"
  > = defaultDeleteAbandonedPausedDeps
): Promise<ReaperResult> {
  if (
    credentials.ok &&
    sandbox.sandbox_id &&
    sandbox.sandbox_id !== "pending"
  ) {
    try {
      const vm = await deps.getSandbox(sandbox.sandbox_id, {
        vercelToken: credentials.vercelToken,
        vercelTeamId: credentials.vercelTeamId,
        vercelProjectId: credentials.vercelProjectId,
      });
      await vm.delete();
    } catch (err) {
      console.warn(
        `[sandbox-reaper] Failed to delete abandoned paused VM ${sandbox.sandbox_id}; will still mark record stopped:`,
        err
      );
    }
  }

  await deps.stopSandboxRecord(sandbox.id, {
    expectedSandboxId: sandbox.sandbox_id,
    fromStatuses: "paused",
    healthStatus: "stopped",
    stopReason: "lifetime_timeout",
  });

  return { id: sandbox.id, action: "deleted_abandoned_paused" };
}

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
  nowMs: () => Date.now(),
};

type ReaperSandboxDecision =
  | { handled: false }
  | { handled: true; result?: ReaperResult };

type ActiveSandboxEvaluation = {
  credentials: ReaperSandboxCredentials;
  confirmedGone: boolean;
  vmRunning: boolean;
  idleThresholdMs: number;
  idleMs: number;
  ageMs: number;
  busy: boolean;
};

function buildReaperResult(id: string, action: string): ReaperResult {
  return { id, action };
}

function handledReaperDecision(result?: ReaperResult): ReaperSandboxDecision {
  return result ? { handled: true, result } : { handled: true };
}

function unhandledReaperDecision(): ReaperSandboxDecision {
  return { handled: false };
}

export function isReapedAction(action: string) {
  return (
    action === "stopped_vm_gone" ||
    action === "stopped_stuck_boot" ||
    action === "stopped_max_lifetime" ||
    action === "stopped_idle" ||
    action === "paused_idle" ||
    action === "paused_max_lifetime" ||
    action === "deleted_abandoned_paused" ||
    action === "finalized_stale_pausing" ||
    action === "paused_stale_pausing" ||
    action === "stopped_stale_pausing" ||
    action === "restored_stale_pausing"
  );
}

export type ReaperStopAction =
  | "stopped_idle"
  | "stopped_max_lifetime"
  | "stopped_stuck_boot"
  | "stopped_vm_gone";

export function stopReasonForAction(action: ReaperStopAction): StopReason {
  switch (action) {
    case "stopped_idle":
      return "idle_timeout";
    case "stopped_max_lifetime":
      return "lifetime_timeout";
    case "stopped_stuck_boot":
      return "stuck_boot";
    case "stopped_vm_gone":
      return "vm_gone";
  }
}

/**
 * Actions that should soft-pause (preserve state for resume) rather than
 * hard-stop when the target sandbox is persistent. Idle timeouts and
 * lifetime expiry are user-recoverable; stuck-boot and vm-gone are not.
 *
 * Switch-based so TypeScript flags any new ReaperStopAction member that
 * isn't explicitly classified — must stay in sync with toPausedReaperAction.
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

function buildNoMaintenanceSummary(): SandboxReaperSummary {
  return {
    processed: 0,
    message: "No sandboxes requiring maintenance",
    reaped: 0,
    results: [],
  };
}

function buildProcessedSandboxesSummary(
  processedCount: number,
  results: ReaperResult[]
): SandboxReaperSummary {
  return {
    processed: processedCount,
    message: `Processed ${processedCount} sandboxes`,
    reaped: results.filter((result) => isReapedAction(result.action)).length,
    results,
  };
}

export function buildSandboxReaperResponse(summary: SandboxReaperSummary) {
  if (summary.processed === 0) {
    return {
      message: summary.message,
      reaped: summary.reaped,
    };
  }

  return {
    message: summary.message,
    reaped: summary.reaped,
    results: summary.results,
  };
}

function buildReaperLoadError(message: string) {
  return new SandboxReaperRunError(message, 500);
}

async function loadReaperSandboxes(deps: SandboxReaperRunnerDeps) {
  try {
    const [activeSandboxes, staleStoppedSandboxes, abandonedPausedSandboxes] =
      await Promise.all([
        deps.loadActiveSandboxes(),
        deps.loadStaleStoppedSandboxes(),
        deps.loadAbandonedPausedSandboxes(),
      ]);

    return {
      activeSandboxes,
      staleStoppedSandboxes,
      abandonedPausedSandboxes,
    };
  } catch (error) {
    console.error("[sandbox-reaper] DB query failed:", error);
    throw buildReaperLoadError("Database query failed");
  }
}

async function processAbandonedPausedSandboxes(
  abandoned: AbandonedPausedSandboxRecord[],
  platformCredentials: {
    vercelToken: string | null;
    vercelTeamId?: string | null;
    vercelProjectId: string | null;
  },
  deps: SandboxReaperRunnerDeps
) {
  if (abandoned.length === 0) return [];
  // Platform creds missing means we can't call delete() — still mark
  // records stopped so they stop appearing in the UI.
  const platformOk =
    Boolean(platformCredentials.vercelToken) &&
    Boolean(platformCredentials.vercelProjectId);
  const results: ReaperResult[] = [];
  for (const sandbox of abandoned) {
    try {
      // Platform credentials only for now — user-linked Vercel projects
      // with abandoned paused records will need their own credential
      // resolution pass (mirror of resolveCrossUserActiveSandboxLivenessMap).
      // Simplest correct behaviour: attempt delete with platform creds
      // when the sandbox was platform-billed; mark the record stopped
      // either way so it stops clogging the UI.
      const credentials: ReaperSandboxCredentials =
        sandbox.billing_source === "user_vercel_project" || !platformOk
          ? {
              ok: false,
              error:
                sandbox.billing_source === "user_vercel_project"
                  ? "user-billed cleanup not yet implemented"
                  : "platform credentials unavailable",
            }
          : {
              ok: true,
              vercelToken: platformCredentials.vercelToken!,
              vercelTeamId: platformCredentials.vercelTeamId ?? null,
              vercelProjectId:
                sandbox.vercel_project_id ??
                sandbox.billing_project_id ??
                platformCredentials.vercelProjectId!,
            };
      const result = await deps.deleteAbandonedPausedSandbox(
        sandbox,
        credentials
      );
      results.push(result);
    } catch (err) {
      console.error(
        `[sandbox-reaper] Failed to delete abandoned paused sandbox ${sandbox.id}:`,
        err
      );
      results.push({ id: sandbox.id, action: "skipped_delete_failed" });
    }
  }
  return results;
}

async function loadBusySandboxIdsForReaper(deps: SandboxReaperRunnerDeps) {
  try {
    return await deps.loadBusySandboxIds();
  } catch (error) {
    console.error("[sandbox-reaper] Failed to load active ai_calls:", error);
    throw buildReaperLoadError("Failed to load active ai_calls");
  }
}

async function processStaleStoppedSandboxes(
  staleStoppedSandboxes: StaleStoppedSandboxRecord[],
  deps: SandboxReaperRunnerDeps
) {
  const results: ReaperResult[] = [];

  for (const sandbox of staleStoppedSandboxes) {
    try {
      const repairResult = await deps.repairStoppedSandboxHealthStatus(sandbox);
      results.push(buildReaperResult(sandbox.id, repairResult.action));
    } catch (error) {
      console.error(
        `[sandbox-reaper] Failed to repair stopped health status for ${sandbox.id}:`,
        error
      );
      results.push(
        buildReaperResult(sandbox.id, "repair_stopped_health_status_failed")
      );
    }
  }

  return results;
}

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

function buildActiveSandboxEvaluation(
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

  return {
    credentials: toReaperSandboxCredentials(liveness),
    confirmedGone: liveness?.kind === "stopped",
    vmRunning: liveness?.kind === "running",
    idleThresholdMs,
    idleMs: nowMs - lastActive,
    ageMs: nowMs - createdAt,
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
) {
  const stopResult = await deps.stopSandbox(sandbox, credentials, options);
  return buildReaperResult(sandbox.id, stopResult.action);
}

async function tryStopMissingVmSandbox(
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

function resolveRestoredPausingHealthStatus(healthStatus: string | null) {
  return healthStatus && healthStatus !== SANDBOX_PAUSING_STATUS
    ? healthStatus
    : "running";
}

async function finalizeStalePausingAsPaused(
  sandbox: ReaperSandboxRecord,
  deps: Pick<SandboxReaperRunnerDeps, "updateSandboxRecord">,
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

async function restoreStalePausingAsRunning(
  sandbox: ReaperSandboxRecord,
  deps: Pick<SandboxReaperRunnerDeps, "updateSandboxRecord">
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

async function tryReconcileStalePausingSandbox(
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

  try {
    const vm = await deps.getSandbox(sandbox.sandbox_id, {
      vercelToken: evaluation.credentials.vercelToken,
      vercelTeamId: evaluation.credentials.vercelTeamId ?? null,
      vercelProjectId: evaluation.credentials.vercelProjectId,
    });
    await vm.stop();
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

async function tryStopStuckBootSandbox(
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

async function tryStopExpiredSandbox(
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

async function tryHandleBusyRunningSandbox(
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

async function tryHandleIdleRunningSandbox(
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

async function tryClearRecoveredIdleWarning(
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

async function processActiveSandbox(
  sandbox: ReaperSandboxRecord,
  evaluation: ActiveSandboxEvaluation,
  deps: SandboxReaperRunnerDeps
) {
  const handlers = [
    tryReconcileStalePausingSandbox,
    tryStopMissingVmSandbox,
    tryStopStuckBootSandbox,
    tryStopExpiredSandbox,
    tryHandleBusyRunningSandbox,
    tryHandleIdleRunningSandbox,
    tryClearRecoveredIdleWarning,
  ] as const;

  for (const handler of handlers) {
    const decision = await handler(sandbox, evaluation, deps);
    if (decision.handled) {
      return decision.result ?? null;
    }
  }

  return null;
}

async function processActiveSandboxes(
  activeSandboxes: ReaperSandboxRecord[],
  busySandboxIds: Set<string>,
  livenessById: Awaited<
    ReturnType<
      SandboxReaperRunnerDeps["resolveCrossUserActiveSandboxLivenessMap"]
    >
  >,
  nowMs: number,
  deps: SandboxReaperRunnerDeps
) {
  const results: ReaperResult[] = [];

  for (const sandbox of activeSandboxes) {
    const evaluation = buildActiveSandboxEvaluation(
      sandbox,
      livenessById.get(sandbox.id),
      busySandboxIds,
      nowMs
    );
    const result = await processActiveSandbox(sandbox, evaluation, deps);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

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
  deps: StopSandboxDeps = defaultStopSandboxDeps
) {
  // Soft-pause path: persistent sandboxes keep their auto-snapshot so
  // the user can resume. We only soft-pause for user-recoverable causes
  // (idle, lifetime) — stuck-boot and vm-gone still hard-stop.
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
  try {
    const vm = await deps.getSandbox(sandbox.sandbox_id, {
      vercelToken: credentials.vercelToken,
      vercelTeamId: credentials.vercelTeamId,
      vercelProjectId: credentials.vercelProjectId,
    });
    await vm.stop();
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
