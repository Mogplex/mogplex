import assert from "node:assert/strict";
import test from "node:test";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

async function loadTeamMemberRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/teams/[teamId]/members/[memberUserId]/route");
}

test("PATCH /api/teams/:teamId/members/:memberUserId writes role-change audit event", async () => {
  const { createTeamMemberPatchHandler } = await loadTeamMemberRoute();
  const audits: RecordTeamAuditEventInput[] = [];
  const updates: Array<{ teamId: string; memberUserId: string; role: string }> =
    [];

  const handler = createTeamMemberPatchHandler({
    requireProfileId: async () => "admin-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "owner",
      canManage: true,
    }),
    loadTargetRole: async () => "viewer",
    updateMemberRole: async (teamId, memberUserId, role) => {
      updates.push({ teamId, memberUserId, role });
      return { error: null };
    },
    deleteMember: async () => {
      throw new Error("deleteMember should not run");
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/members/user-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "developer" }),
    }),
    { params: Promise.resolve({ teamId: "team-1", memberUserId: "user-2" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(updates, [
    { teamId: "team-1", memberUserId: "user-2", role: "developer" },
  ]);
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "admin-1",
      action: "member.role_changed",
      targetType: "member",
      targetId: "user-2",
      payload: { from_role: "viewer", to_role: "developer" },
    },
  ]);
});
