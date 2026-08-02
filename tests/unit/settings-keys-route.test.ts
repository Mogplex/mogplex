import assert from "node:assert/strict";
import test from "node:test";

async function loadSettingsKeysRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/settings/keys/route");
}

async function loadSettingsKeysVerifyRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/settings/keys/verify/route");
}

test("PUT /api/settings/keys accepts ai_gateway as a valid provider", async () => {
  const { createSettingsKeysPutHandler } = await loadSettingsKeysRoute();
  const writes: Array<{ userId: string; provider: string; key: string }> = [];

  const handler = createSettingsKeysPutHandler({
    requireUserId: async () => "user-123",
    storeProviderKey: async (userId, provider, key) => {
      writes.push({ userId, provider, key });
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ai_gateway", key: "gateway-key-123" }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(writes, [
    {
      userId: "user-123",
      provider: "ai_gateway",
      key: "gateway-key-123",
    },
  ]);
});

test("PUT /api/settings/keys accepts openrouter as a valid provider", async () => {
  const { createSettingsKeysPutHandler } = await loadSettingsKeysRoute();
  const writes: Array<{ userId: string; provider: string; key: string }> = [];

  const handler = createSettingsKeysPutHandler({
    requireUserId: async () => "user-123",
    storeProviderKey: async (userId, provider, key) => {
      writes.push({ userId, provider, key });
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-test" }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(writes, [
    {
      userId: "user-123",
      provider: "openrouter",
      key: "sk-or-test",
    },
  ]);
});

test("POST /api/settings/keys/verify returns AI Gateway service metadata", async () => {
  const { createSettingsKeysVerifyPostHandler } =
    await loadSettingsKeysVerifyRoute();

  const handler = createSettingsKeysVerifyPostHandler({
    requireUserId: async () => "user-123",
    getProviderKey: async () => "gateway-key-123",
    verifyApiKey: async (provider, apiKey) => {
      assert.equal(provider, "ai_gateway");
      assert.equal(apiKey, "gateway-key-123");
      return { valid: true };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ai_gateway" }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    key_stored: true,
    key_valid: true,
    service: "Vercel AI Gateway",
  });
});

test("POST /api/settings/keys/verify returns OpenRouter service metadata", async () => {
  const { createSettingsKeysVerifyPostHandler } =
    await loadSettingsKeysVerifyRoute();

  const handler = createSettingsKeysVerifyPostHandler({
    requireUserId: async () => "user-123",
    getProviderKey: async () => "sk-or-test",
    verifyApiKey: async (provider, apiKey) => {
      assert.equal(provider, "openrouter");
      assert.equal(apiKey, "sk-or-test");
      return { valid: true };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openrouter" }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    key_stored: true,
    key_valid: true,
    service: "OpenRouter",
  });
});

test("verifyApiKey validates OpenRouter keys with the key metadata endpoint", async () => {
  const { verifyApiKey } = await loadSettingsKeysVerifyRoute();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    assert.deepEqual(await verifyApiKey("openrouter", "sk-or-test"), {
      valid: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://openrouter.ai/api/v1/auth/key");
    assert.equal(
      new Headers(calls[0].init?.headers).get("Authorization"),
      "Bearer sk-or-test"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyApiKey treats OpenRouter upstream 5xx as indeterminate", async () => {
  const { verifyApiKey } = await loadSettingsKeysVerifyRoute();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as typeof fetch;

  try {
    assert.deepEqual(await verifyApiKey("openrouter", "sk-or-test"), {
      valid: null,
      error: "OpenRouter is unavailable; try again",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyApiKey treats unexpected OpenRouter 4xx responses as indeterminate", async () => {
  const { verifyApiKey } = await loadSettingsKeysVerifyRoute();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as typeof fetch;

  try {
    assert.deepEqual(await verifyApiKey("openrouter", "sk-or-test"), {
      valid: null,
      error: "OpenRouter verification failed (404); try again",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyApiKey treats OpenRouter network errors as indeterminate", async () => {
  const { verifyApiKey } = await loadSettingsKeysVerifyRoute();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    assert.deepEqual(await verifyApiKey("openrouter", "sk-or-test"), {
      valid: null,
      error: "OpenRouter is unavailable; try again",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyApiKey treats unexpected OpenRouter verification errors as indeterminate", async () => {
  const { verifyApiKey } = await loadSettingsKeysVerifyRoute();
  const originalFetch = globalThis.fetch;
  const response = {
    get status() {
      throw new Error("status unavailable");
    },
  } as unknown as Response;

  globalThis.fetch = (async () => response) as typeof fetch;

  try {
    assert.deepEqual(await verifyApiKey("openrouter", "sk-or-test"), {
      valid: null,
      error: "OpenRouter is unavailable; try again",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
