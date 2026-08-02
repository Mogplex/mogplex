import assert from "node:assert/strict";
import test from "node:test";
import { hashLockfileBytes } from "../../lib/sandbox/lockfile-hash";

async function loadBuilder() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const mod = await import("../../lib/repo-snapshot-build");
  return mod.createRepoSnapshotBuilder;
}

const LOCKFILE_BODY = "pnpm-body";
const COMMIT_SHA = "1234567890abcdef1234567890abcdef12345678";

function makeSandbox(): Record<string, unknown> {
  return {
    stop: async () => {},
    runCommand: async ({ args }: { args: string[] }) => ({
      stdout: async () =>
        args.join(" ").includes("git rev-parse HEAD") ? `${COMMIT_SHA}\n` : "",
    }),
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path.endsWith("pnpm-lock.yaml")) {
        return Buffer.from(LOCKFILE_BODY);
      }
      return null;
    },
  };
}

test("buildRepoSnapshot persists lockfile hash and commit SHA", async () => {
  const createRepoSnapshotBuilder = await loadBuilder();
  const persistCalls: Array<{
    snapshotId: string;
    metadata?: { lockfileHash?: string | null; commitSha?: string | null };
  }> = [];

  const deps: Record<string, unknown> = {
    getGithubAccessTokenForRepo: async () => "gh-token",
    enforceSnapshotBuildLimits: async () => ({ allowed: true }),
    acquireSnapshotBuildLock: async () => ({ acquired: true, token: "tok" }),
    releaseSnapshotBuildLock: async () => {},
    detectRuntimeFromGithub: async () => "node22",
    createSandboxForRepo: async () => makeSandbox(),
    bootstrapSandbox: async () => ({}),
    cleanupPreparedSandboxVercelLink: async () => {},
    snapshotSandbox: async () => ({
      snapshotId: "snap_new",
      status: "ready",
      sizeBytes: 1,
      createdAt: new Date(0),
    }),
    persistSnapshotBuild: async (
      _repoId: string,
      _token: string,
      snapshotId: string,
      _owner: unknown,
      metadata?: { lockfileHash?: string | null; commitSha?: string | null }
    ) => {
      persistCalls.push({ snapshotId, metadata });
      return true;
    },
  };

  const builder = createRepoSnapshotBuilder(
    deps as unknown as Parameters<typeof createRepoSnapshotBuilder>[0]
  );

  const repo = {
    id: "repo-1",
    user_id: "user-1",
    full_name: "owner/repo",
    default_branch: "main",
    root_directory: null,
    runtime: "node22" as const,
    dev_port: 3000,
    install_command: null,
    dev_command: null,
    snapshot_id: null,
    snapshot_created_at: null,
  } as unknown as Parameters<typeof builder>[0]["repo"];

  const sandboxCredentials = {
    userId: "user-1",
    vercelToken: "vt",
    vercelTeamId: null,
    vercelProjectId: "proj",
    allowPlatformSandbox: true,
    userVercelToken: "vt",
  } as unknown as Parameters<typeof builder>[0]["sandboxCredentials"];

  const result = await builder({ repo, sandboxCredentials });

  assert.equal(result.status, "built");
  assert.equal(persistCalls.length, 1);
  assert.equal(persistCalls[0].snapshotId, "snap_new");
  assert.equal(
    persistCalls[0].metadata?.lockfileHash,
    hashLockfileBytes(Buffer.from(LOCKFILE_BODY))
  );
  assert.equal(persistCalls[0].metadata?.commitSha, COMMIT_SHA);
});
