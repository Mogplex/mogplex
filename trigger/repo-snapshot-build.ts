import { metadata, task } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { executeRepoSnapshotBuild } from "@/lib/workflows/repo-snapshot-workflow";
import type { RepoSnapshotBuildInput } from "@/lib/workflows/repo-snapshot-workflow";

export const buildRepoSnapshotTask = task({
  id: TRIGGER_TASK_IDS.repoSnapshotBuild,
  maxDuration: 60 * 15,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: RepoSnapshotBuildInput) => {
    metadata.set("repoId", payload.repoId);
    metadata.set("preAcquiredLockToken", payload.preAcquiredLockToken ?? null);

    return executeRepoSnapshotBuild(payload);
  },
});
