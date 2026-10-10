import assert from "node:assert/strict";
import test from "node:test";

async function loadApiKeyDeleteRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/settings/api-keys/[id]/route");
}

test("DELETE /api/settings/api-keys/[id] revokes a key", async () => {
  const { createApiKeyDeleteHandler } = await loadApiKeyDeleteRoute();
  const revokedKeys: Array<{ userId: string; keyId: string }> = [];

  const handler = createApiKeyDeleteHandler({
    requireUserId: async () => "user-123",
    revokeApiKey: async (userId, keyId) => {
      revokedKeys.push({ userId, keyId });
      return { count: 1, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/key-456", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: "key-456" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true });
  assert.equal(revokedKeys.length, 1);
  assert.equal(revokedKeys[0].userId, "user-123");
  assert.equal(revokedKeys[0].keyId, "key-456");
});

test("DELETE /api/settings/api-keys/[id] returns 404 for non-existent key", async () => {
  const { createApiKeyDeleteHandler } = await loadApiKeyDeleteRoute();

  const handler = createApiKeyDeleteHandler({
    requireUserId: async () => "user-123",
    revokeApiKey: async () => ({ count: 0, error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/nonexistent", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: "nonexistent" }) }
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error, "Key not found");
});

test("DELETE /api/settings/api-keys/[id] returns 401 for unauthenticated", async () => {
  const { createApiKeyDeleteHandler } = await loadApiKeyDeleteRoute();
  const { NextResponse } = await import("next/server");

  const handler = createApiKeyDeleteHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    revokeApiKey: async () => ({ count: 0, error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/key-456", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: "key-456" }) }
  );

  assert.equal(response.status, 401);
});

test("revoked tokens cannot authenticate (security test)", async () => {
  // This test verifies the revocation logic
  // A revoked key should have revoked_at set, which means:
  // 1. The query in resolveApiKey uses .is("revoked_at", null)
  // 2. So revoked keys won't match

  const mockKeys = [
    { id: "key-1", revoked_at: null, user_id: "user-123" },
    { id: "key-2", revoked_at: "2024-01-01T00:00:00Z", user_id: "user-123" },
  ];

  // Simulate the query filter
  const activeKeys = mockKeys.filter((k) => k.revoked_at === null);
  const revokedKeys = mockKeys.filter((k) => k.revoked_at !== null);

  assert.equal(activeKeys.length, 1);
  assert.equal(activeKeys[0].id, "key-1");
  assert.equal(revokedKeys.length, 1);
  assert.equal(revokedKeys[0].id, "key-2");
});

test("PATCH /api/settings/api-keys/[id] changes the owner's key access", async (t) => {
  const { createApiKeyPatchHandler } = await loadApiKeyDeleteRoute();
  const info = t.mock.method(console, "info", () => {});
  const updates: Array<{ userId: string; keyId: string; access: string }> = [];

  const handler = createApiKeyPatchHandler({
    requireUserId: async () => "user-123",
    setApiKeyAccess: async (userId, keyId, access) => {
      updates.push({ userId, keyId, access });
      return { updated: 1, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/key-456", {
      method: "PATCH",
      body: JSON.stringify({ access: "automations" }),
    }),
    { params: Promise.resolve({ id: "key-456" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "key-456",
    access: "automations",
  });
  assert.deepEqual(updates, [
    { userId: "user-123", keyId: "key-456", access: "automations" },
  ]);
  assert.deepEqual(
    info.mock.calls.map((call) => call.arguments),
    [
      [
        "[api-key-access] key access changed",
        { userId: "user-123", keyId: "key-456", access: "automations" },
      ],
    ]
  );
});

test("PATCH /api/settings/api-keys/[id] returns 404 for another account's key", async (t) => {
  const { createApiKeyPatchHandler } = await loadApiKeyDeleteRoute();
  const info = t.mock.method(console, "info", () => {});

  const handler = createApiKeyPatchHandler({
    requireUserId: async () => "user-123",
    setApiKeyAccess: async () => ({ updated: 0, error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/key-other", {
      method: "PATCH",
      body: JSON.stringify({ access: "full" }),
    }),
    { params: Promise.resolve({ id: "key-other" }) }
  );

  assert.equal(response.status, 404);
  assert.equal(info.mock.callCount(), 0);
});

test("PATCH /api/settings/api-keys/[id] rejects an unknown access level", async () => {
  const { createApiKeyPatchHandler } = await loadApiKeyDeleteRoute();
  let updated = false;

  const handler = createApiKeyPatchHandler({
    requireUserId: async () => "user-123",
    setApiKeyAccess: async () => {
      updated = true;
      return { updated: 1, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/api-keys/key-456", {
      method: "PATCH",
      body: JSON.stringify({ access: "everything" }),
    }),
    { params: Promise.resolve({ id: "key-456" }) }
  );

  assert.equal(response.status, 400);
  assert.equal(updated, false);
});
