import assert from "node:assert/strict";
import test from "node:test";

async function loadRepoSnapshotWorkflowModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/workflows/repo-snapshot-workflow");
}

test("startDeferredRepoSnapshotBuild skips repos that already have a snapshot", async () => {
  const { createDeferredRepoSnapshotBuildStarter } =
    await loadRepoSnapshotWorkflowModule();
  let lockAttempts = 0;
  let triggerStarts = 0;

  const startDeferredRepoSnapshotBuild = createDeferredRepoSnapshotBuildStarter(
    {
      loadRepoSnapshotBuildRepo: async () => ({
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/repo",
        default_branch: "main",
        root_directory: null,
        sandbox_billing_target: "personal",
        runtime: "node22",
        dev_port: 3000,
        install_command: null,
        dev_command: null,
        sandbox_env_vars: null,
        env_sync_mode: null,
        vercel_project_id: null,
        vercel_team_id: null,
        github_installation_id: null,
        snapshot_id: "snapshot-123",
        snapshot_created_at: "2026-03-23T16:00:00.000Z",
      }),
      acquireSnapshotBuildLock: async () => {
        lockAttempts += 1;
        return { acquired: true as const, token: "lock-token" };
      },
      startTriggerRun: async () => {
        triggerStarts += 1;
        return { id: "trigger-run-123" } as never;
      },
    }
  );

  const result = await startDeferredRepoSnapshotBuild({ repoId: "repo-123" });

  assert.deepEqual(result, {
    queued: false,
    reason: "snapshot_exists",
    runtimeProvider: null,
    runtimeRunId: null,
    workflowRunId: null,
  });
  assert.equal(lockAttempts, 0);
  assert.equal(triggerStarts, 0);
});

test("startDeferredRepoSnapshotBuild acquires the lock and starts the Trigger.dev run", async () => {
  const { createDeferredRepoSnapshotBuildStarter } =
    await loadRepoSnapshotWorkflowModule();
  let receivedId: string | null = null;
  let receivedPayload: unknown = null;
  let receivedOptions: Record<string, unknown> | null = null;

  const startDeferredRepoSnapshotBuild = createDeferredRepoSnapshotBuildStarter(
    {
      isTriggerRuntimeConfigured: () => true,
      loadRepoSnapshotBuildRepo: async () => ({
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/repo",
        default_branch: "main",
        root_directory: null,
        sandbox_billing_target: "personal",
        runtime: "node22",
        dev_port: 3000,
        install_command: null,
        dev_command: null,
        sandbox_env_vars: null,
        env_sync_mode: null,
        vercel_project_id: null,
        vercel_team_id: null,
        github_installation_id: null,
        snapshot_id: null,
        snapshot_created_at: null,
      }),
      acquireSnapshotBuildLock: async () => ({
        acquired: true as const,
        token: "lock-token",
      }),
      startTriggerRun: async (id, payload, options) => {
        receivedId = id;
        receivedPayload = payload;
        receivedOptions = options!;
        return { id: "trigger-run-123" } as never;
      },
    }
  );

  const result = await startDeferredRepoSnapshotBuild({ repoId: "repo-123" });

  assert.deepEqual(result, {
    queued: true,
    reason: null,
    runtimeProvider: "trigger",
    runtimeRunId: "trigger-run-123",
    workflowRunId: null,
  });
  assert.equal(receivedId, "build-repo-snapshot");
  assert.deepEqual(receivedPayload, {
    repoId: "repo-123",
    preAcquiredLockToken: "lock-token",
  });
  assert.equal(
    (receivedOptions as { concurrencyKey?: string } | null)?.concurrencyKey,
    "repo:repo-123"
  );
});

test("startDeferredRepoSnapshotBuild releases the lock when Trigger.dev start fails", async () => {
  const { createDeferredRepoSnapshotBuildStarter } =
    await loadRepoSnapshotWorkflowModule();
  let releasedToken: string | null = null;

  const startDeferredRepoSnapshotBuild = createDeferredRepoSnapshotBuildStarter(
    {
      isTriggerRuntimeConfigured: () => true,
      loadRepoSnapshotBuildRepo: async () => ({
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/repo",
        default_branch: "main",
        root_directory: null,
        sandbox_billing_target: "personal",
        runtime: "node22",
        dev_port: 3000,
        install_command: null,
        dev_command: null,
        sandbox_env_vars: null,
        env_sync_mode: null,
        vercel_project_id: null,
        vercel_team_id: null,
        github_installation_id: null,
        snapshot_id: null,
        snapshot_created_at: null,
      }),
      acquireSnapshotBuildLock: async () => ({
        acquired: true as const,
        token: "lock-token",
      }),
      releaseSnapshotBuildLock: async (_repoId, token) => {
        releasedToken = token;
      },
      startTriggerRun: async () => {
        throw new Error("trigger start failed");
      },
    }
  );

  await assert.rejects(
    () => startDeferredRepoSnapshotBuild({ repoId: "repo-123" }),
    /trigger start failed/
  );
  assert.equal(releasedToken, "lock-token");
});

test("startDeferredRepoSnapshotBuild fails fast when Trigger.dev runtime is not configured", async () => {
  const { createDeferredRepoSnapshotBuildStarter } =
    await loadRepoSnapshotWorkflowModule();

  const startDeferredRepoSnapshotBuild = createDeferredRepoSnapshotBuildStarter(
    {
      isTriggerRuntimeConfigured: () => false,
      loadRepoSnapshotBuildRepo: async () => ({
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/repo",
        default_branch: "main",
        root_directory: null,
        sandbox_billing_target: "personal",
        runtime: "node22",
        dev_port: 3000,
        install_command: null,
        dev_command: null,
        sandbox_env_vars: null,
        env_sync_mode: null,
        vercel_project_id: null,
        vercel_team_id: null,
        github_installation_id: null,
        snapshot_id: null,
        snapshot_created_at: null,
      }),
      acquireSnapshotBuildLock: async () => ({
        acquired: true as const,
        token: "lock-token",
      }),
      releaseSnapshotBuildLock: async () => {},
      startTriggerRun: async () => {
        throw new Error("startTriggerRun should not be called");
      },
    }
  );

  await assert.rejects(
    () => startDeferredRepoSnapshotBuild({ repoId: "repo-123" }),
    /Trigger\.dev runtime is not configured/
  );
});
