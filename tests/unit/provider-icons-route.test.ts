import assert from "node:assert/strict";
import test from "node:test";

async function loadProviderIconsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/models/provider-icons/route");
}

test("GET /api/models/provider-icons returns the stored provider manifest", async () => {
  const { createProviderIconsGetHandler } = await loadProviderIconsRoute();
  const handler = createProviderIconsGetHandler({
    getUserId: async () => "profile-1",
    listStoredProviders: async () => [
      { provider: "anthropic", updatedAt: null },
      { provider: "openai", updatedAt: null },
    ],
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    providers: ["anthropic", "openai"],
  });
  assert.match(response.headers.get("cache-control") ?? "", /private/);
});

test("GET /api/models/provider-icons fails closed to initial fallbacks", async () => {
  const { createProviderIconsGetHandler } = await loadProviderIconsRoute();
  const handler = createProviderIconsGetHandler({
    getUserId: async () => "profile-1",
    listStoredProviders: async () => {
      throw new Error("storage unavailable");
    },
  });

  const response = await handler();

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Failed to load provider icons",
  });
});

test("GET /api/models/provider-icons rejects unauthenticated requests before storage access", async () => {
  const { createProviderIconsGetHandler } = await loadProviderIconsRoute();
  let storageCalls = 0;
  const handler = createProviderIconsGetHandler({
    getUserId: async () => undefined,
    listStoredProviders: async () => {
      storageCalls += 1;
      return [];
    },
  });

  const response = await handler();

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(storageCalls, 0);
});
