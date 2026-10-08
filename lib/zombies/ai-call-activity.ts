import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The newest event time recorded by each call, read as one indexed row per
 * call. A call whose events can't be read maps to `undefined`, so callers can
 * leave it alone rather than judge it on its age.
 */
export async function loadLatestCallActivity(
  client: Pick<SupabaseClient, "from">,
  callIds: readonly string[]
): Promise<Map<string, string | null | undefined>> {
  const entries = await Promise.all(
    callIds.map(async (id) => {
      const { data, error } = await client
        .from("ai_call_events")
        .select("created_at")
        .eq("ai_call_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return [id, undefined] as const;
      const createdAt = (data as { created_at?: unknown } | null)?.created_at;
      const iso =
        createdAt instanceof Date
          ? createdAt.toISOString()
          : typeof createdAt === "string"
            ? createdAt
            : null;
      return [id, iso] as const;
    })
  );
  return new Map(entries);
}
