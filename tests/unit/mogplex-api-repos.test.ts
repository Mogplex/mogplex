import assert from "node:assert/strict";
import test from "node:test";

async function loadRepos() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/mogplex-api/repos");
}

test("listMogplexApiRepos short-circuits non-UUID id selectors to an empty list", async () => {
  const { listMogplexApiRepos } = await loadRepos();
  // A non-UUID id can never match a repo; it must return [] without hitting
  // Postgres, where the uuid cast would fail and surface as a 500.
  const repos = await listMogplexApiRepos("user-123", {
    id: "owner-name-typed-without-a-slash",
  });
  assert.deepEqual(repos, []);
});
