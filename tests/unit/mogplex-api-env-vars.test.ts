import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

async function loadEnvVarsModules() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
  const [lib, route] = await Promise.all([
    import("../../lib/mogplex-api/env-vars"),
    import("../../app/api/v1/mogplex/repos/[repoId]/env-vars/route"),
  ]);
  return { lib, route };
}

const repoWithPersonalEnvSync = {
  id: "repo-1",
  env_sync_mode: "vercel-project",
  vercel_team_id: "team-acme",
  vercel_project_id: "repo-project",
  sandbox_billing_mode_override: null,
  workspace: null,
};

const personalCredentials = {
  userVercelToken: "user-token",
  userVercelTeamId: null,
  accountDefaultVercelProjectId: null,
  accountDefaultVercelTeamId: null,
};

const platformCredentials = {
  vercelToken: "platform-token",
  vercelTeamId: "platform-team",
  vercelProjectId: "platform-project",
};

function baseLibDeps() {
  return {
    loadRepoWithVercel: async () => repoWithPersonalEnvSync,
    loadUserVercelCredentials: async () => personalCredentials,
    getPlatformSandboxCredentials: () => platformCredentials,
  };
}

test("listMogplexApiRepoEnvVars returns metadata without values", async () => {
  const { lib } = await loadEnvVarsModules();
  const listCalls: Array<Record<string, unknown>> = [];

  const result = await lib.listMogplexApiRepoEnvVars("user-123", "repo-1", {
    ...baseLibDeps(),
    listVercelProjectEnvVars: async (input) => {
      listCalls.push(input as Record<string, unknown>);
      return {
        ok: true as const,
        data: [
          {
            id: "env_1",
            key: "DATABASE_URL",
            value: "postgres://should-never-leak",
            target: ["production"],
            type: "encrypted" as const,
            updatedAt: 1_700_000_000_000,
          },
        ],
      };
    },
  });

  assert.equal(listCalls[0]?.decrypt, false);
  assert.ok(result.ok);
  assert.deepEqual(result.data.envVars, [
    {
      id: "env_1",
      key: "DATABASE_URL",
      target: ["production"],
      type: "encrypted",
      updatedAt: 1_700_000_000_000,
    },
  ]);
});

test("upsertMogplexApiRepoEnvVar creates when the key is new", async () => {
  const { lib } = await loadEnvVarsModules();
  const upsertCalls: Array<Record<string, unknown>> = [];

  const result = await lib.upsertMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "NEW_KEY", value: "v1", target: ["production"] },
    {
      ...baseLibDeps(),
      listVercelProjectEnvVars: async () => ({ ok: true as const, data: [] }),
      upsertVercelProjectEnvVar: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return {
          ok: true as const,
          data: { id: "env_new", key: "NEW_KEY" },
        };
      },
    }
  );

  assert.ok(result.ok);
  assert.deepEqual(result.data, {
    action: "created",
    key: "NEW_KEY",
    updatedCount: 1,
  });
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0]?.envId, undefined);
  assert.equal(upsertCalls[0]?.key, "NEW_KEY");
});

test("upsertMogplexApiRepoEnvVar updates every existing entry with the key", async () => {
  const { lib } = await loadEnvVarsModules();
  const upsertCalls: Array<Record<string, unknown>> = [];

  const result = await lib.upsertMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "API_KEY", value: "v2" },
    {
      ...baseLibDeps(),
      listVercelProjectEnvVars: async () => ({
        ok: true as const,
        data: [
          { id: "env_prod", key: "API_KEY", target: ["production"] },
          { id: "env_dev", key: "API_KEY", target: ["development"] },
          { id: "env_other", key: "OTHER_KEY", target: ["production"] },
        ],
      }),
      upsertVercelProjectEnvVar: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return {
          ok: true as const,
          data: { id: String(input.envId), key: "API_KEY" },
        };
      },
    }
  );

  assert.ok(result.ok);
  assert.deepEqual(result.data, {
    action: "updated",
    key: "API_KEY",
    updatedCount: 2,
  });
  assert.deepEqual(
    upsertCalls.map((call) => call.envId),
    ["env_prod", "env_dev"]
  );
});

test("upsertMogplexApiRepoEnvVar rejects explicit targets when the key has multiple entries", async () => {
  const { lib } = await loadEnvVarsModules();
  const upsertCalls: unknown[] = [];

  const result = await lib.upsertMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "API_KEY", value: "v2", target: ["production"] },
    {
      ...baseLibDeps(),
      listVercelProjectEnvVars: async () => ({
        ok: true as const,
        data: [
          { id: "env_prod", key: "API_KEY", target: ["production"] },
          { id: "env_dev", key: "API_KEY", target: ["development"] },
        ],
      }),
      upsertVercelProjectEnvVar: async (input) => {
        upsertCalls.push(input);
        return { ok: true as const, data: { id: "env_prod", key: "API_KEY" } };
      },
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFLICT");
    assert.equal(result.error.status, 409);
  }
  assert.equal(upsertCalls.length, 0);
});

test("upsertMogplexApiRepoEnvVar reports partial progress when an update fails mid-loop", async () => {
  const { lib } = await loadEnvVarsModules();
  let calls = 0;

  const result = await lib.upsertMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "API_KEY", value: "v2" },
    {
      ...baseLibDeps(),
      listVercelProjectEnvVars: async () => ({
        ok: true as const,
        data: [
          { id: "env_prod", key: "API_KEY", target: ["production"] },
          { id: "env_dev", key: "API_KEY", target: ["development"] },
        ],
      }),
      upsertVercelProjectEnvVar: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true as const,
            data: { id: "env_prod", key: "API_KEY" },
          };
        }
        return {
          ok: false as const,
          error: {
            code: "RATE_LIMITED" as const,
            message: "slow down",
            status: 429,
          },
        };
      },
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "RATE_LIMITED");
    assert.match(result.error.message, /Updated 1 of 2 entries/);
  }
});

test("deleteMogplexApiRepoEnvVar deletes matches and 404s on unknown keys", async () => {
  const { lib } = await loadEnvVarsModules();
  const deletedIds: string[] = [];
  const deps = {
    ...baseLibDeps(),
    listVercelProjectEnvVars: async () => ({
      ok: true as const,
      data: [
        { id: "env_1", key: "API_KEY", target: ["production"] },
        { id: "env_2", key: "API_KEY", target: ["preview"] },
      ],
    }),
    deleteVercelProjectEnvVar: async (input: { envId: string }) => {
      deletedIds.push(input.envId);
      return { ok: true as const, data: { ok: true as const } };
    },
  };

  const deleted = await lib.deleteMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "API_KEY" },
    deps
  );
  assert.ok(deleted.ok);
  assert.deepEqual(deleted.data, { key: "API_KEY", deletedCount: 2 });
  assert.deepEqual(deletedIds, ["env_1", "env_2"]);

  const missing = await lib.deleteMogplexApiRepoEnvVar(
    "user-123",
    "repo-1",
    { key: "MISSING" },
    deps
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.code, "NOT_FOUND");
    assert.equal(missing.error.status, 404);
  }
});

test("env vars lib maps repos without a linked Vercel project to BAD_REQUEST", async () => {
  const { lib } = await loadEnvVarsModules();

  const result = await lib.listMogplexApiRepoEnvVars("user-123", "repo-1", {
    ...baseLibDeps(),
    loadRepoWithVercel: async () => ({
      ...repoWithPersonalEnvSync,
      env_sync_mode: "vercel-project",
      vercel_project_id: null,
    }),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "BAD_REQUEST");
    assert.equal(result.error.status, 400);
  }
});

test("GET /api/v1/mogplex/repos/[repoId]/env-vars returns 500 when the repo query fails", async () => {
  const { route } = await loadEnvVarsModules();
  const handler = route.createMogplexApiRepoEnvVarsGetHandler({
    resolveApiKey: async () => ({
      ok: true as const,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listEnvVars: async () => {
      throw new Error("Failed to load repo repo-1: connection refused");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("GET /api/v1/mogplex/repos/[repoId]/env-vars requires the read scope", async () => {
  const { route } = await loadEnvVarsModules();
  const handler = route.createMogplexApiRepoEnvVarsGetHandler({
    resolveApiKey: async () => ({
      ok: true as const,
      auth: { userId: "user-123", keyId: "key-1", scopes: [] },
    }),
    listEnvVars: async () => {
      throw new Error("should not list without the read scope");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );

  assert.equal(response.status, 403);
});

test("POST /api/v1/mogplex/repos/[repoId]/env-vars validates and upserts with the write scope", async () => {
  const { route } = await loadEnvVarsModules();
  const upsertCalls: Array<{ userId: string; repoId: string; input: unknown }> =
    [];
  const handler = route.createMogplexApiRepoEnvVarsPostHandler({
    resolveApiKey: async () => ({
      ok: true as const,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read", "write"] },
    }),
    upsertEnvVar: async (userId, repoId, input) => {
      upsertCalls.push({ userId, repoId, input });
      return {
        ok: true as const,
        data: { action: "created" as const, key: input.key, updatedCount: 1 },
      };
    },
  });

  const invalid = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({ key: "1BAD-KEY", value: "x" }),
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );
  assert.equal(invalid.status, 400);
  assert.equal(upsertCalls.length, 0);

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({
        key: "API_KEY",
        value: "secret",
        target: ["production"],
      }),
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { action: "created", key: "API_KEY", updatedCount: 1 },
  });
  assert.deepEqual(upsertCalls, [
    {
      userId: "user-123",
      repoId: "repo-1",
      input: { key: "API_KEY", value: "secret", target: ["production"] },
    },
  ]);
});

test("DELETE /api/v1/mogplex/repos/[repoId]/env-vars requires the write scope", async () => {
  const { route } = await loadEnvVarsModules();
  const handler = route.createMogplexApiRepoEnvVarsDeleteHandler({
    resolveApiKey: async () => ({
      ok: true as const,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    deleteEnvVar: async () => {
      throw new Error("should not delete without the write scope");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      method: "DELETE",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({ key: "API_KEY" }),
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );

  assert.equal(response.status, 403);
});
