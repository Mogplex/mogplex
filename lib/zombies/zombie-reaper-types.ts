/**
 * Catches rows that crashed mid-flight in long-lived transient states
 * (`pending`/`streaming`/`running` etc.) past their liveness threshold.
 * Fixes the same class of bug the chat-429 zombie hit (#297-300) but
 * before it reaches a user.
 *
 * Targets, in priority order:
 *   1. ai_calls          — chat: 5 min, agent: 6 hr (keeps crashed streams
 *                           out of live-run status surfaces)
 *   2. repos             — snapshot_build_token stuck > 15 min
 *   3. job_runs          — status='running' past 6 hr (Trigger.dev
 *                           workflow died silently)
 *   4. sandboxes (locks)  — exec_lock_token held past lockStaleSeconds,
 *                           OR held while sandbox is no longer in an
 *                           active status (an exec route failed to
 *                           release before the sandbox was stopped /
 *                           paused / errored).
 *   5. connections (test) — health_status='testing' with an
 *                           active_test_token that never cleared.
 *                           Happens when the test route's serverless
 *                           function dies between markConnectionTesting
 *                           and respondWithPersistedResult — the row
 *                           sits in 'testing' forever until reaped.
 *
 * Each reaper runs independently. A failure in one does not prevent
 * the others from running — the summary aggregates per-table outcomes.
 */

export type ZombieReaperResult = {
  table: "ai_calls" | "repos" | "job_runs" | "sandboxes" | "connections";
  id: string;
  /**
   * Milliseconds the row spent in its zombie state. `null` when the
   * row's anchor timestamp was missing or unparseable (e.g. legacy
   * snapshot-build locks with no `snapshot_build_started_at`). Using
   * `null` instead of `0` keeps Sentry / HTTP consumers from
   * mistaking a malformed-legacy reap for a "0ms old" false positive.
   */
  ageMs: number | null;
  action: "marked_failed" | "released_lock" | "cancelled";
  detail?: string;
};

export type ZombieReaperTableSummary = {
  table: ZombieReaperResult["table"];
  scanned: number;
  reaped: number;
  results: ZombieReaperResult[];
  error: string | null;
};

export type ZombieReaperSummary = {
  processed: number;
  reaped: number;
  message: string;
  tables: ZombieReaperTableSummary[];
};

export class ZombieReaperRunError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ZombieReaperRunError";
    this.status = status;
  }
}

export type ZombieReaperRunnerDeps = {
  reapStaleAiCalls: () => Promise<ZombieReaperTableSummary>;
  reapStaleSnapshotLocks: () => Promise<ZombieReaperTableSummary>;
  reapStaleJobRuns: () => Promise<ZombieReaperTableSummary>;
  reapStaleExecLocks: () => Promise<ZombieReaperTableSummary>;
  reapStaleConnectionTests: () => Promise<ZombieReaperTableSummary>;
  captureWarning: (message: string, extra: Record<string, unknown>) => void;
};

export const ZOMBIE_REAPED_ERROR_MESSAGE =
  "Run interrupted before finalize (reaped by zombie-row-reaper)";
export const ZOMBIE_REAPED_CANCEL_REASON = "ZOMBIE_REAPED";

export function safeAgeMs(anchor: string | null, now: number): number | null {
  if (!anchor) return null;
  const ms = new Date(anchor).getTime();
  if (!Number.isFinite(ms)) return null;
  return now - ms;
}
