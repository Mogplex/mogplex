import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logConnectionEvent } from "@/lib/connections/logging";
import {
  ACTIVE_CHAT_STALE_THRESHOLD_MS,
  ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS,
  isStaleLiveInteractiveCall,
} from "@/lib/interactive-runs";
import {
  SNAPSHOT_BUILD_STALE_MS,
  isSnapshotBuildStale,
} from "@/lib/repo-snapshots";
import {
  STALE_RUNNING_JOB_THRESHOLD_MS,
  isStaleRunningJob,
} from "@/lib/workflows/job-run-repair";
import { cancelAutomationJobRun } from "@/lib/workflows/job-run-cancel";
import { REQUEST_LIMITS } from "@/lib/request-limits";

/**
 * Catches rows that crashed mid-flight in long-lived transient states
 * (`pending`/`streaming`/`running` etc.) past their liveness threshold.
 * Fixes the same class of bug the chat-429 zombie hit (#297-300) but
 * before it reaches a user.
 *
 * Targets, in priority order:
 *   1. ai_calls          — chat: 5 min, agent: 6 hr (matches the SQL
 *                           liveness filter in claim_chat_limit_admission
 *                           so a reaped row stops blocking new chats
 *                           immediately)
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

function safeAgeMs(anchor: string | null, now: number): number | null {
  if (!anchor) return null;
  const ms = new Date(anchor).getTime();
  if (!Number.isFinite(ms)) return null;
  return now - ms;
}

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

const ZOMBIE_REAPED_ERROR_MESSAGE =
  "Run interrupted before finalize (reaped by zombie-row-reaper)";
const ZOMBIE_REAPED_CANCEL_REASON = "ZOMBIE_REAPED";

const AI_CALL_CHAT_PAGE_LIMIT = 200;
const AI_CALL_INTERACTIVE_PAGE_LIMIT = 100;

type AiCallZombieRow = {
  id: string;
  type: string;
  status: string;
  started_at: string;
  user_id: string;
  conversation_id: string | null;
  repo_id: string | null;
};

/**
 * Two scoped queries instead of one big union:
 *
 *   - chat:        type='chat',     started_at < now() - 5 min
 *   - interactive: type != 'chat',  started_at < now() - 6 hr
 *
 * Doing it this way means a flood of long-running agent runs (5m–6h old
 * but legitimately live) cannot crowd newly-stale chat rows out of the
 * single 200-row page — the chat-unblock behaviour the launch flow
 * depends on stays prompt regardless of agent volume. Each scan also
 * uses its own exact SQL cutoff so the per-row predicate is mostly
 * defence-in-depth.
 */
type AiCallSelectResult =
  | { ok: true; rows: AiCallZombieRow[] }
  | { ok: false; error: string };

async function selectAiCallZombies(now: number): Promise<AiCallSelectResult> {
  const chatCutoffIso = new Date(
    now - ACTIVE_CHAT_STALE_THRESHOLD_MS
  ).toISOString();
  const interactiveCutoffIso = new Date(
    now - ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS
  ).toISOString();

  const [chatResult, interactiveResult] = await Promise.all([
    supabaseAdmin
      .from("ai_calls")
      .select("id, type, status, started_at, user_id, conversation_id, repo_id")
      .eq("type", "chat")
      .in("status", ["pending", "streaming"])
      .lt("started_at", chatCutoffIso)
      .order("started_at", { ascending: true })
      .limit(AI_CALL_CHAT_PAGE_LIMIT),
    supabaseAdmin
      .from("ai_calls")
      .select("id, type, status, started_at, user_id, conversation_id, repo_id")
      .neq("type", "chat")
      .in("status", ["pending", "streaming"])
      .lt("started_at", interactiveCutoffIso)
      .order("started_at", { ascending: true })
      .limit(AI_CALL_INTERACTIVE_PAGE_LIMIT),
  ]);

  if (chatResult.error) return { ok: false, error: chatResult.error.message };
  if (interactiveResult.error)
    return { ok: false, error: interactiveResult.error.message };

  return {
    ok: true,
    rows: [
      ...((chatResult.data ?? []) as AiCallZombieRow[]),
      ...((interactiveResult.data ?? []) as AiCallZombieRow[]),
    ],
  };
}

async function defaultReapStaleAiCalls(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "ai_calls",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  const candidatesResult = await selectAiCallZombies(now);
  if (!candidatesResult.ok) {
    summary.error = candidatesResult.error;
    return summary;
  }

  const candidates = candidatesResult.rows;
  summary.scanned = candidates.length;

  for (const row of candidates) {
    if (
      !isStaleLiveInteractiveCall(
        {
          type: row.type as never,
          status: row.status as never,
          started_at: row.started_at,
        },
        now
      )
    ) {
      continue;
    }

    const ageMs = safeAgeMs(row.started_at, now);
    const completedAt = new Date(now).toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("ai_calls")
      .update({
        status: "failed",
        error: ZOMBIE_REAPED_ERROR_MESSAGE,
        completed_at: completedAt,
      })
      .eq("id", row.id)
      .in("status", ["pending", "streaming"]);

    if (updateError) {
      console.error("[zombie-reaper] failed to mark ai_call as failed", {
        id: row.id,
        error: updateError.message,
      });
      continue;
    }

    // Best-effort terminal event so the observability pane shows the
    // reap explicitly rather than a silent status flip.
    const { error: eventError } = await supabaseAdmin
      .from("ai_call_events")
      .insert({
        ai_call_id: row.id,
        user_id: row.user_id,
        conversation_id: row.conversation_id,
        repo_id: row.repo_id,
        event_type: "failed",
        message: ZOMBIE_REAPED_ERROR_MESSAGE,
        payload: { age_ms: ageMs, source: "zombie-row-reaper" },
      });

    if (eventError) {
      console.error("[zombie-reaper] failed to append ai_call_events row", {
        id: row.id,
        error: eventError.message,
      });
    }

    summary.reaped += 1;
    summary.results.push({
      table: "ai_calls",
      id: row.id,
      ageMs,
      action: "marked_failed",
      detail: row.type,
    });
  }

  return summary;
}

type SnapshotZombieRow = {
  id: string;
  snapshot_build_token: string;
  snapshot_build_started_at: string | null;
};

async function defaultReapStaleSnapshotLocks(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "repos",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  const coarseCutoffIso = new Date(now - SNAPSHOT_BUILD_STALE_MS).toISOString();

  // OR fallback for null snapshot_build_started_at: the predicate treats
  // a missing timestamp as stale (an existing token without a start time
  // is malformed/legacy state that should be cleaned up), but a SQL
  // `started_at < cutoff` filter alone would silently exclude null rows
  // because NULL comparisons are always false in Postgres.
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id, snapshot_build_token, snapshot_build_started_at")
    .not("snapshot_build_token", "is", null)
    .or(
      `snapshot_build_started_at.lt.${coarseCutoffIso},snapshot_build_started_at.is.null`
    )
    .limit(100);

  if (error) {
    summary.error = error.message;
    return summary;
  }

  const candidates = (data ?? []) as SnapshotZombieRow[];
  summary.scanned = candidates.length;

  for (const row of candidates) {
    if (!isSnapshotBuildStale(row.snapshot_build_started_at, now)) continue;

    const ageMs = safeAgeMs(row.snapshot_build_started_at, now);

    // Conditional update: only release if the token still matches what
    // we observed. A concurrent persistSnapshotBuild or
    // releaseSnapshotBuildLock would cause the eq() filter to miss,
    // and we silently skip — exactly the right behaviour.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("repos")
      .update({
        snapshot_build_token: null,
        snapshot_build_started_at: null,
      })
      .eq("id", row.id)
      .eq("snapshot_build_token", row.snapshot_build_token)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error(
        "[zombie-reaper] failed to release stale snapshot build lock",
        {
          repoId: row.id,
          error: updateError.message,
        }
      );
      continue;
    }

    if (!updated) continue; // Lock was already released between scan and write.

    summary.reaped += 1;
    summary.results.push({
      table: "repos",
      id: row.id,
      ageMs,
      action: "released_lock",
      detail: "snapshot_build_token",
    });
  }

  return summary;
}

type JobRunZombieRow = {
  id: string;
  status: string | null;
  started_at: string | null;
  created_at: string | null;
};

async function defaultReapStaleJobRuns(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "job_runs",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  const coarseCutoffIso = new Date(
    now - STALE_RUNNING_JOB_THRESHOLD_MS
  ).toISOString();

  // OR fallback for null started_at: isStaleRunningJob falls back to
  // created_at when the row never recorded its start. A SQL filter that
  // only looked at started_at would silently exclude those rows because
  // NULL < timestamp is always false in Postgres.
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("id, status, started_at, created_at")
    .eq("status", "running")
    .or(
      `started_at.lt.${coarseCutoffIso},and(started_at.is.null,created_at.lt.${coarseCutoffIso})`
    )
    .order("started_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    summary.error = error.message;
    return summary;
  }

  const candidates = (data ?? []) as JobRunZombieRow[];
  summary.scanned = candidates.length;

  for (const row of candidates) {
    if (!isStaleRunningJob(row, now)) continue;

    const ageMs = safeAgeMs(row.started_at || row.created_at, now);

    try {
      const result = await cancelAutomationJobRun(
        row.id,
        ZOMBIE_REAPED_CANCEL_REASON
      );

      if (!result.ok) {
        console.warn("[zombie-reaper] cancelAutomationJobRun rejected", {
          jobRunId: row.id,
          status: "status" in result ? result.status : null,
          notFound: result.notFound,
        });
        continue;
      }

      summary.reaped += 1;
      summary.results.push({
        table: "job_runs",
        id: row.id,
        ageMs,
        action: "cancelled",
        detail: ZOMBIE_REAPED_CANCEL_REASON,
      });
    } catch (cancelError) {
      // cancelAutomationJobRun can throw mid-cascade, leaving the
      // job_run in cancel_requested state with a cancel_error. The
      // existing reconcileAutomationJobRuns reconciler will
      // self-heal those rows on its next pass, but ops still need a
      // signal that this happened — log to console.error AND surface
      // a Sentry warning so the partial state isn't silently lost.
      const message =
        cancelError instanceof Error
          ? cancelError.message
          : String(cancelError);
      console.error("[zombie-reaper] failed to cancel stale job_run", {
        jobRunId: row.id,
        error: message,
        ageMs,
      });
      try {
        Sentry.captureMessage(
          "[zombie-reaper] cancelAutomationJobRun threw mid-cascade",
          {
            level: "warning",
            tags: { table: "job_runs" },
            extra: { jobRunId: row.id, error: message, ageMs },
          }
        );
      } catch (captureError) {
        console.error(
          "[zombie-reaper] sentry capture for cancel failure failed",
          captureError
        );
      }
    }
  }

  return summary;
}

type ExecLockZombieRow = {
  id: string;
  status: string | null;
  exec_lock_token: string;
  exec_lock_started_at: string | null;
};

export const ACTIVE_SANDBOX_STATUSES_FOR_LOCK = [
  "creating",
  "installing",
  "running",
] as const;

/**
 * Inactive statuses enumerated explicitly. Used in the SQL filter
 * for the inactive-status scan because PostgREST's
 * `.not('status', 'in', ...)` is version-fragile around the tuple
 * quoting; an `.or()` of `eq` literals is unambiguous and matches
 * how the snapshot/job_run reapers express their conditions.
 *
 * Stays in sync with `SandboxLifecycleStatus` via the type assertion
 * below — adding a new status to the type without classifying it
 * here will fail the compile.
 */
const INACTIVE_SANDBOX_STATUSES_FOR_LOCK = [
  "stopped",
  "paused",
  "error",
] as const satisfies readonly Exclude<
  import("@/lib/types").SandboxLifecycleStatus,
  (typeof ACTIVE_SANDBOX_STATUSES_FOR_LOCK)[number]
>[];

type ExecLockZombieClassification = {
  isAged: boolean;
  isInactiveStatus: boolean;
  ageMs: number | null;
};

/**
 * Pure predicate exposed for unit testing. Returns whether the row
 * matches either zombie shape (stale age / inactive status), plus
 * the computed ageMs the reaper records on the result.
 *
 * A null `exec_lock_started_at` reads as `isAged: true` because we
 * can't compute the row's age — the lock was set without a timestamp,
 * which is unambiguously stale (matches the same convention used by
 * `isSnapshotBuildStale`). Without this branch, a malformed-legacy
 * row on an active sandbox status would be fetched by the SQL OR
 * clause that explicitly includes `is.null` but then skipped by the
 * defensive guard in the reaper, never getting cleaned up.
 */
export function classifyExecLockZombie(
  row: Pick<ExecLockZombieRow, "status" | "exec_lock_started_at">,
  now: number,
  lockStaleMs: number
): ExecLockZombieClassification {
  const ageMs = safeAgeMs(row.exec_lock_started_at, now);
  const isAged = ageMs === null || ageMs >= lockStaleMs;
  const isInactiveStatus =
    !row.status ||
    !ACTIVE_SANDBOX_STATUSES_FOR_LOCK.includes(
      row.status as (typeof ACTIVE_SANDBOX_STATUSES_FOR_LOCK)[number]
    );
  return { isAged, isInactiveStatus, ageMs };
}

async function defaultReapStaleExecLocks(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "sandboxes",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  // Two zombie shapes both clear via the same UPDATE:
  //   (a) lock held past the per-route stale window — the route that
  //       acquired the lock died (deploy, network, runtime crash)
  //       without the release path running.
  //   (b) lock still set on a sandbox whose status is no longer
  //       active. The route's release should have fired when the
  //       sandbox stopped/paused/errored, but the order isn't
  //       atomic in practice — leftovers accumulate.
  const lockStaleMs = REQUEST_LIMITS.sandboxExec.lockStaleSeconds * 1000;
  const staleCutoffIso = new Date(now - lockStaleMs).toISOString();

  // PostgREST's .or() doesn't support `not.in.(...)` inside the OR
  // string, so issue two scoped queries and dedup by id rather than
  // try to express the union as a single .or() filter. The
  // alternative — a single huge .or() — would either 400 or silently
  // drop the inactive-status branch depending on the PostgREST
  // version.
  // Each scan is capped at 100 rows independently so a single reap
  // cycle processes at most 200 distinct rows after dedup. Mirrors
  // the per-table cap on the snapshot/job_run reapers; matches the
  // 5-min cron cadence so a backlog drains within a predictable
  // number of cycles. Bump only if real-world reap volume sustainedly
  // hits these caps (current production: 0–1 per audit).
  const [agedScan, inactiveScan] = await Promise.all([
    supabaseAdmin
      .from("sandboxes")
      .select("id, status, exec_lock_token, exec_lock_started_at")
      .not("exec_lock_token", "is", null)
      .or(
        `exec_lock_started_at.lt.${staleCutoffIso},exec_lock_started_at.is.null`
      )
      .limit(100),
    // Enumerate the inactive statuses explicitly. PostgREST's
    // `.not('status', 'in', '(creating,installing,running)')` is
    // version-fragile around tuple quoting and would silently 400
    // (or worse, drop the branch) on some library/PostgREST
    // versions. `.or()` of `eq` literals is unambiguous and matches
    // the other reapers' filter idioms.
    supabaseAdmin
      .from("sandboxes")
      .select("id, status, exec_lock_token, exec_lock_started_at")
      .not("exec_lock_token", "is", null)
      .or(
        [
          ...INACTIVE_SANDBOX_STATUSES_FOR_LOCK.map((s) => `status.eq.${s}`),
          "status.is.null",
        ].join(",")
      )
      .limit(100),
  ]);

  // Aggregate both scan errors so an operator sees the full picture
  // when both PostgREST queries fail (likely correlated under a real
  // outage, but possible to differ — e.g. one OR clause schema-rejected
  // while the other times out).
  if (agedScan.error || inactiveScan.error) {
    summary.error = [
      agedScan.error ? `aged scan: ${agedScan.error.message}` : null,
      inactiveScan.error
        ? `inactive scan: ${inactiveScan.error.message}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    return summary;
  }

  // Dedup by id — a row can match both queries (e.g. stopped AND past
  // the stale window). The conditional UPDATE later is idempotent, so
  // the duplicate would be a no-op, but counting it twice in
  // summary.scanned is misleading.
  const seen = new Map<string, ExecLockZombieRow>();
  for (const row of (agedScan.data ?? []) as ExecLockZombieRow[]) {
    seen.set(row.id, row);
  }
  for (const row of (inactiveScan.data ?? []) as ExecLockZombieRow[]) {
    seen.set(row.id, row);
  }

  const candidates = Array.from(seen.values());
  summary.scanned = candidates.length;

  for (const row of candidates) {
    const { isAged, isInactiveStatus, ageMs } = classifyExecLockZombie(
      row,
      now,
      lockStaleMs
    );

    // Defensive double-check: the SQL queries already filtered, but a
    // row that arrives here without either condition set means the
    // server raced with another writer between scan and reap. Skip
    // rather than clobber a freshly-acquired lock.
    if (!isAged && !isInactiveStatus) continue;

    // Conditional release: only clear if the same token is still
    // held. A concurrent acquireSandboxExecLock() that wrote a new
    // token between our scan and write would cause this UPDATE to
    // affect zero rows, which is the correct race outcome.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("sandboxes")
      .update({
        exec_lock_token: null,
        exec_lock_started_at: null,
      })
      .eq("id", row.id)
      .eq("exec_lock_token", row.exec_lock_token)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[zombie-reaper] failed to release stale exec lock", {
        sandboxId: row.id,
        error: updateError.message,
      });
      continue;
    }

    if (!updated) continue; // Lost the race; another writer cleared it.

    summary.reaped += 1;
    summary.results.push({
      table: "sandboxes",
      id: row.id,
      ageMs,
      action: "released_lock",
      // Combine both reasons when both apply so an operator querying
      // Sentry for `exec_lock_stale` events doesn't miss the subset
      // that happens to also be on an inactive sandbox. "(missing)"
      // instead of "null" for null-status rows — the literal "null"
      // reads as a serialization artifact in dashboards rather than
      // a deliberate sentinel.
      detail: [
        isAged ? "exec_lock_stale" : null,
        isInactiveStatus
          ? `inactive_status:${row.status ?? "(missing)"}`
          : null,
      ]
        .filter(Boolean)
        .join("+"),
    });
  }

  return summary;
}

/**
 * Connection-test stale window. The test route runs a one-shot MCP
 * health check that should complete in seconds; 15 minutes is the
 * same conservative threshold used by the snapshot-build reaper and
 * leaves zero false-positive risk for legitimate slow OAuth flows.
 *
 * Exported for the unit test that pins the threshold so a future
 * tweak can't silently shrink the window past a real-world test
 * duration.
 */
export const CONNECTION_TEST_STALE_MS = 15 * 60 * 1000;

const CONNECTION_TEST_REAPED_ERROR_MESSAGE =
  "Test interrupted before persistence (reaped by zombie-row-reaper)";

type ConnectionTestZombieRow = {
  id: string;
  user_id: string;
  active_test_token: string;
  updated_at: string | null;
};

type ConnectionTestZombieClassification = {
  isStale: boolean;
  ageMs: number | null;
};

/**
 * Pure predicate exposed for unit testing. Matches the convention
 * `classifyExecLockZombie` established: a missing `updated_at` reads
 * as stale (the row is in an unrecoverable state we can't compute
 * an age for, but which is unambiguously a zombie because the test
 * write path always stamps `updated_at`).
 */
export function classifyConnectionTestZombie(
  row: Pick<ConnectionTestZombieRow, "updated_at">,
  now: number,
  staleMs: number
): ConnectionTestZombieClassification {
  const ageMs = safeAgeMs(row.updated_at, now);
  const isStale = ageMs === null || ageMs >= staleMs;
  return { isStale, ageMs };
}

async function defaultReapStaleConnectionTests(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "connections",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  const staleCutoffIso = new Date(now - CONNECTION_TEST_STALE_MS).toISOString();

  // OR fallback for null updated_at: treats a missing timestamp as
  // stale (matches classifyConnectionTestZombie). Without the .or()
  // a SQL `updated_at < cutoff` filter alone would silently exclude
  // null rows because NULL comparisons are always false in Postgres.
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select("id, user_id, active_test_token, updated_at")
    .eq("health_status", "testing")
    .not("active_test_token", "is", null)
    .or(`updated_at.lt.${staleCutoffIso},updated_at.is.null`)
    .limit(100);

  if (error) {
    summary.error = error.message;
    return summary;
  }

  const candidates = (data ?? []) as ConnectionTestZombieRow[];
  summary.scanned = candidates.length;

  for (const row of candidates) {
    const { isStale, ageMs } = classifyConnectionTestZombie(
      row,
      now,
      CONNECTION_TEST_STALE_MS
    );
    if (!isStale) continue;

    // Conditional update: only reset if the same token is still set
    // AND the status is still 'testing'. A concurrent
    // respondWithPersistedResult that completed between scan and
    // write would cause this update to affect zero rows — exactly
    // the right race outcome (we lose to the legitimate write).
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("connections")
      .update({
        health_status: "unknown",
        active_test_token: null,
        last_test_error: CONNECTION_TEST_REAPED_ERROR_MESSAGE,
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", row.id)
      .eq("active_test_token", row.active_test_token)
      .eq("health_status", "testing")
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[zombie-reaper] failed to clear stale connection test", {
        connectionId: row.id,
        error: updateError.message,
      });
      continue;
    }

    if (!updated) continue; // Lost the race; the test completed normally.

    // Best-effort terminal event: a reap is considered "done" once
    // the connections row update succeeds, NOT when this event row
    // persists. Mirrors the ai_calls reaper's safeAppendAiCallEvent
    // contract — observability surfaces should show the reap
    // explicitly, but a failed event insert must not roll back the
    // user-visible side effect (health_status reset, lock cleared)
    // or block the reaper's progress through the rest of the batch.
    //
    // Routes through the shared logger instead of writing to
    // connection_events directly so the row shape is enforced at
    // the type level (ConnectionEventInsert), future schema
    // changes are picked up centrally, and the reaper's emit lives
    // on the same audit trail as the test route's user-facing
    // failures (event_type='test_failed', distinguished by
    // surface='reaper').
    logConnectionEvent("connection_test_failed", {
      userId: row.user_id,
      connectionId: row.id,
      surface: "reaper",
      reason: CONNECTION_TEST_REAPED_ERROR_MESSAGE,
      payloadExtras: { age_ms: ageMs, source: "zombie-row-reaper" },
    });

    summary.reaped += 1;
    summary.results.push({
      table: "connections",
      id: row.id,
      ageMs,
      action: "released_lock",
      detail: "test_token_stale",
    });
  }

  return summary;
}

function defaultCaptureWarning(
  message: string,
  extra: Record<string, unknown>
) {
  // Surface non-error warnings to Sentry only when something was
  // actually reaped — quiet cycles must not spam the dashboard.
  Sentry.captureMessage(message, {
    level: "warning",
    extra,
  });
}

const defaultZombieReaperDeps: ZombieReaperRunnerDeps = {
  reapStaleAiCalls: defaultReapStaleAiCalls,
  reapStaleSnapshotLocks: defaultReapStaleSnapshotLocks,
  reapStaleJobRuns: defaultReapStaleJobRuns,
  reapStaleExecLocks: defaultReapStaleExecLocks,
  reapStaleConnectionTests: defaultReapStaleConnectionTests,
  captureWarning: defaultCaptureWarning,
};

export function createZombieReaperRunner(
  overrides: Partial<ZombieReaperRunnerDeps> = {}
) {
  const deps: ZombieReaperRunnerDeps = {
    ...defaultZombieReaperDeps,
    ...overrides,
  };

  // Pair each reaper with its fallback table label in one place so
  // the index-based mapping below can't drift if a future reaper is
  // inserted or reordered. Without this, a misplaced new reaper
  // would silently mislabel a rejection's table summary.
  const reapers: Array<{
    table: ZombieReaperResult["table"];
    run: () => Promise<ZombieReaperTableSummary>;
  }> = [
    { table: "ai_calls", run: deps.reapStaleAiCalls },
    { table: "repos", run: deps.reapStaleSnapshotLocks },
    { table: "job_runs", run: deps.reapStaleJobRuns },
    { table: "sandboxes", run: deps.reapStaleExecLocks },
    { table: "connections", run: deps.reapStaleConnectionTests },
  ];

  return async function runZombieReaper(): Promise<ZombieReaperSummary> {
    const settled = await Promise.allSettled(reapers.map((r) => r.run()));

    const tables: ZombieReaperTableSummary[] = settled.map((outcome, index) => {
      if (outcome.status === "fulfilled") return outcome.value;
      return {
        table: reapers[index]?.table ?? "ai_calls",
        scanned: 0,
        reaped: 0,
        results: [],
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      };
    });

    const processed = tables.reduce((sum, t) => sum + t.scanned, 0);
    const reaped = tables.reduce((sum, t) => sum + t.reaped, 0);
    const errors = tables
      .filter((t) => t.error)
      .map((t) => `${t.table}: ${t.error}`);
    const breakdown = tables
      .map((t) => `${t.table}=${t.reaped}/${t.scanned}`)
      .join(" ");
    const message =
      errors.length > 0
        ? `[zombie-reaper] reaped ${reaped} (${breakdown}); errors: ${errors.join("; ")}`
        : `[zombie-reaper] reaped ${reaped} (${breakdown})`;

    if (reaped > 0) {
      try {
        deps.captureWarning("[zombie-reaper] reaped stale rows", {
          reaped,
          processed,
          tables: tables.map((t) => ({
            table: t.table,
            scanned: t.scanned,
            reaped: t.reaped,
            error: t.error,
            sample_ids: t.results.slice(0, 5).map((r) => r.id),
          })),
        });
      } catch (captureError) {
        console.error("[zombie-reaper] sentry capture failed", captureError);
      }
    }

    return { processed, reaped, message, tables };
  };
}

export const runZombieReaper = createZombieReaperRunner();

const HTTP_RESPONSE_SAMPLE_LIMIT = 5;

/**
 * HTTP shape of the reaper summary. The route is gated by
 * requireMachineApiAuth, but any infrastructure that logs response
 * bodies (proxies, Vercel response logs, error trackers) would
 * otherwise pick up the full list of internal row primary keys.
 * Truncate to a small sample so ops debugging stays useful without
 * leaking unbounded id lists into log surfaces.
 */
export function buildZombieReaperResponse(summary: ZombieReaperSummary) {
  return {
    processed: summary.processed,
    reaped: summary.reaped,
    message: summary.message,
    tables: summary.tables.map((t) => ({
      table: t.table,
      scanned: t.scanned,
      reaped: t.reaped,
      error: t.error,
      sample_ids: t.results
        .slice(0, HTTP_RESPONSE_SAMPLE_LIMIT)
        .map((r) => r.id),
    })),
  };
}
