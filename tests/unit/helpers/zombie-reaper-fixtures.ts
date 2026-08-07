/**
 * Shared fixtures and helpers for zombie-reaper tests.
 */

export async function loadZombieReaper() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/zombies/zombie-reaper");
}

export type ReaperTable =
  | "ai_calls"
  | "repos"
  | "job_runs"
  | "sandboxes"
  | "connections";

export function emptyReaperResult(table: ReaperTable) {
  return async () => ({
    table,
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  });
}
