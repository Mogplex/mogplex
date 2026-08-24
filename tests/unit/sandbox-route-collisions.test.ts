import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxLaunchPreparation } from "../../app/api/sandbox/_lib/types";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  createSandboxPostTestHandler,
  loadSandboxRouteModule,
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
      "Mogplex must finish cleanup for the previous sandbox. Start it again in a moment.",
    code: "sandbox_transition_in_progress",
    sandboxId: "sandbox-stopping-1",
  });
  assert.equal(restartCalls, 0);
  assert.equal(sandboxCreations, 0);
});

test("terminal cleanup selects a replacement name and continues the same launch", async () => {
  await loadSandboxRouteModule();
  const { maybeReturnNameCollisionResponse } =
    await import("../../app/api/sandbox/_lib/launch");
  const launch = {
    repoId: "repo-123",
    creds: { userId: "user-123" },
    actorUserId: "user-123",
    productTeamId: null,
    effectiveRootDirectory: null,
    runtime: "node22",
    launchRequest: {
      workingBranch: "main",
      baseBranch: "main",
    },
    createContext: {
      credentials: {
        vercelProjectId: "project-123",
        vercelTeamId: null,
      },
      ownership: { billingSource: "platform" },
    },
  } as unknown as SandboxLaunchPreparation;
  const response = await maybeReturnNameCollisionResponse(
    {
      resolveNameCollision: async () => ({
        kind: "replace",
        record: { id: "12345678-aaaa-bbbb-cccc-dddddddddddd" } as never,
      }),
    } as never,
    launch,
    null,
    buildLaunchRequest()
  );

  assert.equal(response, null);
  const replacementName = launch.sandboxNameOverride;
  assert.ok(replacementName);
  assert.match(replacementName, /-12345678$/);
  assert.ok(replacementName.length <= 60);
});
