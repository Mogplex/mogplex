import assert from "node:assert/strict";
import test from "node:test";

async function loadApiKeysRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/settings/api-keys/route");
}

test("GET /api/settings/api-keys returns user keys without plaintext tokens", async () => {
  const { createApiKeysGetHandler } = await loadApiKeysRoute();

  const handler = createApiKeysGetHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({
      data: [
        {
          id: "key-1",
          name: "laptop CLI",
          token_prefix: "mog_ABCDEFGH",
          scopes: ["read"],
          created_at: "2024-01-01T00:00:00Z",
          last_used_at: "2024-01-02T00:00:00Z",
          expires_at: null,
          revoked_at: null,
        },
      ],
      error: null,
    }),
    createApiKey: async () => ({ data: null, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.keys.length, 1);
  assert.equal(payload.keys[0].name, "laptop CLI");
  assert.equal(payload.keys[0].prefix, "mog_ABCDEFGH");
  // Verify plaintext token is NOT returned
  assert.equal(payload.keys[0].token, undefined);
  assert.equal(payload.keys[0].token_hash, undefined);
});

test("GET /api/settings/api-keys returns 401 for unauthenticated requests", async () => {
  const { createApiKeysGetHandler } = await loadApiKeysRoute();
  const { NextResponse } = await import("next/server");

  const handler = createApiKeysGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async () => ({ data: null, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler();
  assert.equal(response.status, 401);
});

test("POST /api/settings/api-keys creates a new key and returns plaintext token", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();
  const createdKeys: Array<{
    userId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: string[];
    expiresAt: string | null;
  }> = [];

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async (input) => {
      createdKeys.push(input);
      return { data: { id: "new-key-id" }, error: null };
    },
    generateApiToken: () => ({
      token: "mog_TESTTOKENxxxxxxxxxxxxxxxxxxxxxxxx",
      hash: "abc123hash",
      prefix: "mog_TESTTOK",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test key" }),
    })
  );

  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.id, "new-key-id");
  assert.equal(payload.token, "mog_TESTTOKENxxxxxxxxxxxxxxxxxxxxxxxx");
  assert.equal(payload.prefix, "mog_TESTTOK");
  assert.equal(createdKeys.length, 1);
  assert.equal(createdKeys[0].name, "test key");
  assert.equal(createdKeys[0].tokenHash, "abc123hash");
  // Default when no `scopes` field is supplied: both read and write.
  // Backfill migration covers existing tokens; the API surface now hands new
  // tokens the same default so CI scripts work out of the box.
  assert.deepEqual(createdKeys[0].scopes, ["read", "write"]);
});

test("POST /api/settings/api-keys accepts an explicit scopes list", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();
  const captured: Array<{ scopes: string[] }> = [];

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async (input) => {
      captured.push({ scopes: input.scopes });
      return { data: { id: "new-key-id" }, error: null };
    },
    generateApiToken: () => ({ token: "mog_T", hash: "h", prefix: "mog_T" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "read-only", scopes: ["read"] }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured[0]?.scopes, ["read"]);
  const payload = await response.json();
  assert.deepEqual(payload.scopes, ["read"]);
});

test("POST /api/settings/api-keys dedupes repeated scopes", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();
  const captured: Array<{ scopes: string[] }> = [];

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async (input) => {
      captured.push({ scopes: input.scopes });
      return { data: { id: "new-key-id" }, error: null };
    },
    generateApiToken: () => ({ token: "mog_T", hash: "h", prefix: "mog_T" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "deduped",
        scopes: ["read", "read", "write", "write"],
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured[0]?.scopes, ["read", "write"]);
});

test("POST /api/settings/api-keys rejects an empty scopes array", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async () => ({ data: { id: "x" }, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "empty", scopes: [] }),
    })
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.ok(payload.error.includes("at least one"));
});

test("POST /api/settings/api-keys rejects an unknown scope", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async () => ({ data: { id: "x" }, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bad",
        scopes: ["read", "admin"],
      }),
    })
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Invalid scope value/);
  assert.match(payload.error, /read/);
  assert.match(payload.error, /write/);
  // Reflected user input is no longer echoed back into the error body.
  assert.ok(!payload.error.includes("admin"));
});

test("POST /api/settings/api-keys rejects non-array scopes", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async () => ({ data: { id: "x" }, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "wrong", scopes: "read" }),
    })
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.ok(payload.error.includes("array"));
});

test("POST /api/settings/api-keys rejects empty name", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async () => ({ data: { id: "new-key-id" }, error: null }),
    generateApiToken: () => ({ token: "", hash: "", prefix: "" }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    })
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.ok(payload.error.includes("Name is required"));
});

test("POST /api/settings/api-keys handles expiration days", async () => {
  const { createApiKeysPostHandler } = await loadApiKeysRoute();
  const createdKeys: Array<{
    userId: string;
    name: string;
    expiresAt: string | null;
  }> = [];

  const handler = createApiKeysPostHandler({
    requireUserId: async () => "user-123",
    listApiKeys: async () => ({ data: [], error: null }),
    createApiKey: async (input) => {
      createdKeys.push({
        userId: input.userId,
        name: input.name,
        expiresAt: input.expiresAt,
      });
      return { data: { id: "new-key-id" }, error: null };
    },
    generateApiToken: () => ({
      token: "mog_TEST",
      hash: "hash",
      prefix: "mog_TEST",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "expiring key", expiresInDays: 30 }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(createdKeys.length, 1);
  assert.ok(createdKeys[0].expiresAt !== null);

  // Verify expiration is roughly 30 days from now
  const expiresAt = new Date(createdKeys[0].expiresAt!);
  const now = new Date();
  const diffDays = Math.round(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  assert.ok(
    diffDays >= 29 && diffDays <= 31,
    `Expected ~30 days, got ${diffDays}`
  );
});
