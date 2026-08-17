import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";

function buildLaunchRequest() {
  return buildSandboxCollectionRequest({
    method: "POST",
    init: {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "repo-123" }),
    },
  });
}

test("POST /api/sandbox delegates a stopped persistent collision to restart", async () => {
  let sandboxCreations = 0;
  const restarted: string[] = [];
  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({ allowed: true }),
    resolveNameCollision: async () => ({
      kind: "restart",
      record: { id: "sandbox-stopped-1" } as never,
    }),
    restartSandboxRecord: async (_request, sandboxRecordId) => {
      restarted.push(sandboxRecordId);
      return Response.json({ restarted: true }, { status: 202 });
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

  const response = await handler(buildLaunchRequest());

  assert.equal(response.status, 202);
  assert.deepEqual(restarted, ["sandbox-stopped-1"]);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox returns a conflict without creating a record while Vercel is stopping", async () => {
  let sandboxCreations = 0;
  let restartCalls = 0;
  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({ allowed: true }),
    resolveNameCollision: async () => ({
      kind: "busy",
      record: { id: "sandbox-stopping-1" } as never,
    }),
    restartSandboxRecord: async () => {
      restartCalls += 1;
      throw new Error("restartSandboxRecord should not be called");
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

  const response = await handler(buildLaunchRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error:
      "The existing sandbox is still stopping. Start it again after shutdown completes.",
    code: "sandbox_transition_in_progress",
    sandboxId: "sandbox-stopping-1",
  });
  assert.equal(restartCalls, 0);
  assert.equal(sandboxCreations, 0);
});
