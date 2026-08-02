import assert from "node:assert/strict";
import test from "node:test";

// scopes.ts transitively imports `lib/supabase/admin.ts` (via response.ts ->
// api-key.ts), which throws at module init if Supabase env vars are missing.
// Stub them before the dynamic import — matches the loadRunsRoute pattern.
async function loadScopes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/mogplex-api/scopes");
}

test("isMogplexApiScope accepts the known scopes", async () => {
  const { isMogplexApiScope, MOGPLEX_API_SCOPES } = await loadScopes();
  for (const scope of MOGPLEX_API_SCOPES) {
    assert.equal(isMogplexApiScope(scope), true);
  }
});

test("isMogplexApiScope rejects unknown strings and non-strings", async () => {
  const { isMogplexApiScope } = await loadScopes();
  for (const value of ["admin", "ADMIN", "", null, undefined, 123, {}, []]) {
    assert.equal(isMogplexApiScope(value), false);
  }
});

test("requireScope returns null when the user has the scope", async () => {
  const { requireScope } = await loadScopes();
  assert.equal(requireScope({ scopes: ["read", "write"] }, "write"), null);
  assert.equal(requireScope({ scopes: ["write"] }, "write"), null);
  assert.equal(requireScope({ scopes: ["read"] }, "read"), null);
});

test("requireScope returns a 403 NextResponse when the scope is missing", async () => {
  const { requireScope } = await loadScopes();
  const response = requireScope({ scopes: ["read"] }, "write");
  assert.notEqual(response, null);
  // Narrow the union from `NextResponse | null`.
  if (!response) throw new Error("expected non-null response");
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "FORBIDDEN");
  assert.ok(payload.error.message.includes("write"));
});

test("requireScope handles users with no scopes at all", async () => {
  const { requireScope } = await loadScopes();
  const response = requireScope({ scopes: [] }, "read");
  if (!response) throw new Error("expected non-null response");
  assert.equal(response.status, 403);
});
