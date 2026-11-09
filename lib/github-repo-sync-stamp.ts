import { supabaseAdmin } from "@/lib/supabase/admin";

type RecordRepoSyncDeps = {
  markSynced: (
    userId: string,
    installationId: number,
    syncedAt: string
  ) => Promise<{ error: { message: string } | null }>;
  now: () => Date;
};

const defaultRecordRepoSyncDeps: RecordRepoSyncDeps = {
  markSynced: async (userId, installationId, syncedAt) =>
    supabaseAdmin
      .from("github_installations")
      .update({ repos_synced_at: syncedAt })
      .eq("user_id", userId)
      .eq("installation_id", installationId),
  now: () => new Date(),
};

/**
 * Stamp when this installation's full repository list was last synced, for
 * Settings → Repositories. It means "when Mogplex last fetched this
 * installation's repositories from GitHub", whichever workspace (personal or
 * team) asked. Best effort: a failed stamp never fails the sync.
 */
export async function recordInstallationRepoSync(
  userId: string,
  installationId: number,
  deps: RecordRepoSyncDeps = defaultRecordRepoSyncDeps
) {
  try {
    const { error } = await deps.markSynced(
      userId,
      installationId,
      deps.now().toISOString()
    );
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn("[github-sync] could not record repository sync time", {
      userId,
      installationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
