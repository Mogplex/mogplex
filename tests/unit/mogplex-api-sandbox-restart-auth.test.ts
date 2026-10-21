import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { toSandboxClientRecord } from "../../lib/sandbox/summary";
import {
  buildOwnedRepoWithGithubAccess,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";
import { buildPersistedPersistentRestartRecord } from "./helpers/sandbox-restart-route-fixtures";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";

const REPO_ID = "00000000-0000-4000-8000-000000000123";
const TEAM_ID = "00000000-0000-4000-8000-000000000456";

async function buildRestartingLauncher(
  ownerId = "user-123",
  beforeRestart?: () => void
) {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const { loadOwnedSandboxRouteRecord, loadOwnedSandboxRouteContext } =
    await import("../../lib/sandbox/route-context");
  const { launchMogplexApiSandbox } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  const saved = buildPersistedPersistentRestartRecord({
    user_id: ownerId,
    repo_id: REPO_ID,
    status: "stopped",
  });
  const providerCalls: boolean[] = [];
  const recordDeps = {
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
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({ repo: { id: REPO_ID } }),
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
    restartSandboxRecord: (request, id) => {
      beforeRestart?.();
      return restart(request, { params: Promise.resolve({ id }) });
    },
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

type SandboxApiFixture = {
  teamId: string | null;
  role: "developer" | "viewer" | null;
  repoFound: boolean;
  repoLookupFails: boolean;
};

async function withInternalSecret(
  runTest: (fixture: SandboxApiFixture) => Promise<void>
) {
  const environment = {
    INTERNAL_API_SECRET: "sandbox-restart-test-secret",
    MOGPLEX_DATA_BACKEND: "supabase",
    APP_URL: "https://configured-app.example",
    PLATFORM_VERCEL_TOKEN: "vercel-token",
    VERCEL_PROJECT_ID: "project-123",
    PLATFORM_VERCEL_TEAM_ID: "",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  };
  const previous = new Map(
    Object.keys(environment).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, environment);
  const fixture: SandboxApiFixture = {
    teamId: null,
    role: "developer",
    repoFound: true,
    repoLookupFails: false,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/profiles")) {
      return Response.json({
        id: "user-123",
        allow_platform_ai: true,
        allow_platform_sandbox: true,
      });
    }
    if (url.pathname.endsWith("/repos")) {
      assert.equal(url.searchParams.get("user_id"), "eq.user-123");
      assert.equal(url.searchParams.get("id"), `eq.${REPO_ID}`);
      return fixture.repoLookupFails
        ? Response.json(
            { message: "repository lookup failed" },
            { status: 500 }
          )
        : Response.json(
            fixture.repoFound ? { product_team_id: fixture.teamId } : null
          );
    }
    if (url.pathname.endsWith("/team_members")) {
      return Response.json(
        url.searchParams.get("team_id") === `eq.${fixture.teamId}` &&
          fixture.role
          ? { id: "member-123", role: fixture.role }
          : null
      );
    }
    if (url.pathname.endsWith("/team_audit_events")) return Response.json(null);
    if (url.pathname.endsWith("/rpc/get_oauth_token"))
      return Response.json(null);
    throw new Error(`Unexpected database boundary: ${url.pathname}`);
  };
  try {
    await runTest(fixture);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
      "x-mogplex-team-id": "00000000-0000-4000-8000-000000000999",
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
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
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
      repoId: REPO_ID,
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
    (await unauthenticated(sandboxRequest({ repoId: REPO_ID }))).status,
    401
  );
});

async function createAuthenticatedHandler(
  launchSandbox: Awaited<
    ReturnType<typeof buildRestartingLauncher>
  >["launchSandbox"]
) {
  const { createMogplexApiSandboxesPostHandler } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  return createMogplexApiSandboxesPostHandler({
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
    loadTeamKeyAccess: async () => "full",
  });
}

test("v1 launch returns a safe 503 when delegated authentication is not configured", async () => {
  await withInternalSecret(async () => {
    const { launchMogplexApiSandbox } =
      await import("../../app/api/v1/mogplex/sandboxes/route");
    const handler = await createAuthenticatedHandler(launchMogplexApiSandbox);
    delete process.env.INTERNAL_API_SECRET;
    const originalError = console.error;
    const diagnostics: unknown[][] = [];
    console.error = (...args: unknown[]) => diagnostics.push(args);
    try {
      const response = await handler(sandboxRequest({ repoId: REPO_ID }));
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.equal(payload.error.code, "SERVICE_UNAVAILABLE");
      assert.doesNotMatch(
        payload.error.message,
        /INTERNAL_API_SECRET|delegated|configured/i
      );
      assert.match(JSON.stringify(diagnostics), /INTERNAL_API_SECRET/);
    } finally {
      console.error = originalError;
    }
  });
});

test("a team developer can restart an owned repository's saved sandbox", async () => {
  await withInternalSecret(async (state) => {
    state.teamId = TEAM_ID;
    const fixture = await buildRestartingLauncher();
    const handler = await createAuthenticatedHandler(fixture.launchSandbox);
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    assert.equal(response.status, 202, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.data.sandbox.id, fixture.saved.id);
    assert.equal(payload.data.sandbox.status, "running");
    assert.deepEqual(fixture.providerCalls, [false, true]);
  });
});

for (const role of ["viewer", null] as const) {
  test(`v1 launch rejects a team ${role ?? "non-member"} before starting a VM`, async () => {
    await withInternalSecret(async (state) => {
      state.teamId = TEAM_ID;
      state.role = role;
      const { launchMogplexApiSandbox } =
        await import("../../app/api/v1/mogplex/sandboxes/route");
      const handler = await createAuthenticatedHandler(launchMogplexApiSandbox);
      const response = await handler(sandboxRequest({ repoId: REPO_ID }));
      assert.equal(response.status, 403, await response.clone().text());
      const payload = await response.json();
      assert.equal(payload.error.code, "FORBIDDEN");
      assert.match(payload.error.message, /tools\.bash/);
    });
  });
}

test("restart rechecks the real team capability after creation admission", async () => {
  await withInternalSecret(async (state) => {
    state.teamId = TEAM_ID;
    const fixture = await buildRestartingLauncher("user-123", () => {
      state.role = "viewer";
    });
    const handler = await createAuthenticatedHandler(fixture.launchSandbox);
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    assert.equal(response.status, 403, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.match(payload.error.message, /tools\.bash/);
    assert.deepEqual(fixture.providerCalls, []);
  });
});

test("v1 launch refuses a repository the caller does not own", async () => {
  await withInternalSecret(async (state) => {
    state.repoFound = false;
    const fixture = await buildRestartingLauncher();
    const handler = await createAuthenticatedHandler(fixture.launchSandbox);
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
    assert.deepEqual(fixture.providerCalls, []);
  });
});

test("a resume-required event returns the public CONFLICT code", async () => {
  await withInternalSecret(async () => {
    const { launchMogplexApiSandbox } =
      await import("../../app/api/v1/mogplex/sandboxes/route");
    const handler = await createAuthenticatedHandler((userId, body) =>
      launchMogplexApiSandbox(
        userId,
        body,
        async () =>
          new Response('data: {"type":"resume_required"}\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          })
      )
    );
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "CONFLICT");
  });
});

test("v1 launch fails closed when repository scope cannot be loaded", async () => {
  await withInternalSecret(async (state) => {
    state.repoLookupFails = true;
    const fixture = await buildRestartingLauncher();
    const handler = await createAuthenticatedHandler(fixture.launchSandbox);
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    assert.equal(response.status, 500);
    assert.deepEqual(fixture.providerCalls, []);
  });
});

test("a saved workspace recovery conflict returns the public reason and CONFLICT code", async () => {
  await withInternalSecret(async () => {
    const { launchMogplexApiSandbox } =
      await import("../../app/api/v1/mogplex/sandboxes/route");
    const { SavedWorkspaceUnavailableError } =
      await import("../../app/api/v1/mogplex/sandboxes/_lib/workspace-conflict");
    const handler = await createAuthenticatedHandler((userId, body) =>
      launchMogplexApiSandbox(userId, body, async () => {
        throw new SavedWorkspaceUnavailableError();
      })
    );
    const response = await handler(sandboxRequest({ repoId: REPO_ID }));
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "CONFLICT");
    assert.match(payload.error.message, /Saved workspace is unavailable/);
  });
});

test("legacy restart checks the saved team's real capability even without a team header", async () => {
  await withInternalSecret(async (state) => {
    state.teamId = TEAM_ID;
    state.role = "viewer";
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const { loadOwnedSandboxRouteRecord } =
      await import("../../lib/sandbox/route-context");
    const { buildInternalApiHeaders } =
      await import("../../lib/internal-api-auth");
    let providerCalls = 0;
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (request, id, options) =>
        loadOwnedSandboxRouteRecord(request, id, options, {
          loadOwnedSandboxRecord: async (_id, _userId, select) => ({
            ...buildPersistedPersistentRestartRecord({
              user_id: "user-123",
              persistent: false,
            }),
            ...(select.includes("product_team_id")
              ? { product_team_id: TEAM_ID }
              : {}),
          }),
        }),
      getSandbox: async () => {
        providerCalls++;
        throw new Error("Must not start a VM");
      },
      stopSandboxRecord: async () => ({ id: "saved" }) as never,
      fetchImpl: async () => Response.json({}),
    });
    const response = await handler(
      new Request("https://mogplex.internal/api/sandbox/saved/restart", {
        method: "POST",
        headers: buildInternalApiHeaders("user-123"),
      }),
      { params: Promise.resolve({ id: "saved" }) }
    );
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /tools\.bash/);
    assert.equal(providerCalls, 0);
  });
});
