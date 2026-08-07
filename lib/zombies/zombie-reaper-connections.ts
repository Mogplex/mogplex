import { supabaseAdmin } from "@/lib/supabase/admin";
import { logConnectionEvent } from "@/lib/connections/logging";
import type { ZombieReaperTableSummary } from "./zombie-reaper-types";
import { safeAgeMs } from "./zombie-reaper-types";

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

export async function reapStaleConnectionTests(): Promise<ZombieReaperTableSummary> {
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
