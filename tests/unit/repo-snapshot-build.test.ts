import assert from "node:assert/strict";
import test from "node:test";

type SnapshotBuildRepoRecord =
  import("../../lib/repo-snapshot-build").SnapshotBuildRepoRecord;
type BootstrapSandboxFn =
  typeof import("../../lib/sandbox/client").bootstrapSandbox;
type CleanupPreparedSandboxVercelLinkFn =
  typeof import("../../lib/vercel/env-vars").cleanupPreparedSandboxVercelLink;
type SnapshotSandboxFn =
  typeof import("../../lib/sandbox/client").snapshotSandbox;
type CreatedSandbox = Awaited<
  ReturnType<typeof import("../../lib/sandbox/client").createSandboxForRepo>
>;

async function loadRepoSnapshotBuildModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/repo-snapshot-build");
}

function createRepo(
  overrides: Partial<SnapshotBuildRepoRecord> = {}
): SnapshotBuildRepoRecord {
  return {
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
    ...overrides,
  };
}

test("buildRepoSnapshot returns rate-limited result after acquiring and releasing a lock", async () => {
  const { createRepoSnapshotBuilder } = await loadRepoSnapshotBuildModule();
  let lockAttempts = 0;
  let releasedToken: string | null = null;

  const buildRepoSnapshot = createRepoSnapshotBuilder({
    getGithubAccessTokenForRepo: async () => "github-token",
    enforceSnapshotBuildLimits: async () => ({
      allowed: false,
      status: 429,
      code: "snapshot_rate_limited",
      error: "Snapshot build is cooling down",
      reason: "snapshot_build_cooldown_active",
      retryAfterSeconds: 60,
      limit: {
        name: "snapshot_build_cooldown",
        value: 1,
        windowSeconds: 900,
      },
    }),
    acquireSnapshotBuildLock: async () => {
      lockAttempts += 1;
      return { acquired: true as const, token: "lock-token" };
    },
    releaseSnapshotBuildLock: async (_repoId, token) => {
      releasedToken = token;
    },
  });

  const result = await buildRepoSnapshot({
    repo: createRepo({
      snapshot_id: "snapshot-1",
      snapshot_created_at: "2026-03-23T15:00:00.000Z",
    }),
    sandboxCredentials: {
      userId: "user-123",
      vercelToken: "vercel-token",
      vercelTeamId: null,
      vercelProjectId: "project-123",
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    },
  });

  assert.deepEqual(result, {
    status: "rate_limited",
    decision: {
      allowed: false,
      status: 429,
      code: "snapshot_rate_limited",
      error: "Snapshot build is cooling down",
      reason: "snapshot_build_cooldown_active",
      retryAfterSeconds: 60,
      limit: {
        name: "snapshot_build_cooldown",
        value: 1,
        windowSeconds: 900,
      },
    },
  });
  assert.equal(lockAttempts, 1);
  assert.equal(releasedToken, "lock-token");
});

test("buildRepoSnapshot reuses a pre-acquired lock and persists the snapshot", async () => {
  const { createRepoSnapshotBuilder } = await loadRepoSnapshotBuildModule();
  let releasedToken: string | null = null;
  let persistedSnapshotId: string | null = null;
  let persistedOwnership: {
    billingSource: string;
    billingProjectId: string;
    billingTeamId: string | null;
  } | null = null;
  let created = 0;

  const fakeSandbox = {
    stop: async () => {},
  } as unknown as CreatedSandbox;

  const buildRepoSnapshot = createRepoSnapshotBuilder({
    getGithubAccessTokenForRepo: async () => "github-token",
    enforceSnapshotBuildLimits: async () => ({ allowed: true }),
    acquireSnapshotBuildLock: async () => {
      throw new Error(
        "acquireSnapshotBuildLock should not be called when a lock token is provided"
      );
    },
    createSandboxForRepo: async () => {
      created += 1;
      return fakeSandbox;
    },
    bootstrapSandbox: (async () => ({
      previewUrl: "https://preview.test",
      runtime: "node22",
      packageManager: "pnpm",
      framework: undefined,
      installCommand: "pnpm install",
      devCommand: "pnpm dev",
      installLog: "",
      devLog: "",
      healthStatus: "running",
      readiness: { ready: true },
    })) as BootstrapSandboxFn,
    cleanupPreparedSandboxVercelLink: (async () => ({
      removedFiles: [],
    })) as CleanupPreparedSandboxVercelLinkFn,
    snapshotSandbox: (async () => ({
      snapshotId: "snapshot-123",
      status: "created",
      sizeBytes: 1024,
      createdAt: new Date("2026-03-23T16:00:00.000Z"),
    })) as unknown as SnapshotSandboxFn,
    persistSnapshotBuild: async (_repoId, _token, snapshotId, ownership) => {
      persistedSnapshotId = snapshotId;
      persistedOwnership = ownership;
      return true;
    },
    releaseSnapshotBuildLock: async (_repoId, token) => {
      releasedToken = token;
    },
  });

  const result = await buildRepoSnapshot({
    repo: createRepo(),
    sandboxCredentials: {
      userId: "user-123",
      vercelToken: "vercel-token",
      vercelTeamId: null,
      vercelProjectId: "project-123",
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    },
    preAcquiredLockToken: "lock-token",
  });

  assert.deepEqual(result, {
    status: "built",
    snapshot: {
      id: "snapshot-123",
      status: "created",
      sizeBytes: 1024,
      createdAt: "2026-03-23T16:00:00.000Z",
    },
  });
  assert.equal(created, 1);
  assert.equal(persistedSnapshotId, "snapshot-123");
  assert.deepEqual(persistedOwnership, {
    billingSource: "platform",
    billingProjectId: "project-123",
    billingTeamId: null,
  });
  assert.equal(releasedToken, "lock-token");
});
