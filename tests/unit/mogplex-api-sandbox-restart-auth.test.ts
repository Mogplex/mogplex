import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { getDelegatedUserIdFromRequest } from "../../lib/internal-api-auth";
import { toSandboxClientRecord } from "../../lib/sandbox/summary";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxServiceRouteAuth,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";
import { buildPersistedPersistentRestartRecord } from "./helpers/sandbox-restart-route-fixtures";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";

async function buildRestartingLauncher(ownerId = "user-123") {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const { loadOwnedSandboxRouteRecord, loadOwnedSandboxRouteContext } =
    await import("../../lib/sandbox/route-context");
  const { launchMogplexApiSandbox } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  const saved = buildPersistedPersistentRestartRecord({
    user_id: ownerId,
    repo_id: "repo-123",
    status: "stopped",
  });
  const providerCalls: boolean[] = [];
  const recordDeps = {
    getSandboxServiceCredentials: async (request?: Request) => {
      const userId = request ? getDelegatedUserIdFromRequest(request) : null;
      return userId ? buildSandboxServiceRouteAuth({ userId }) : null;
    },
    loadOwnedSandboxRecord: async (id: string, userId: string) =>
      id === saved.id && userId === saved.user_id ? saved : null,
  };
  const restart = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (request, id, options) =>
      loadOwnedSandboxRouteRecord(request, id, options, recordDeps),
    loadOwnedSandboxRouteContext: (request, id, options) =>
      loadOwnedSandboxRouteContext(request, id, options, {
        ...recordDeps,
        resolveSandboxRecordContext: async () => ({
          ok: true,
          context: {
            credentials: {
              vercelToken: "vercel-token",
              vercelTeamId: null,
              vercelProjectId: "project-123",
            },
            ownership: {
              source: "record",
              billingSource: "platform",
              credentialSource: "platform",
              projectId: "project-123",
              teamId: null,
            },
          },
        }),
      }),
    enforceSandboxBootLimits: async () => ({ allowed: true }),
    getSandbox: async (_id, _credentials, options) => {
      providerCalls.push(options?.resume ?? false);
      return {
        sandboxId: saved.sandbox_id,
        stop: async () => {},
        currentSession: () => ({ stoppedAt: new Date() }),
      } as never;
    },
    updateSandboxRecord: async (_id, updates) =>
      ({ ...saved, ...updates }) as never,
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    async *bootstrapFromSnapshotStreaming() {
      yield { type: "status", status: "running" };
    },
  });
  const post = await createSandboxPostTestHandler({
    // The v1 adapter already resolved the caller's credentials for CREATE.
    // Restart must independently authenticate the delegated request.
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({ allowed: true }),
    resolveNameCollision: async () => ({
      kind: "restart",
      record: toSandboxClientRecord({
        ...saved,
        base_branch: "main",
        working_branch: "feature-a",
        stop_reason: null,
      }),
    }),
    restartSandboxRecord: (request, id) =>
      restart(request, { params: Promise.resolve({ id }) }),
    createSandboxForRepo: async () => {
      throw new Error("Must preserve the saved workspace");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("Must resume the existing persistent VM");
    },
  });
  return {
    saved,
    providerCalls,
    launchSandbox: (userId: string, body: Record<string, unknown>) =>
      launchMogplexApiSandbox(userId, body, post),
  };
}

async function withInternalSecret(runTest: () => Promise<void>) {
  const previous = process.env.INTERNAL_API_SECRET;
  const previousBackend = process.env.MOGPLEX_DATA_BACKEND;
  const originalFetch = globalThis.fetch;
  process.env.INTERNAL_API_SECRET = "sandbox-restart-test-secret";
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/profiles\?/);
    return Response.json({ allow_platform_sandbox: false });
  };
  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBackend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
    else process.env.MOGPLEX_DATA_BACKEND = previousBackend;
    if (previous === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previous;
  }
}

function sandboxRequest(body: unknown) {
  return new NextRequest("https://mogplex.example/api/v1/mogplex/sandboxes", {
    method: "POST",
    headers: {
      authorization: "Bearer mog_test",
      "content-type": "application/json",
      // Untrusted delegation headers from clients must never select the actor.
      "x-delegated-user-id": "other-user",
    },
    body: JSON.stringify(body),
  });
}

test("v1 sandbox creation restarts the caller's saved persistent workspace", async () => {
  await withInternalSecret(async () => {
    const fixture = await buildRestartingLauncher();
    const { createMogplexApiSandboxesPostHandler } =
      await import("../../app/api/v1/mogplex/sandboxes/route");
    const handler = createMogplexApiSandboxesPostHandler({
      ...fixture,
      resolveApiKey: async () => ({
        ok: true,
        auth: {
          userId: "user-123",
          keyId: "key-1",
          scopes: ["write"],
          access: "full",
        },
      }),
      loadTeamKeyAccess: async () => null,
    });
    const response = await handler(sandboxRequest({ repoId: "repo-123" }));
    const payload = await response.json();
    assert.equal(response.status, 202, JSON.stringify(payload));
    assert.equal(payload.data.sandbox.id, fixture.saved.id);
    assert.equal(payload.data.sandbox.sandbox_id, fixture.saved.sandbox_id);
    assert.equal(payload.data.sandbox.status, "running");
    assert.equal(payload.data.sandbox.root_directory, null);
    assert.deepEqual(fixture.providerCalls, [false, true]);
  });
});

test("delegated v1 restart still rejects a workspace belonging to another user", async () => {
  await withInternalSecret(async () => {
    const fixture = await buildRestartingLauncher("other-user");
    const result = await fixture.launchSandbox("user-123", {
      repoId: "repo-123",
    });
    assert.deepEqual(result, {
      ok: false,
      status: 404,
      error: "Sandbox not found",
    });
    assert.deepEqual(fixture.providerCalls, []);
  });
});

test("v1 sandbox creation rejects invalid input and missing authentication before launch", async () => {
  const { createMogplexApiSandboxesPostHandler } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  const launchSandbox = async () => {
    throw new Error("Rejected requests must not launch a sandbox");
  };
  const authenticated = createMogplexApiSandboxesPostHandler({
    launchSandbox,
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["write"],
        access: "full",
      },
    }),
  });
  assert.equal((await authenticated(sandboxRequest({}))).status, 400);
  const unauthenticated = createMogplexApiSandboxesPostHandler({
    launchSandbox,
    resolveApiKey: async () => ({ ok: false, reason: "invalid" }),
  });
  assert.equal(
    (await unauthenticated(sandboxRequest({ repoId: "repo-123" }))).status,
    401
  );
});
