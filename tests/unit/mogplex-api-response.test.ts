import assert from "node:assert/strict";
import test from "node:test";

// response.ts imports lib/auth/api-key.ts -> lib/supabase/admin.ts, which
// throws at module init when Supabase env vars are missing. Stub them
// before the dynamic import. Matches the loadScopes / loadRunsRoute pattern.
async function loadResponse() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/mogplex-api/response");
}

function bearerRequest(token = "mog_valid") {
  return new Request("http://localhost/api/v1/mogplex/runs", {
    headers: { authorization: `Bearer ${token}` },
  });
}

test("resolveMogplexApiUser returns 401 for requests without a Bearer token", async () => {
  const { resolveMogplexApiUser } = await loadResponse();
  const request = new Request("http://localhost/api/v1/mogplex/runs");
  const result = await resolveMogplexApiUser(request, {
    resolveApiKey: async () => {
      throw new Error("resolveApiKey should not run without a Bearer header");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected ok: false");
  assert.equal(result.response.status, 401);
  const payload = await result.response.json();
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("resolveMogplexApiUser returns 401 when the token is invalid", async () => {
  const { resolveMogplexApiUser } = await loadResponse();
  const result = await resolveMogplexApiUser(bearerRequest(), {
    resolveApiKey: async () => ({ ok: false, reason: "invalid" }),
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected ok: false");
  assert.equal(result.response.status, 401);
  const payload = await result.response.json();
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("resolveMogplexApiUser returns 429 RATE_LIMITED with Retry-After when rate_limited", async () => {
  const { resolveMogplexApiUser } = await loadResponse();
  const result = await resolveMogplexApiUser(bearerRequest(), {
    resolveApiKey: async () => ({ ok: false, reason: "rate_limited" }),
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected ok: false");
  assert.equal(result.response.status, 429);
  // Retry-After advertises the rate-limit window so clients can back off
  // honestly instead of guessing at an exponential schedule.
  const retryAfter = result.response.headers.get("Retry-After");
  assert.equal(retryAfter, "60");
  const payload = await result.response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "RATE_LIMITED");
  assert.match(payload.error.message, /Rate limit/);
});

test("resolveMogplexApiUser returns the resolved user when the token is valid", async () => {
  const { resolveMogplexApiUser } = await loadResponse();
  const result = await resolveMogplexApiUser(bearerRequest(), {
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok: true");
  assert.equal(result.userId, "user-123");
  assert.equal(result.keyId, "key-1");
  assert.deepEqual(result.scopes, ["read", "write"]);
});

test("resolveMogplexApiUser accepts a resource-bound OAuth access token", async () => {
  const { resolveMogplexApiUser } = await loadResponse();
  const result = await resolveMogplexApiUser(bearerRequest("oauth.jwt.token"), {
    resolveApiKey: async () => {
      throw new Error("PAT resolver should not run for OAuth tokens");
    },
    resolveOAuthToken: async (authorization) => {
      assert.equal(authorization, "Bearer oauth.jwt.token");
      return {
        ok: true,
        auth: {
          userId: "profile-123",
          keyId: "oauth-client-1",
          scopes: ["read", "write"],
        },
      };
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok: true");
  assert.equal(result.userId, "profile-123");
  assert.equal(result.keyId, "oauth-client-1");
  assert.deepEqual(result.scopes, ["read", "write"]);
});
