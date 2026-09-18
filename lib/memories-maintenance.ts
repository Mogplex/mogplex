import type {
  MemoriesClient,
  MemoryLane,
  MemoryScope,
} from "@/lib/memories-client";
import { applyScopeFilters, getMemoryScopeForLane } from "@/lib/memories-scope";

export const MEMORY_LANES: MemoryLane[] = [
  "session",
  "semantic",
  "episodic",
  "procedural",
];

export type MemoryLaneCounts = Record<MemoryLane, number>;

/**
 * Exact per-lane row counts for the user, honoring the same scope filters as
 * `listByLane`. Pass the full request scope: each lane is narrowed with
 * `getMemoryScopeForLane`, so the session count keeps the workspace-session
 * and conversation filters that the durable lanes drop. The list endpoint
 * caps each lane at 50 rows, so the UI needs this to show real totals instead
 * of the page size.
 */
export async function countByLane(
  client: MemoriesClient,
  scope?: MemoryScope
): Promise<MemoryLaneCounts> {
  const counts = await Promise.all(
    MEMORY_LANES.map(async (lane) => {
      const query = applyScopeFilters(
        client.supabase
          .from("memories")
          .select("id", { count: "exact", head: true })
          .eq("user_id", client.userId)
          .eq("lane", lane),
        getMemoryScopeForLane(lane, scope)
      );
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return [lane, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts) as MemoryLaneCounts;
}

export type PruneNoiseResult = {
  harnessPrompts: number;
  automationOutcomes: number;
};

/**
 * Delete machine-generated rows that were never curated memories: full task
 * prompts the harness used to persist to the session lane, and per-run
 * automation outcome rows. Both writers are gone; this clears their backlog.
 * Rows are matched by the metadata the writers stamped, so hand-written and
 * agent-written memories are never touched.
 */
export async function pruneNoise(
  client: MemoriesClient
): Promise<PruneNoiseResult> {
  const harnessPrompts = await client.supabase
    .from("memories")
    .delete({ count: "exact" })
    .eq("user_id", client.userId)
    .eq("lane", "session")
    .eq("metadata->>source", "harness")
    .eq("metadata->>kind", "prompt");
  if (harnessPrompts.error) throw new Error(harnessPrompts.error.message);

  const automationOutcomes = await client.supabase
    .from("memories")
    .delete({ count: "exact" })
    .eq("user_id", client.userId)
    .eq("lane", "episodic")
    .eq("metadata->>source", "automation");
  if (automationOutcomes.error) {
    throw new Error(automationOutcomes.error.message);
  }

  return {
    harnessPrompts: harnessPrompts.count ?? 0,
    automationOutcomes: automationOutcomes.count ?? 0,
  };
}
