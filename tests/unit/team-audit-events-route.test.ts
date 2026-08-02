import assert from "node:assert/strict";
import test from "node:test";

async function loadAuditEventsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/teams/[teamId]/audit-events/route");
}

test("GET /api/teams/:teamId/audit-events denies non-admin members", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  let listCalls = 0;
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "developer",
      canManage: false,
    }),
    listAuditEvents: async () => {
      listCalls += 1;
      return { data: [], error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/audit-events"),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(listCalls, 0);
});

test("GET /api/teams/:teamId/audit-events returns admin-visible events", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async (_teamId, profileId) => {
      assert.equal(profileId, "user-1");
      return { ok: true, role: "admin", canManage: true };
    },
    listAuditEvents: async (teamId, cursor) => {
      assert.equal(teamId, "team-1");
      assert.equal(cursor, null);
      return {
        data: [
          {
            id: "event-1",
            action: "member.role_changed",
            decision_code: null,
            target_type: "member",
            target_id: "user-2",
            actor_user_id: "user-1",
            repo_id: null,
            sandbox_record_id: null,
            ai_call_id: null,
            job_run_id: null,
            request_id: null,
            auth_source: null,
            payload: { from_role: "viewer", to_role: "developer" },
            created_at: "2026-05-18T14:30:00.000Z",
          },
        ],
        error: null,
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/audit-events"),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    events: [
      {
        id: "event-1",
        action: "member.role_changed",
        decisionCode: null,
        targetType: "member",
        targetId: "user-2",
        actorUserId: "user-1",
        repoId: null,
        sandboxRecordId: null,
        aiCallId: null,
        jobRunId: null,
        requestId: null,
        authSource: null,
        payload: { from_role: "viewer", to_role: "developer" },
        createdAt: "2026-05-18T14:30:00.000Z",
      },
    ],
    nextCursor: null,
    viewer: { canManage: true },
  });
});

test("GET /api/teams/:teamId/audit-events uses stable composite cursors", async () => {
  const { createTeamAuditEventsGetHandler, encodeAuditCursor } =
    await loadAuditEventsRoute();
  const rows = Array.from({ length: 26 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(26 - index).padStart(12, "0")}`,
    action: "member.role_changed",
    decision_code: null,
    target_type: "member",
    target_id: `user-${index}`,
    actor_user_id: "user-1",
    repo_id: null,
    sandbox_record_id: null,
    ai_call_id: null,
    job_run_id: null,
    request_id: null,
    auth_source: null,
    payload: {},
    created_at: "2026-05-18T14:30:00.123456+00:00",
  }));
  const cursors: unknown[] = [];
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "admin",
      canManage: true,
    }),
    listAuditEvents: async (_teamId, cursor) => {
      cursors.push(cursor);
      return { data: rows, error: null };
    },
  });

  const firstResponse = await handler(
    new Request("http://localhost/api/teams/team-1/audit-events"),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );
  const firstBody = (await firstResponse.json()) as { nextCursor: string };
  assert.equal(firstResponse.status, 200);
  assert.equal(firstBody.nextCursor, encodeAuditCursor(rows[24]!));

  const secondResponse = await handler(
    new Request(
      `http://localhost/api/teams/team-1/audit-events?cursor=${encodeURIComponent(firstBody.nextCursor)}`
    ),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(secondResponse.status, 200);
  assert.deepEqual(cursors, [
    null,
    {
      createdAt: rows[24]!.created_at,
      id: rows[24]!.id,
    },
  ]);
});

test("GET /api/teams/:teamId/audit-events rejects loose cursor dates", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  let listCalls = 0;
  const cursor = Buffer.from(
    JSON.stringify({
      createdAt: "January 1, 2026",
      id: "00000000-0000-0000-0000-000000000001",
    }),
    "utf8"
  ).toString("base64url");
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "admin",
      canManage: true,
    }),
    listAuditEvents: async () => {
      listCalls += 1;
      return { data: [], error: null };
    },
  });

  const response = await handler(
    new Request(
      `http://localhost/api/teams/team-1/audit-events?cursor=${encodeURIComponent(cursor)}`
    ),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid cursor" });
  assert.equal(listCalls, 0);
});

test("GET /api/teams/:teamId/audit-events still accepts legacy timestamp cursors", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  const cursors: unknown[] = [];
  const legacyCursor = "2026-05-18T14:30:00.000Z";
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "admin",
      canManage: true,
    }),
    listAuditEvents: async (_teamId, cursor) => {
      cursors.push(cursor);
      return { data: [], error: null };
    },
  });

  const response = await handler(
    new Request(
      `http://localhost/api/teams/team-1/audit-events?cursor=${encodeURIComponent(legacyCursor)}`
    ),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(cursors, [
    {
      createdAt: legacyCursor,
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    },
  ]);
});

test("GET /api/teams/:teamId/audit-events hides audit query errors", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  const loggedErrors: Array<[string, { message: string }]> = [];
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true,
      role: "admin",
      canManage: true,
    }),
    listAuditEvents: async () => ({
      data: null,
      error: { message: "relation team_audit_events does not exist" },
    }),
    logError: (message, error) => loggedErrors.push([message, error]),
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/audit-events"),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.deepEqual(loggedErrors, [
    [
      "Audit events query failed",
      { message: "relation team_audit_events does not exist" },
    ],
  ]);
});

test("GET /api/teams/:teamId/audit-events maps auth 500 to a generic body", async () => {
  const { createTeamAuditEventsGetHandler } = await loadAuditEventsRoute();
  let listCalls = 0;
  const handler = createTeamAuditEventsGetHandler({
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: false,
      status: 500,
      error: "raw database message",
    }),
    listAuditEvents: async () => {
      listCalls += 1;
      return { data: [], error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/teams/team-1/audit-events"),
    { params: Promise.resolve({ teamId: "team-1" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(listCalls, 0);
});
