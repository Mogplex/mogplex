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

// All storage behavior is exercised against Postgres in tests/db/mogplex-project-env.test.ts.
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
    // Personal work: no team holds this key to automations.
    loadTeamKeyAccess: async () => null,
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
      input: { key: "API_KEY", value: "secret" },
    },
  ]);
});

test("DELETE /api/v1/mogplex/repos/[repoId]/env-vars requires the write scope", async () => {
  const { route } = await loadEnvVarsModules();
  const handler = route.createMogplexApiRepoEnvVarsDeleteHandler({
    // Personal work: no team holds this key to automations.
    loadTeamKeyAccess: async () => null,
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

test("POST rejects a read-only token before writing variables", async () => {
  const { route } = await loadEnvVarsModules();
  const handler = route.createMogplexApiRepoEnvVarsPostHandler({
    // Personal work: no team holds this key to automations.
    loadTeamKeyAccess: async () => null,
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    upsertEnvVar: async () => {
      throw new Error("must not write");
    },
  });
  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos/repo-1/env-vars", {
      method: "POST",
      headers: { authorization: "Bearer mog_read" },
      body: JSON.stringify({ key: "KEY", value: "secret" }),
    }),
    { params: Promise.resolve({ repoId: "repo-1" }) }
  );
  assert.equal(response.status, 403);
});
