import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";

test("POST /api/sandbox returns an existing running sandbox with normalized summaries", async () => {
  let sandboxCreations = 0;

  const existing = {
    id: "sandbox-1",
    sandbox_id: "vm_123",
    repo_id: "repo-123",
    user_id: "user-123",
    status: "running",
    preview_url: "https://preview.example.com",
    runtime: "node22",
    health_status: "running",
    billing_source: "user_vercel_project",
    billing_team_id: "team-acme",
    billing_project_id: "project-acme",
    vercel_team_id: "team-acme",
    vercel_project_id: "project-acme",
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:01:00.000Z",
  };

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async (_repoId, _userId, workingBranch) => {
      assert.equal(workingBranch, "main");
      return existing as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.id, "sandbox-1");
  assert.deepEqual(payload.sandbox.billing_summary, {
    source: "user_vercel_project",
    label: "Your Vercel project",
    project_id: "project-acme",
    team_id: "team-acme",
    team_label: "team-acme",
  });
  assert.equal("status" in payload.sandbox, false);
  assert.equal("preview_url" in payload.sandbox, false);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox scopes the active-sandbox lookup by the launch-time rootDirectory override", async () => {
  const lookupCalls: Array<{
    workingBranch: string | null | undefined;
    rootDirectory: string | null | undefined;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ workingBranch, rootDirectory });
      // Pretend a sandbox already exists at this path so the route
      // short-circuits before any creation work.
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  // Launch with explicit override -> lookup must filter on that path.
  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-123",
          rootDirectory: "apps/web",
        }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0]?.rootDirectory, "apps/web");
});

test("POST /api/sandbox preserves repo.root_directory for non-monorepo repos when the launch payload omits the override", async () => {
  // Regression for mogplex review on PR #301: a non-monorepo repo with
  // repos.root_directory = "packages/api" must keep that path when the
  // launch dialog (which doesn't render the picker for non-monorepo
  // repos) submits without a rootDirectory field. If the dialog had
  // accidentally spread rootDirectory: null into the payload, the route
  // would have switched to "explicit repo root" and broken the
  // sandbox's working directory.
  const lookupCalls: Array<{ rootDirectory: string | null | undefined }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      _workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls[0]?.rootDirectory, "packages/api");
});

test("POST /api/sandbox honours an explicit null rootDirectory override (repo-root choice on a monorepo)", async () => {
  // Counterpart to the test above: when the launch payload DOES include
  // rootDirectory: null, the route must treat it as an explicit "repo
  // root" choice and override repos.root_directory rather than
  // collapsing back to the repo default.
  const lookupCalls: Array<{ rootDirectory: string | null | undefined }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      _workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123", rootDirectory: null }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls[0]?.rootDirectory, null);
});

test("POST /api/sandbox falls back to repo.root_directory when launch omits rootDirectory", async () => {
  const lookupCalls: Array<{
    workingBranch: string | null | undefined;
    rootDirectory: string | null | undefined;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ workingBranch, rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0]?.rootDirectory, "packages/api");
});
