import { tasks } from "@trigger.dev/sdk/v3";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import {
  buildRepoSnapshot,
  loadRepoSnapshotBuildRepo,
} from "@/lib/repo-snapshot-build";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import {
  acquireSnapshotBuildLock,
  releaseSnapshotBuildLock,
} from "@/lib/repo-snapshots";
import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export type RepoSnapshotBuildInput = {
  repoId: string;
  preAcquiredLockToken?: string | null;
};

type DeferredRepoSnapshotStarterDeps = {
  loadRepoSnapshotBuildRepo: typeof loadRepoSnapshotBuildRepo;
  acquireSnapshotBuildLock: typeof acquireSnapshotBuildLock;
  releaseSnapshotBuildLock: typeof releaseSnapshotBuildLock;
  isTriggerRuntimeConfigured: typeof isTriggerRuntimeConfigured;
  startTriggerRun: (
    id: string,
    payload: RepoSnapshotBuildInput,
    options?: Record<string, unknown>
  ) => Promise<{ id?: string | null }>;
};

const defaultDeferredRepoSnapshotStarterDeps: DeferredRepoSnapshotStarterDeps =
  {
    loadRepoSnapshotBuildRepo,
    acquireSnapshotBuildLock,
    releaseSnapshotBuildLock,
    isTriggerRuntimeConfigured,
    startTriggerRun: tasks.trigger,
  };

export async function executeRepoSnapshotBuild(input: RepoSnapshotBuildInput) {
  const platformCreds = getPlatformSandboxCredentials();

  const repo = await loadRepoSnapshotBuildRepo(input.repoId);
  if (!repo) {
    return { success: false, reason: "repo_not_found" };
  }

  const [userCreds, platformAccess] = await Promise.all([
    loadUserVercelCredentials(repo.user_id),
    loadUserPlatformAccess(repo.user_id, repo.product_team_id),
  ]);
  if (!platformCreds.vercelToken && !userCreds.userVercelToken) {
    return { success: false, reason: "sandbox_service_not_configured" };
  }

  const result = await buildRepoSnapshot({
    repo,
    sandboxCredentials: {
      userId: repo.user_id,
      productTeamId: repo.product_team_id,
      ...platformCreds,
      allowPlatformSandbox: platformAccess.allowPlatformSandbox,
      ...userCreds,
    },
    preAcquiredLockToken: input.preAcquiredLockToken ?? null,
  });

  return {
    success: result.status === "built",
    result,
  };
}

export async function repoSnapshotTask(input: RepoSnapshotBuildInput) {
  return executeRepoSnapshotBuild(input);
}

export function createDeferredRepoSnapshotBuildStarter(
  overrides: Partial<DeferredRepoSnapshotStarterDeps> = {}
) {
  const deps: DeferredRepoSnapshotStarterDeps = {
    ...defaultDeferredRepoSnapshotStarterDeps,
    ...overrides,
  };

  return async function startDeferredRepoSnapshotBuild(input: {
    repoId: string;
  }) {
    const repo = await deps.loadRepoSnapshotBuildRepo(input.repoId);
    if (!repo || repo.snapshot_id) {
      return {
        queued: false as const,
        reason: repo ? "snapshot_exists" : "repo_not_found",
        runtimeProvider: null,
        runtimeRunId: null,
        workflowRunId: null,
      };
    }

    const lock = await deps.acquireSnapshotBuildLock(input.repoId);
    if (!lock.acquired) {
      return {
        queued: false as const,
        reason: lock.reason,
        runtimeProvider: null,
        runtimeRunId: null,
        workflowRunId: null,
      };
    }

    try {
      const payload = {
        repoId: input.repoId,
        preAcquiredLockToken: lock.token,
      };
      if (!deps.isTriggerRuntimeConfigured()) {
        throw new Error("Trigger.dev runtime is not configured");
      }

      const handle = await deps.startTriggerRun(
        TRIGGER_TASK_IDS.repoSnapshotBuild,
        payload,
        {
          idempotencyKey: `repo-snapshot:${input.repoId}:${lock.token}`,
          concurrencyKey: `repo:${input.repoId}`,
          maxAttempts: 1,
          tags: [`repo:${input.repoId}`, "repo-snapshot"],
          metadata: {
            repoId: input.repoId,
            preAcquiredLockToken: lock.token,
          },
        }
      );

      return {
        queued: true as const,
        reason: null,
        runtimeProvider: "trigger" as const,
        runtimeRunId: handle.id ?? null,
        workflowRunId: null,
      };
    } catch (error) {
      await deps.releaseSnapshotBuildLock(input.repoId, lock.token);
      throw error;
    }
  };
}

export const startDeferredRepoSnapshotBuild =
  createDeferredRepoSnapshotBuildStarter();
