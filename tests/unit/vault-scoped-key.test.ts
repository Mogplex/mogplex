import assert from "node:assert/strict";
import test from "node:test";

async function loadVaultModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vault");
}

test("getScopedProviderKey prefers the team key when the user is a verified member", async () => {
  const { createGetScopedProviderKey } = await loadVaultModule();
  let teamKeyCalls = 0;
  let personalKeyCalls = 0;
  const resolve = createGetScopedProviderKey({
    isTeamMember: async () => true,
    getTeamProviderKey: async () => {
      teamKeyCalls += 1;
      return "team-shared-key";
    },
    getPersonalProviderKey: async () => {
      personalKeyCalls += 1;
      return "personal-key";
    },
  });
  const key = await resolve("user-1", "openai", "team-1");
  assert.equal(key, "team-shared-key");
  assert.equal(teamKeyCalls, 1);
  assert.equal(personalKeyCalls, 0);
});

test("getScopedProviderKey falls back to the personal key when the team has no shared key", async () => {
  const { createGetScopedProviderKey } = await loadVaultModule();
  const resolve = createGetScopedProviderKey({
    isTeamMember: async () => true,
    getTeamProviderKey: async () => null,
    getPersonalProviderKey: async () => "personal-key",
  });
  const key = await resolve("user-1", "openai", "team-1");
  assert.equal(key, "personal-key");
});

test("getScopedProviderKey ignores teamId entirely when the caller is not a member (no cherry-picking)", async () => {
  const { createGetScopedProviderKey } = await loadVaultModule();
  let teamKeyCalls = 0;
  const resolve = createGetScopedProviderKey({
    isTeamMember: async () => false,
    getTeamProviderKey: async () => {
      teamKeyCalls += 1;
      return "team-key-should-not-be-returned";
    },
    getPersonalProviderKey: async () => "personal-key",
  });
  const key = await resolve("user-1", "openai", "team-1");
  assert.equal(key, "personal-key");
  assert.equal(
    teamKeyCalls,
    0,
    "must not even issue the team-key RPC for non-members"
  );
});

test("getScopedProviderKey skips membership check entirely for solo scope (no teamId)", async () => {
  const { createGetScopedProviderKey } = await loadVaultModule();
  let membershipCalls = 0;
  let teamKeyCalls = 0;
  const resolve = createGetScopedProviderKey({
    isTeamMember: async () => {
      membershipCalls += 1;
      return false;
    },
    getTeamProviderKey: async () => {
      teamKeyCalls += 1;
      return null;
    },
    getPersonalProviderKey: async () => "personal-key",
  });
  const key = await resolve("user-1", "openai", null);
  assert.equal(key, "personal-key");
  assert.equal(membershipCalls, 0);
  assert.equal(teamKeyCalls, 0);
});

test("getScopedProviderKey propagates RPC errors instead of silently returning null", async () => {
  const { createGetScopedProviderKey } = await loadVaultModule();
  const resolve = createGetScopedProviderKey({
    isTeamMember: async () => true,
    getTeamProviderKey: async () => {
      throw new Error("vault rpc transport error");
    },
    getPersonalProviderKey: async () => "personal-key",
  });
  await assert.rejects(
    () => resolve("user-1", "openai", "team-1"),
    /vault rpc transport error/
  );
});
