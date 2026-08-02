import assert from "node:assert/strict";
import test from "node:test";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

async function loadTeamOwnershipRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/teams/[teamId]/ownership/route");
}

test("POST /api/teams/:teamId/ownership transfers ownership and audits it", async () => {
  const { createTransferOwnershipPostHandler } = await loadTeamOwnershipRoute();
  const transfers: Array<{
    teamId: string;
    currentOwnerUserId: string;
    nextOwnerUserId: string;
  }> = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const handler = createTransferOwnershipPostHandler({
    requireProfileId: async () => "owner-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "owner",
      canManage: true,
    }),
    transferOwnership: async (teamId, currentOwnerUserId, nextOwnerUserId) => {
      transfers.push({ teamId, currentOwnerUserId, nextOwnerUserId });
      return { error: null };
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_owner_user_id: "admin-2" }),
    }),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(transfers, [
    {
      teamId: "team-1",
      currentOwnerUserId: "owner-1",
      nextOwnerUserId: "admin-2",
    },
  ]);
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "owner-1",
      action: "team.owner_transferred",
      targetType: "member",
      targetId: "admin-2",
      payload: {
        from_owner_user_id: "owner-1",
        to_owner_user_id: "admin-2",
      },
    },
  ]);
});

test("POST /api/teams/:teamId/ownership requires the current owner", async () => {
  const { createTransferOwnershipPostHandler } = await loadTeamOwnershipRoute();
  let transferCalls = 0;
  const handler = createTransferOwnershipPostHandler({
    requireProfileId: async () => "admin-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "admin",
      canManage: true,
    }),
    transferOwnership: async () => {
      transferCalls += 1;
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_owner_user_id: "admin-2" }),
    }),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(transferCalls, 0);
});

test("POST /api/teams/:teamId/ownership maps auth 500 to a generic body", async () => {
  const { createTransferOwnershipPostHandler } = await loadTeamOwnershipRoute();
  let transferCalls = 0;
  const handler = createTransferOwnershipPostHandler({
    requireProfileId: async () => "owner-1",
    loadTeamMembershipAuth: async () => ({
      ok: false,
      status: 500,
      error: "raw database message",
    }),
    transferOwnership: async () => {
      transferCalls += 1;
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_owner_user_id: "admin-2" }),
    }),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(transferCalls, 0);
});

test("POST /api/teams/:teamId/ownership maps RPC validation failures to a safe 422", async () => {
  const { createTransferOwnershipPostHandler } = await loadTeamOwnershipRoute();
  const handler = createTransferOwnershipPostHandler({
    requireProfileId: async () => "owner-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "owner",
      canManage: true,
    }),
    transferOwnership: async () => ({
      error: {
        code: "23514",
        message:
          'new row for relation "team_members" violates check constraint "team_members_role_check"',
      },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_owner_user_id: "developer-2" }),
    }),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Cannot transfer ownership to that member",
  });
});

test("POST /api/teams/:teamId/ownership maps RPC data-integrity failures to a generic 500", async () => {
  const { createTransferOwnershipPostHandler } = await loadTeamOwnershipRoute();
  const handler = createTransferOwnershipPostHandler({
    requireProfileId: async () => "owner-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "owner",
      canManage: true,
    }),
    transferOwnership: async () => ({
      error: {
        code: "P0001",
        message: "current owner membership not found",
      },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_owner_user_id: "admin-2" }),
    }),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to transfer ownership",
  });
});
