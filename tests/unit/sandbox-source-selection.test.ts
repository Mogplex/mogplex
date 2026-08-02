import assert from "node:assert/strict";
import test from "node:test";
import { __resetLockfileHashCacheForTests } from "../../lib/sandbox/lockfile-hash";
import {
  pickSandboxSource,
  type RepoSnapshotInfo,
} from "../../lib/sandbox/source-selection";

const BASE_REPO: RepoSnapshotInfo = {
  id: "repo-1",
  full_name: "owner/repo",
  default_branch: "main",
  root_directory: null,
  snapshot_id: "snap_abc",
  snapshot_lockfile_hash: "a".repeat(64),
};

function fetchReturning(status: number, body = "") {
  return (async () =>
    new Response(body, {
      status,
      statusText: status === 200 ? "OK" : "Not Found",
    })) as unknown as typeof fetch;
}

test("pickSandboxSource picks snapshot when feature flag on and hashes match", async () => {
  __resetLockfileHashCacheForTests();
  // The GitHub hash must equal the stored snapshot_lockfile_hash. We compute
  // sha256 of the fake body; so derive the repo's stored hash from the body.
  const body = "matching-lockfile-bytes";
  const { hashLockfileBytes } = await import("../../lib/sandbox/lockfile-hash");
  const repo: RepoSnapshotInfo = {
    ...BASE_REPO,
    snapshot_lockfile_hash: hashLockfileBytes(Buffer.from(body)),
  };

  const source = await pickSandboxSource({
    repo,
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(200, body),
  });

  assert.equal(source.kind, "snapshot");
  if (source.kind === "snapshot") {
    assert.equal(source.snapshotId, "snap_abc");
    assert.equal(source.expectedLockfileHash, repo.snapshot_lockfile_hash);
  }
});

test("pickSandboxSource returns git/lockfile_drift on hash mismatch", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(200, "something-else"),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "lockfile_drift");
  }
});

test("pickSandboxSource returns git/feature_flag_off when disabled", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: false,
    fetchImpl: fetchReturning(200, "x"),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "feature_flag_off");
  }
});

test("pickSandboxSource returns git/no_baseline when repo has no snapshot", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: { ...BASE_REPO, snapshot_id: null, snapshot_lockfile_hash: null },
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(200, "x"),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "no_baseline");
  }
});

test("pickSandboxSource returns git/github_hash_unavailable on 404", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(404, ""),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "github_hash_unavailable");
  }
});

test("pickSandboxSource returns git/github_hash_unavailable on API error", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "feat/a",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(500, "boom"),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "github_hash_unavailable");
  }
});

test("pickSandboxSource honors manual_restore_requested", async () => {
  __resetLockfileHashCacheForTests();
  const source = await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    restoreSnapshotIdRequested: "snap_other",
    fetchImpl: fetchReturning(200, "x"),
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "manual_restore_requested");
  }
});

test("pickSandboxSource hashes the baseBranch when createBranch=true", async () => {
  __resetLockfileHashCacheForTests();
  let capturedUrl = "";
  const fetchImpl = (async (url: string) => {
    capturedUrl = url;
    return new Response("x", { status: 200, statusText: "OK" });
  }) as unknown as typeof fetch;

  await pickSandboxSource({
    repo: BASE_REPO,
    baseBranch: "main",
    workingBranch: "feat/new",
    createBranch: true,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl,
  });

  assert.ok(capturedUrl.includes("ref=main"));
});

test("pickSandboxSource refuses snapshot restore when launch path differs from baseline", async () => {
  // The baseline snapshot was built at packages/api. The user is
  // launching at apps/admin. Restoring the snapshot would put
  // packages/api's installed deps on the VM and then bootstrap would
  // try to install apps/admin's package.json on top — broken state.
  __resetLockfileHashCacheForTests();
  const repo: RepoSnapshotInfo = {
    ...BASE_REPO,
    root_directory: "packages/api",
  };

  const source = await pickSandboxSource({
    repo,
    baseBranch: "main",
    workingBranch: "feat/x",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(200, "any"),
    effectiveRootDirectory: "apps/admin",
  });

  assert.equal(source.kind, "git");
  if (source.kind === "git") {
    assert.equal(source.reason, "workspace_mismatch");
  }
});

test("pickSandboxSource keeps snapshot when launch path matches baseline", async () => {
  __resetLockfileHashCacheForTests();
  const body = "matching";
  const { hashLockfileBytes } = await import("../../lib/sandbox/lockfile-hash");
  const repo: RepoSnapshotInfo = {
    ...BASE_REPO,
    root_directory: "packages/api",
    snapshot_lockfile_hash: hashLockfileBytes(Buffer.from(body)),
  };

  // Track that the lockfile fetch actually ran. A future refactor
  // that short-circuits before the hash check (e.g. accidentally
  // returning snapshot from the workspace-mismatch guard) would
  // pass kind === 'snapshot' but skip the fetch — this guards
  // against that silent regression.
  let fetchCalls = 0;
  const fetchImpl = (async (url: string) => {
    fetchCalls += 1;
    void url;
    return new Response(body, { status: 200, statusText: "OK" });
  }) as unknown as typeof fetch;

  const source = await pickSandboxSource({
    repo,
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl,
    // Same path as the baseline — snapshot is still valid.
    effectiveRootDirectory: "packages/api",
  });

  assert.equal(source.kind, "snapshot");
  // Exactly one fetch — guards against both "skipped the hash check"
  // and "called twice by accident" regressions.
  assert.equal(
    fetchCalls,
    1,
    "lockfile hash fetch should run exactly once on the snapshot path"
  );
});

test("pickSandboxSource: omitted effectiveRootDirectory falls back to repo default (no mismatch)", async () => {
  // Existing call sites that don't yet thread effectiveRootDirectory
  // must keep their previous behaviour — no synthetic mismatch.
  __resetLockfileHashCacheForTests();
  const body = "match";
  const { hashLockfileBytes } = await import("../../lib/sandbox/lockfile-hash");
  const repo: RepoSnapshotInfo = {
    ...BASE_REPO,
    root_directory: "packages/api",
    snapshot_lockfile_hash: hashLockfileBytes(Buffer.from(body)),
  };

  const source = await pickSandboxSource({
    repo,
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
    githubToken: "t",
    fastSpawnEnabled: true,
    fetchImpl: fetchReturning(200, body),
    // effectiveRootDirectory omitted entirely.
  });

  assert.equal(source.kind, "snapshot");
});
