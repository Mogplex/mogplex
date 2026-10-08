import type { SupabaseClient } from "@supabase/supabase-js";
import { forEachConcurrently } from "./zombie-reaper-stops";

// Each read is one indexed row, but a cycle can have hundreds of candidates.
const ACTIVITY_READ_CONCURRENCY = 10;

/**
 * The newest event time recorded by each call, read as one indexed row per
 * call. A call whose events can't be read maps to `undefined`, so callers can
 * leave it alone rather than judge it on its age.
 */
export async function loadLatestCallActivity(
  client: Pick<SupabaseClient, "from">,
  callIds: readonly string[]
): Promise<Map<string, string | null | undefined>> {
  const activity = new Map<string, string | null | undefined>();
  await forEachConcurrently(callIds, ACTIVITY_READ_CONCURRENCY, async (id) => {
    const { data, error } = await client
      .from("ai_call_events")
      .select("created_at")
      .eq("ai_call_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      activity.set(id, undefined);
      return;
    }
    const createdAt = (data as { created_at?: unknown } | null)?.created_at;
    activity.set(
      id,
      createdAt instanceof Date
        ? createdAt.toISOString()
        : typeof createdAt === "string"
          ? createdAt
          : null
    );
  });
  return activity;
}
