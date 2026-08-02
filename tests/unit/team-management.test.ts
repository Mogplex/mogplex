import assert from "node:assert/strict";
import test from "node:test";

async function loadTeamManagementModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/team-management");
}

test("loadTeamMembershipAuth returns 500 for membership lookup errors", async () => {
  const { createLoadTeamMembershipAuth } = await loadTeamManagementModule();
  const loggedErrors: Array<[string, { message: string }]> = [];
  const loadTeamMembershipAuth = createLoadTeamMembershipAuth({
    loadTeam: async () => ({ data: { id: "team-1" }, error: null }),
    loadMembership: async () => ({
      data: null,
      error: { message: "database unavailable" },
    }),
    logError: (message, error) => loggedErrors.push([message, error]),
  });

  assert.deepEqual(await loadTeamMembershipAuth("team-1", "user-1"), {
    ok: false,
    status: 500,
    error: "Internal server error",
  });
  assert.deepEqual(loggedErrors, [
    ["Team membership lookup failed", { message: "database unavailable" }],
  ]);
});

test("loadTeamMembershipAuth returns 500 for team lookup errors", async () => {
  const { createLoadTeamMembershipAuth } = await loadTeamManagementModule();
  const loggedErrors: Array<[string, { message: string }]> = [];
  const loadTeamMembershipAuth = createLoadTeamMembershipAuth({
    loadTeam: async () => ({
      data: null,
      error: { message: "relation teams does not exist" },
    }),
    loadMembership: async () => ({ data: null, error: null }),
    logError: (message, error) => loggedErrors.push([message, error]),
  });

  assert.deepEqual(await loadTeamMembershipAuth("team-1", "user-1"), {
    ok: false,
    status: 500,
    error: "Internal server error",
  });
  assert.deepEqual(loggedErrors, [
    ["Team lookup failed", { message: "relation teams does not exist" }],
  ]);
});

test("loadTeamMembershipAuth still returns 403 when membership is absent", async () => {
  const { createLoadTeamMembershipAuth } = await loadTeamManagementModule();
  const loadTeamMembershipAuth = createLoadTeamMembershipAuth({
    loadTeam: async () => ({ data: { id: "team-1" }, error: null }),
    loadMembership: async () => ({ data: null, error: null }),
  });

  assert.deepEqual(await loadTeamMembershipAuth("team-1", "user-1"), {
    ok: false,
    status: 403,
    error: "Forbidden",
  });
});

test("role-management helpers preserve owner/admin boundaries", async () => {
  const { canChangeMemberRole, canInviteRole, canRemoveMember } =
    await loadTeamManagementModule();

  assert.equal(canChangeMemberRole("owner", "viewer", "admin"), true);
  assert.equal(canChangeMemberRole("owner", "admin", "owner"), false);
  assert.equal(canChangeMemberRole("admin", "viewer", "developer"), true);
  assert.equal(canChangeMemberRole("admin", "developer", "admin"), false);
  assert.equal(canChangeMemberRole("developer", "viewer", "developer"), false);

  assert.equal(canInviteRole("owner", "admin"), true);
  assert.equal(canInviteRole("admin", "developer"), true);
  assert.equal(canInviteRole("admin", "admin"), false);
  assert.equal(canInviteRole("viewer", "viewer"), false);

  assert.equal(canRemoveMember("owner", "admin"), true);
  assert.equal(canRemoveMember("owner", "owner"), false);
  assert.equal(canRemoveMember("admin", "developer"), true);
  assert.equal(canRemoveMember("admin", "admin"), false);
});
