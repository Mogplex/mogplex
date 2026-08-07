import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  SNAPSHOT_BUILD_STALE_MS,
  isSnapshotBuildStale,
} from "@/lib/repo-snapshots";
import type { ZombieReaperTableSummary } from "./zombie-reaper-types";
import { safeAgeMs } from "./zombie-reaper-types";

type SnapshotZombieRow = {
  id: string;
  snapshot_build_token: string;
  snapshot_build_started_at: string | null;
};

export async function reapStaleSnapshotLocks(): Promise<ZombieReaperTableSummary> {
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
