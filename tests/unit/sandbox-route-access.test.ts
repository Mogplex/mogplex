import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  buildSandboxServiceWorkspace,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";

test("POST /api/sandbox returns 404 for repo IDs the caller does not own", async () => {
  let accessLookups = 0;
  let sandboxCreations = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async (repoId, userId, options) => {
      accessLookups += 1;
      assert.equal(repoId, "repo-999");
      assert.equal(userId, "user-123");
      assert.equal(
        options?.select,
        "*, workspace:workspaces(id, sandbox_billing_mode, sandbox_timeout_ms, sandbox_vercel_project_id, sandbox_vercel_team_id)"
      );
      return { repo: null, githubToken: null };
    },
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
        body: JSON.stringify({ repoId: "repo-999" }),
      },
    })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Repo not found" });
  assert.equal(accessLookups, 1);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox returns 400 when an owned repo has no GitHub token", async () => {
  let sandboxCreations = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { runtime: null },
        githubToken: null,
      }),
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

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Connect GitHub account first",
  });
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox blocks platform-billed launches for users without platform sandbox access", async () => {
  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({ allowPlatformSandbox: false }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { runtime: null },
        workspace: buildSandboxServiceWorkspace({
          id: "ws-1",
          sandbox_billing_mode: "platform",
        }),
      }),
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

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
  });
});

test("POST /api/sandbox rejects an inaccessible hosted Vercel project before creating a sandbox", async () => {
  let sandboxCreations = 0;
  let activeSandboxLookups = 0;
  const accessChecks: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "stale-platform-project",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        workspace: buildSandboxServiceWorkspace({
          sandbox_billing_mode: "platform",
        }),
      }),
    validateVercelProjectAccess: async (input) => {
      accessChecks.push(input);
      return {
        ok: false as const,
        error: {
          code: "PROJECT_NOT_FOUND",
          status: 404,
          message: "Could not find project: stale-platform-project",
        },
      };
    },
    getActiveSandboxForRepo: async () => {
      activeSandboxLookups += 1;
      return null;
    },
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

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
    code: "SANDBOX_SERVICE_UNAVAILABLE",
  });
  assert.deepEqual(accessChecks, [
    {
      authMode: "platform",
      vercelToken: "platform-vercel-token",
      teamId: "platform-team",
      projectId: "stale-platform-project",
    },
  ]);
  assert.equal(activeSandboxLookups, 0);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox does not reactivate a legacy user-billing override", async () => {
  let sandboxCreations = 0;
  const persistedRepoStates: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelProjectId: "platform-project",
        userVercelToken: "user-vercel-token",
        userVercelTeamId: "team-acme",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: {
          sandbox_billing_mode_override: "user_vercel_project",
          vercel_team_id: "team-acme",
          vercel_project_id: "repo-project",
        },
        workspace: buildSandboxServiceWorkspace({
          sandbox_billing_mode: "platform",
        }),
      }),
    validateVercelProjectAccess: async () => ({
      ok: false as const,
      error: {
        code: "PROJECT_NOT_FOUND",
        status: 404,
        message: "missing",
      },
    }),
    persistRepoVercelLinkState: async (repoId, userId, state) => {
      persistedRepoStates.push({ repoId, userId, ...state });
    },
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

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
    code: "SANDBOX_SERVICE_UNAVAILABLE",
  });
  assert.equal(sandboxCreations, 0);
  assert.deepEqual(persistedRepoStates, []);
});

test("POST /api/sandbox ignores legacy workspace user billing", async () => {
  const persistedWorkspaceStates: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelProjectId: "platform-project",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        workspace: buildSandboxServiceWorkspace({
          id: "ws-1",
          sandbox_billing_mode: "user_vercel_project",
        }),
      }),
    persistWorkspaceVercelLinkState: async (workspaceId, userId, state) => {
      persistedWorkspaceStates.push({ workspaceId, userId, ...state });
    },
    validateVercelProjectAccess: async () => ({
      ok: false as const,
      error: {
        code: "PROJECT_NOT_FOUND",
        status: 404,
        message: "missing",
      },
    }),
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

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
    code: "SANDBOX_SERVICE_UNAVAILABLE",
  });
  assert.deepEqual(persistedWorkspaceStates, []);
});
