import { supabaseAdmin } from "@/lib/supabase/admin";

type PruneRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export type PruneUnconnectedReposDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<PruneRpcResult>;
  logger: Pick<typeof console, "error" | "info">;
};

const defaultDeps: PruneUnconnectedReposDeps = {
  rpc: async (fn, args) => {
    const { data, error } = await supabaseAdmin.rpc(fn, args);
    return { data, error };
  },
  logger: console,
};

/**
 * Delete the user's personal repository rows that came from the legacy OAuth
 * sync (no App installation) and that nothing references;
 * `prune_unconnected_repos` holds the reference guard. Call it only after a
 * GitHub App sync, never on OAuth-only deployments. It does nothing unless
 * that sync returned at least one repository, so a failed or empty App sync
 * never deletes anything. Fails open: the sync result never depends on it.
 *
 * @param authorizedRepoCount repositories the App sync returned
 * @returns the number of rows deleted (0 when skipped or on error)
 */
export async function pruneUnconnectedRepos(
  userId: string,
  authorizedRepoCount: number,
  deps: PruneUnconnectedReposDeps = defaultDeps
): Promise<number> {
  if (authorizedRepoCount === 0) return 0;

  try {
    const { data, error } = await deps.rpc("prune_unconnected_repos", {
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    const deleted = typeof data === "number" ? data : 0;
    if (deleted > 0) {
      deps.logger.info("Pruned unconnected repositories", { userId, deleted });
    }
    return deleted;
  } catch (error) {
    deps.logger.error("Failed to prune unconnected repositories", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
