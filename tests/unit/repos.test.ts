import assert from "node:assert/strict";
import test from "node:test";

async function loadReposModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/repos");
}

async function withPatchedFromThatFails<T>(callback: () => Promise<T>) {
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error(
        "supabaseAdmin.from should not be called for invalid UUIDs"
      );
    },
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

test("isRepoId accepts a canonical UUID", async () => {
  const { isRepoId } = await loadReposModule();
  assert.equal(isRepoId("1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"), true);
});

test("isRepoId rejects a GitHub full_name", async () => {
  const { isRepoId } = await loadReposModule();
  assert.equal(isRepoId("webrenew/bloom"), false);
});

test("isRepoId rejects empty and malformed strings", async () => {
  const { isRepoId } = await loadReposModule();
  assert.equal(isRepoId(""), false);
  assert.equal(isRepoId("not-a-uuid"), false);
  assert.equal(isRepoId("1b4f0e2a2c3d4e5f8a9b0c1d2e3f4a5b"), false);
});

test("getOwnedRepo returns null for a non-UUID repoId without hitting the database", async () => {
  const { getOwnedRepo } = await loadReposModule();

  await withPatchedFromThatFails(async () => {
    const result = await getOwnedRepo("webrenew/bloom", "user-123");
    assert.equal(result, null);
  });
});
