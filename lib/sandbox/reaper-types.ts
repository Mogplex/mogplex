import type { SandboxLifecycleStatus, StopReason } from "@/lib/types";

/** How long a sandbox can be stuck in creating/installing before we clean it up */
export const STUCK_BOOT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const STALE_PAUSING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const SANDBOX_PAUSING_STATUS =
  "pausing" satisfies SandboxLifecycleStatus;
export const REAPER_ACTIVE_STOP_STATUSES = [
  "creating",
  "installing",
  "running",
] as const satisfies readonly SandboxLifecycleStatus[];

/**
 * How long a paused persistent sandbox can linger before we destroy
 * it to release the auto-snapshot storage. Matches the 7-day
 * snapshotExpiration we pass at create time.
 */
export const PAUSED_SANDBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ReaperSandboxRecord = {
  id: string;
  sandbox_id: string;
  user_id: string;
  status: string;
  health_status: string;
  exec_lock_token: string | null;
  created_at: string;
  last_boot_started_at?: string | null;
  last_active_at: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  /**
   * When true, idle reaping soft-pauses the record (status -> 'paused')
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

export type FreshIdleState = {
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

export type ReaperSandboxDecision =
  | { handled: false }
  | { handled: true; result?: ReaperResult };

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

export function buildReaperResult(id: string, action: string): ReaperResult {
  return { id, action };
}

export function handledReaperDecision(
  result?: ReaperResult
): ReaperSandboxDecision {
  return result ? { handled: true, result } : { handled: true };
}

export function unhandledReaperDecision(): ReaperSandboxDecision {
  return { handled: false };
}

export function buildNoMaintenanceSummary(): SandboxReaperSummary {
  return {
    processed: 0,
    message: "No sandboxes requiring maintenance",
    reaped: 0,
    results: [],
  };
}

export function buildProcessedSandboxesSummary(
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

export function buildReaperLoadError(message: string) {
  return new SandboxReaperRunError(message, 500);
}
