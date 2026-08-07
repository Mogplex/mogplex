import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  loadSandboxRouteModule,
} from "./helpers/sandbox-route-fixtures";

test("GET /api/sandbox reconciles stale sandboxes and returns normalized summaries", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  const stoppedIds: string[] = [];

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    listSandboxesForUser: async () =>
      [
        {
          id: "sandbox-stale",
          sandbox_id: "vm_stale",
          repo_id: "repo-1",
          user_id: "user-123",
          status: "running",
          preview_url: null,
          runtime: "node22",
          health_status: "running",
          error: null,
          last_preview_http_status: null,
          last_preview_error: null,
          last_boot_error: null,
          boot_attempts: 1,
          last_boot_started_at: "2026-04-01T10:00:00.000Z",
          last_boot_completed_at: "2026-04-01T10:01:00.000Z",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          billing_source: "platform",
          billing_team_id: null,
          billing_project_id: "platform-project",
          vercel_team_id: null,
          vercel_project_id: "platform-project",
        },
        {
          id: "sandbox-live",
          sandbox_id: "vm_live",
          repo_id: "repo-2",
          user_id: "user-123",
          status: "running",
          preview_url: "https://preview.example.com",
          runtime: "node22",
          health_status: "running",
          error: null,
          last_preview_http_status: 200,
          last_preview_error: null,
          last_boot_error: null,
          boot_attempts: 2,
          last_boot_started_at: "2026-04-01T10:00:00.000Z",
          last_boot_completed_at: "2026-04-01T10:01:00.000Z",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          billing_source: "user_vercel_project",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
        },
      ] as never,
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(["sandbox-stale"]),
      skippedIds: new Set(["sandbox-skipped"]),
    }),
    stopSandboxRecord: async (id) => {
      stoppedIds.push(id);
      return null;
    },
  });

  const response = await handler(buildSandboxCollectionRequest());
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(stoppedIds, ["sandbox-stale"]);
  assert.equal(payload.sandboxes[0].runtime_summary.status, "stopped");
  assert.equal(
    payload.sandboxes[1].billing_summary.label,
    "Your Vercel project"
  );
  assert.equal("status" in payload.sandboxes[0], false);
  assert.equal("preview_url" in payload.sandboxes[1], false);
});

test("GET /api/sandbox validates and filters by active team", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  const listCalls: Array<{ userId: string; productTeamId: string | null }> = [];
  const credentialTeamIds: Array<string | null | undefined> = [];
  const accessScopes: Array<[string, string | null | undefined]> = [];

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async (_request, options) => {
      credentialTeamIds.push(options?.teamId);
      return buildSandboxServiceRouteAuth();
    },
    loadUserPlatformAccess: async (userId, productTeamId) => {
      accessScopes.push([userId, productTeamId]);
      return { allowPlatformAi: true, allowPlatformSandbox: true };
    },
    resolveActiveTeamCapabilities: async (userId, teamId) => {
      assert.equal(userId, "user-123");
      assert.equal(teamId, "00000000-0000-4000-8000-000000123456");
      return { ok: true, teamId, capabilities: new Set(["*"]) };
    },
    listSandboxesForUser: async (userId, productTeamId) => {
      listCalls.push({ userId, productTeamId });
      return [];
    },
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      init: {
        headers: {
          "x-mogplex-team-id": "00000000-0000-4000-8000-000000123456",
        },
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sandboxes: [] });
  assert.deepEqual(credentialTeamIds, [undefined]);
  assert.deepEqual(accessScopes, [
    ["user-123", "00000000-0000-4000-8000-000000123456"],
  ]);
  assert.deepEqual(listCalls, [
    {
      userId: "user-123",
      productTeamId: "00000000-0000-4000-8000-000000123456",
    },
  ]);
});

test("GET /api/sandbox rejects a foreign team before loading team billing access", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  let accessLookups = 0;
  let listCalls = 0;

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadUserPlatformAccess: async () => {
      accessLookups += 1;
      return { allowPlatformAi: true, allowPlatformSandbox: true };
    },
    resolveActiveTeamCapabilities: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
    listSandboxesForUser: async () => {
      listCalls += 1;
      return [];
    },
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      init: {
        headers: {
          "x-mogplex-team-id": "00000000-0000-4000-8000-000000123456",
        },
      },
    })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(accessLookups, 0);
  assert.equal(listCalls, 0);
});

test("GET /api/sandbox?format=cli returns a flat CLI-shaped array and hides historical records", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    listSandboxesForUser: async () =>
      [
        {
          id: "sandbox-1",
          sandbox_id: "vm_1",
          repo_id: "repo-1",
          user_id: "user-123",
          working_branch: "feat/x",
          status: "running",
          preview_url: "https://preview.example.com",
          runtime: "node22",
          health_status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          repos: {
            full_name: "webrenew/acme",
            sandbox_timeout_ms: null,
            workspaces: { name: "Default", sandbox_timeout_ms: null },
          },
        },
        {
          id: "sandbox-2",
          sandbox_id: "pending",
          repo_id: "repo-2",
          user_id: "user-123",
          working_branch: null,
          status: "creating",
          preview_url: null,
          runtime: "node22",
          health_status: "creating",
          created_at: "2026-04-02T10:00:00.000Z",
          last_active_at: "2026-04-02T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-3",
          sandbox_id: "vm_3",
          repo_id: "repo-3",
          user_id: "user-123",
          working_branch: "feat/paused",
          status: "paused",
          preview_url: null,
          runtime: "node22",
          health_status: "paused",
          created_at: "2026-04-03T10:00:00.000Z",
          last_active_at: "2026-04-03T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-4",
          sandbox_id: "vm_4",
          repo_id: "repo-4",
          user_id: "user-123",
          working_branch: null,
          status: "stopped",
          preview_url: null,
          runtime: "node22",
          health_status: "stopped",
          created_at: "2026-04-04T10:00:00.000Z",
          last_active_at: "2026-04-04T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-5",
          sandbox_id: "vm_5",
          repo_id: "repo-5",
          user_id: "user-123",
          working_branch: null,
          status: "error",
          preview_url: null,
          runtime: "node22",
          health_status: "error",
          created_at: "2026-04-05T10:00:00.000Z",
          last_active_at: "2026-04-05T10:01:00.000Z",
          repos: null,
        },
      ] as never,
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox?format=cli")
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.ok(Array.isArray(payload), "payload should be a bare array");
  // running + creating + paused visible; stopped and error filtered out.
  assert.equal(payload.length, 3);
  const visibleIds = payload.map((p: { id: string }) => p.id);
  assert.deepEqual(visibleIds.sort(), ["sandbox-1", "sandbox-2", "sandbox-3"]);
  assert.deepEqual(payload[0], {
    id: "sandbox-1",
    sandboxId: "vm_1",
    repo: "webrenew/acme",
    workspace: "Default",
    branch: "feat/x",
    status: "running",
    createdAt: "2026-04-01T10:00:00.000Z",
    url: "https://preview.example.com",
  });
  assert.equal(payload[1].sandboxId, null, "pending sandbox_id normalized");
  assert.equal(payload[1].repo, null);
  assert.equal(payload[1].workspace, null);
  assert.equal(payload[1].branch, null);
  assert.equal(payload[2].status, "paused");
});
