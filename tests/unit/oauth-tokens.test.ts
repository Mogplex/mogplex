import assert from "node:assert/strict";
import test from "node:test";

async function loadOAuthTokenStore() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/oauth-tokens");
}

test("getOAuthToken returns a stored vault token without touching legacy profile tokens", async () => {
  const { createOAuthTokenStore } = await loadOAuthTokenStore();
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let legacyLoads = 0;

  const store = createOAuthTokenStore({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === "get_oauth_token") {
        return { data: "vault-token", error: null };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    },
    loadLegacyTokens: async () => {
      legacyLoads += 1;
      return { github: "legacy-token", vercel: null };
    },
    clearLegacyToken: async () => {
      throw new Error("clearLegacyToken should not be called");
    },
  });

  const token = await store.getOAuthToken("user-123", "github");

  assert.equal(token, "vault-token");
  assert.equal(legacyLoads, 0);
  assert.deepEqual(rpcCalls, [
    {
      fn: "get_oauth_token",
      args: { p_user_id: "user-123", p_provider: "github" },
    },
  ]);
});

test("getOAuthToken migrates a legacy profile token into vault-backed storage", async () => {
  const { createOAuthTokenStore } = await loadOAuthTokenStore();
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const cleared: Array<{ userId: string; provider: string }> = [];

  const store = createOAuthTokenStore({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === "get_oauth_token") {
        return { data: null, error: null };
      }
      if (fn === "store_oauth_token") {
        return { data: null, error: null };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    },
    loadLegacyTokens: async () => ({
      github: "legacy-github-token",
      vercel: null,
    }),
    clearLegacyToken: async (userId, provider) => {
      cleared.push({ userId, provider });
    },
  });

  const token = await store.getOAuthToken("user-123", "github");

  assert.equal(token, "legacy-github-token");
  assert.deepEqual(rpcCalls, [
    {
      fn: "get_oauth_token",
      args: { p_user_id: "user-123", p_provider: "github" },
    },
    {
      fn: "store_oauth_token",
      args: {
        p_user_id: "user-123",
        p_provider: "github",
        p_token: "legacy-github-token",
      },
    },
  ]);
  assert.deepEqual(cleared, [{ userId: "user-123", provider: "github" }]);
});

test("hasOAuthToken falls back to legacy profile columns when vault storage is empty", async () => {
  const { createOAuthTokenStore } = await loadOAuthTokenStore();
  const store = createOAuthTokenStore({
    rpc: async (fn) => {
      if (fn !== "has_oauth_token") {
        throw new Error(`Unexpected rpc ${fn}`);
      }
      return { data: false, error: null };
    },
    loadLegacyTokens: async () => ({
      github: null,
      vercel: "legacy-vercel-token",
    }),
    clearLegacyToken: async () => {
      throw new Error("clearLegacyToken should not be called");
    },
  });

  const hasToken = await store.hasOAuthToken("user-123", "vercel");

  assert.equal(hasToken, true);
});

test("deleteOAuthToken removes vault-backed storage and clears any legacy profile token", async () => {
  const { createOAuthTokenStore } = await loadOAuthTokenStore();
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const cleared: Array<{ userId: string; provider: string }> = [];

  const store = createOAuthTokenStore({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn !== "delete_oauth_token") {
        throw new Error(`Unexpected rpc ${fn}`);
      }
      return { data: null, error: null };
    },
    loadLegacyTokens: async () => ({ github: null, vercel: null }),
    clearLegacyToken: async (userId, provider) => {
      cleared.push({ userId, provider });
    },
  });

  await store.deleteOAuthToken("user-123", "github");

  assert.deepEqual(rpcCalls, [
    {
      fn: "delete_oauth_token",
      args: { p_user_id: "user-123", p_provider: "github" },
    },
  ]);
  assert.deepEqual(cleared, [{ userId: "user-123", provider: "github" }]);
});
