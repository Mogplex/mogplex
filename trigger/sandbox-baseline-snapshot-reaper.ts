import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadBaselineReaperCandidates,
  readBaselineReaperConfigFromEnv,
  runBaselineSnapshotReaper,
  type BaselineReaperCandidate,
} from "@/lib/sandbox/baseline-snapshot-reaper";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { getPlatformSandboxCredentials } from "@/lib/sandbox/get-user-credentials";
import { Snapshot } from "@vercel/sandbox";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

async function resolveSnapshotCredentials(repo: BaselineReaperCandidate) {
  const platform = getPlatformSandboxCredentials();
  if (!platform.vercelToken) return null;
  return {
    token: platform.vercelToken,
    teamId: repo.snapshot_billing_team_id ?? platform.vercelTeamId ?? null,
  };
}

export async function runScheduledBaselineSnapshotReaper() {
  const config = readBaselineReaperConfigFromEnv();
  const summary = await runBaselineSnapshotReaper(config, {
    loadCandidates: loadBaselineReaperCandidates,
    clearRepoSnapshot: async (repoId: string) => {
      const { data } = await supabaseAdmin
        .from("repos")
        .select("snapshot_id")
        .eq("id", repoId)
        .maybeSingle();
      if (data?.snapshot_id) {
        await clearRepoSnapshotIfCurrent(repoId, data.snapshot_id);
      }
    },
    deleteSnapshot: async ({ snapshotId, token, teamId }) => {
      try {
        const snapshot = await Snapshot.get({
          snapshotId,
          token,
          ...(teamId ? { teamId } : {}),
        });
        await snapshot.delete();
      } catch {
        // Already gone.
      }
    },
    resolveSnapshotCredentials,
    now: () => new Date(),
  });

  metadata.set("processed", summary.processed);
  metadata.set("reaped", summary.reaped);
  logger.log(summary.message, summary);
  return summary;
}

export const baselineSnapshotReaperTask = schedules.task({
  id: TRIGGER_TASK_IDS.sandboxBaselineSnapshotReaper,
  cron: "0 5 * * *",
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledBaselineSnapshotReaper(),
});
