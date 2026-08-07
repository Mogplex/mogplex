import { supabaseAdmin } from "@/lib/supabase/admin";
import { REQUEST_LIMITS } from "@/lib/request-limits";
import type { ZombieReaperTableSummary } from "./zombie-reaper-types";
import { safeAgeMs } from "./zombie-reaper-types";

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

export async function reapStaleExecLocks(): Promise<ZombieReaperTableSummary> {
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
