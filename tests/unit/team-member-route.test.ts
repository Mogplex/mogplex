import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { TeamRole } from "../../lib/team-capabilities";
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

const memberContext = () => ({
  params: Promise.resolve({ teamId: "team-1", memberUserId: "user-2" }),
});

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/teams/team-1/members/user-2", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function patchFixture(
  actorRole: TeamRole = "owner",
  targetRole: TeamRole = "viewer"
) {
  const { createTeamMemberPatchHandler } = await loadTeamMemberRoute();
  const updates: TeamRole[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  let targetReads = 0;
  const handler = createTeamMemberPatchHandler({
    requireProfileId: async () => "admin-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: actorRole,
      canManage: actorRole === "owner" || actorRole === "admin",
    }),
    loadTargetRole: async () => {
      targetReads += 1;
      return targetRole;
    },
    updateMemberRole: async (_teamId, _userId, role) => {
      updates.push(role);
      return { error: null };
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
    },
  });
  return { handler, updates, audits, targetReads: () => targetReads };
}

for (const body of [
  null,
  [],
  "viewer",
  1,
  false,
  {},
  { role: null },
  { role: 123 },
  { role: "superadmin" },
]) {
  test(`member PATCH rejects invalid body ${JSON.stringify(body)} before target lookup or writes`, async () => {
    const fixture = await patchFixture();
    const response = await fixture.handler(patchRequest(body), memberContext());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid member role.");
    assert.ok(Array.isArray(result.details.formErrors));
    if (body && typeof body === "object" && !Array.isArray(body)) {
      assert.ok(result.details.fieldErrors.role.length > 0);
    } else {
      assert.ok(result.details.formErrors.length > 0);
    }
    assert.equal(fixture.targetReads(), 0);
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.audits, []);
  });
}

test("member PATCH rejects malformed JSON without writes", async () => {
  const fixture = await patchFixture();
  const response = await fixture.handler(
    new Request("http://localhost", { method: "PATCH", body: "{" }),
    memberContext()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  assert.equal(fixture.targetReads(), 0);
  assert.deepEqual(fixture.updates, []);
});

test("member PATCH keeps sign-in and team authorization ahead of body validation", async () => {
  const { createTeamMemberPatchHandler } = await loadTeamMemberRoute();
  for (const signedIn of [false, true]) {
    const handler = createTeamMemberPatchHandler({
      requireProfileId: async () =>
        signedIn
          ? "admin-1"
          : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        assert.equal(signedIn, true);
        return { ok: false, status: 403, error: "Forbidden" };
      },
      loadTargetRole: async () => {
        throw new Error("Unauthorized target read");
      },
      updateMemberRole: async () => {
        throw new Error("Unauthorized write");
      },
    });
    const response = await handler(patchRequest(null), memberContext());
    assert.equal(response.status, signedIn ? 403 : 401);
    assert.deepEqual(await response.json(), {
      error: signedIn ? "Forbidden" : "Unauthorized",
    });
  }
});

const deniedChanges: Array<[TeamRole, TeamRole, TeamRole]> = [
  ["viewer", "viewer", "developer"],
  ["developer", "viewer", "developer"],
  ["admin", "viewer", "admin"],
  ["admin", "admin", "viewer"],
  ["owner", "owner", "admin"],
  ["owner", "viewer", "owner"],
];
for (const [actor, target, next] of deniedChanges) {
  test(`member PATCH forbids ${actor} changing ${target} to ${next}`, async () => {
    const fixture = await patchFixture(actor, target);
    const response = await fixture.handler(
      patchRequest({ role: next }),
      memberContext()
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.audits, []);
  });
}

for (const next of ["admin", "developer", "viewer"] as const) {
  test(`member PATCH accepts owner assigning ${next} and ignores extra fields`, async () => {
    const fixture = await patchFixture();
    const response = await fixture.handler(
      patchRequest({ role: next, team_id: "other-team" }),
      memberContext()
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(fixture.updates, [next]);
    assert.equal(fixture.audits[0]?.payload?.to_role, next);
  });
}

test("member PATCH keeps the self-role prohibition", async () => {
  const fixture = await patchFixture();
  const response = await fixture.handler(patchRequest({ role: "viewer" }), {
    params: Promise.resolve({ teamId: "team-1", memberUserId: "admin-1" }),
  });
  assert.equal(response.status, 403);
  assert.equal(fixture.targetReads(), 0);
  assert.deepEqual(fixture.updates, []);
});

test("member PATCH reports a database write failure without an audit", async () => {
  const { createTeamMemberPatchHandler } = await loadTeamMemberRoute();
  const handler = createTeamMemberPatchHandler({
    requireProfileId: async () => "admin-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "owner",
      canManage: true,
    }),
    loadTargetRole: async () => "viewer",
    updateMemberRole: async () => ({ error: { message: "Write failed" } }),
    recordTeamAuditEvent: async () => {
      throw new Error("Failed write must not be audited");
    },
  });
  const response = await handler(
    patchRequest({ role: "developer" }),
    memberContext()
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Write failed" });
});
