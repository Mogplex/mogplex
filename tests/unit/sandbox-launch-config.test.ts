import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxLaunchConfig() {
  return import("../../lib/sandbox/launch-config");
}

test("default sandbox launches create an isolated delivery branch", async () => {
  const { buildDefaultSandboxLaunchChoice } = await loadSandboxLaunchConfig();
  const choice = buildDefaultSandboxLaunchChoice(
    {
      id: "repo-1",
      full_name: "acme/demo",
      default_branch: "trunk",
    },
    new Date("2026-08-05T12:34:56.000Z")
  );

  assert.deepEqual(choice, {
    repoId: "repo-1",
    baseBranch: "trunk",
    workingBranch: "mogplex/demo-20260805t123456",
    createBranch: true,
  });
});

test("resolveSandboxLaunchRequest defaults to the repo branch for standard launches", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: {
      repoId: "repo-1",
    },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.value, {
    repoId: "repo-1",
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
    rootDirectory: undefined,
    restoreSnapshotId: null,
    restoreSnapshotProjectId: null,
    restoreSnapshotTeamId: null,
  });
});

test("resolveSandboxLaunchRequest accepts explicit create-branch launches", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "mogplex/docs-20260404",
      createBranch: true,
    },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.value, {
    repoId: "repo-1",
    baseBranch: "main",
    workingBranch: "mogplex/docs-20260404",
    createBranch: true,
    rootDirectory: undefined,
    restoreSnapshotId: null,
    restoreSnapshotProjectId: null,
    restoreSnapshotTeamId: null,
  });
});

test("resolveSandboxLaunchRequest carries explicit null rootDirectory through (repo root override)", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: null },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.rootDirectory, null);
});

test("resolveSandboxLaunchRequest strips a leading slash from rootDirectory and a trailing slash", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "/apps/web/" },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.rootDirectory, "apps/web");
});

test("resolveSandboxLaunchRequest accepts a relative-with-trailing-slash path and strips the trailing slash", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "apps/web/" },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.rootDirectory, "apps/web");
});

test("resolveSandboxLaunchRequest rejects parent traversal in rootDirectory", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "apps/../etc" },
    repoDefaultBranch: "main",
  });

  assert.deepEqual(resolved, {
    ok: false,
    error: "Invalid root directory",
  });
});

test("resolveSandboxLaunchRequest rejects percent-encoded parent traversal in rootDirectory", async () => {
  // Defense-in-depth from mogplex review on PR #301: the validator
  // rejects literal `..` segments after normalization, but raw
  // percent-encoded `%2e%2e` survives normalization (bash doesn't
  // decode it). A future caller that passes the stored path through
  // a filesystem or HTTP API that DOES decode percent must still get
  // a rejection from the same validator.
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  for (const malformed of [
    "apps/%2e%2e/etc",
    "apps/%2E%2E/etc",
    "%2e%2e/escape",
    "trailing/%2e",
  ]) {
    const resolved = resolveSandboxLaunchRequest({
      body: { repoId: "repo-1", rootDirectory: malformed },
      repoDefaultBranch: "main",
    });
    assert.deepEqual(
      resolved,
      { ok: false, error: "Invalid root directory" },
      `expected ${malformed} to be rejected`
    );
  }
});

test("resolveSandboxLaunchRequest rejects NUL bytes in rootDirectory", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "apps\0/web" },
    repoDefaultBranch: "main",
  });

  assert.deepEqual(resolved, {
    ok: false,
    error: "Invalid root directory",
  });
});

test("resolveSandboxLaunchRequest collapses '.' to repo root (rootDirectory: null)", async () => {
  // POSIX "." means "current directory", which in launch terms is repo
  // root. normalizeRootDirectory must collapse it to null so it doesn't
  // flow through as the literal string '.' to the DB and the sandbox
  // shell's `cd '.'` (a no-op that misrepresents launch intent).
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "." },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.rootDirectory, null);
});

test("resolveSandboxLaunchRequest collapses interior double-slashes (apps//web → apps/web)", async () => {
  // normalizeRootDirectory now collapses runs of "/" to a single "/"
  // (mogplex review on PR #301). The validator therefore sees a
  // well-formed path and the resolved request stores the collapsed
  // form. Either result is acceptable as long as nothing reaches the
  // sandbox shell with consecutive slashes.
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: { repoId: "repo-1", rootDirectory: "apps//web" },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.rootDirectory, "apps/web");
});

test("resolveSandboxLaunchRequest passes through restoreSnapshotId from restart flow", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "feature/my-branch",
      createBranch: false,
      restoreSnapshotId: "snap_abc123",
    },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.equal(resolved.value.restoreSnapshotId, "snap_abc123");
  assert.equal(resolved.value.workingBranch, "feature/my-branch");
  assert.equal(resolved.value.restoreSnapshotProjectId, null);
  assert.equal(resolved.value.restoreSnapshotTeamId, null);
});

test("resolveSandboxLaunchRequest preserves snapshot billing credentials for cross-project restore", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "main",
      createBranch: false,
      restoreSnapshotId: "snap_abc123",
      restoreSnapshotProjectId: "prj_old_project",
      restoreSnapshotTeamId: "team_old_team",
    },
    repoDefaultBranch: "main",
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.equal(resolved.value.restoreSnapshotId, "snap_abc123");
  assert.equal(resolved.value.restoreSnapshotProjectId, "prj_old_project");
  assert.equal(resolved.value.restoreSnapshotTeamId, "team_old_team");
});

test("resolveSandboxLaunchPathChoice: 'Repo root' on a repo with no default omits the override", async () => {
  const {
    resolveSandboxLaunchPathChoice,
    SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
  } = await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
    "",
    null
  );
  assert.deepEqual(result, { ok: true, value: undefined });
});

test("resolveSandboxLaunchPathChoice: 'Repo root' on a monorepo with a default returns null (explicit override)", async () => {
  const {
    resolveSandboxLaunchPathChoice,
    SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
  } = await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
    "",
    "packages/api"
  );
  assert.deepEqual(result, { ok: true, value: null });
});

test("resolveSandboxLaunchPathChoice: explicit workspace selection that matches repo default still pins the path", async () => {
  // Regression for mogplex review on PR #301: the previous behaviour
  // returned `undefined` here, which would have made resume/restart
  // silently follow `repos.root_directory` if it changed later. Picking
  // the workspace from the dropdown is an explicit "lock to this path"
  // signal — the sandbox row must record the path verbatim.
  const { resolveSandboxLaunchPathChoice } = await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    "packages/api",
    "",
    "packages/api"
  );
  assert.deepEqual(result, { ok: true, value: "packages/api" });
});

test("resolveSandboxLaunchPathChoice: explicit workspace selection differing from repo default returns that path", async () => {
  const { resolveSandboxLaunchPathChoice } = await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    "apps/admin",
    "",
    "packages/api"
  );
  assert.deepEqual(result, { ok: true, value: "apps/admin" });
});

test("resolveSandboxLaunchPathChoice: workspace path that normalizes to null is rejected", async () => {
  // Regression for mogplex review on PR #301: a malformed workspace
  // entry like "/" or "." normalizes to null; the older code would have
  // silently sent rootDirectory: null (explicit repo-root override).
  const { resolveSandboxLaunchPathChoice } = await loadSandboxLaunchConfig();
  for (const malformed of ["/", "."]) {
    const result = resolveSandboxLaunchPathChoice(
      malformed,
      "",
      "packages/api"
    );
    assert.deepEqual(result, {
      ok: false,
      error: "Workspace path looks invalid.",
    });
  }
});

test("resolveSandboxLaunchPathChoice: empty custom path is rejected with a friendly error", async () => {
  const { resolveSandboxLaunchPathChoice, SANDBOX_LAUNCH_PATH_CUSTOM_VALUE } =
    await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    SANDBOX_LAUNCH_PATH_CUSTOM_VALUE,
    "   ",
    null
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Type a path or pick 'Repo root' instead.",
  });
});

test("resolveSandboxLaunchPathChoice: custom path with traversal is rejected", async () => {
  const { resolveSandboxLaunchPathChoice, SANDBOX_LAUNCH_PATH_CUSTOM_VALUE } =
    await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    SANDBOX_LAUNCH_PATH_CUSTOM_VALUE,
    "apps/../etc",
    null
  );
  assert.equal(result.ok, false);
});

test("resolveSandboxLaunchPathChoice: well-formed custom path returns the normalized value", async () => {
  const { resolveSandboxLaunchPathChoice, SANDBOX_LAUNCH_PATH_CUSTOM_VALUE } =
    await loadSandboxLaunchConfig();
  const result = resolveSandboxLaunchPathChoice(
    SANDBOX_LAUNCH_PATH_CUSTOM_VALUE,
    "/apps//web/",
    null
  );
  assert.deepEqual(result, { ok: true, value: "apps/web" });
});

test("resolveSandboxLaunchRequest rejects invalid branch names", async () => {
  const { resolveSandboxLaunchRequest } = await loadSandboxLaunchConfig();

  const resolved = resolveSandboxLaunchRequest({
    body: {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "bad branch",
      createBranch: true,
    },
    repoDefaultBranch: "main",
  });

  assert.deepEqual(resolved, {
    ok: false,
    error: "Invalid working branch",
  });
});
