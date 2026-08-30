import assert from "node:assert/strict";
import test from "node:test";

async function loadInviteRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/invites/[token]/route");
}

test("invite lookup reports database failures instead of a false 404", async () => {
  const { createInviteGetHandler } = await loadInviteRoute();
  const handler = createInviteGetHandler({
    requireProfileId: async () => "user-1",
    lookupInvite: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/invites/token-1"),
    { params: Promise.resolve({ token: "token-1" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to load invite" });
});

test("invite acceptance maps atomic claim failures without writing an audit event", async () => {
  const { createAcceptInviteHandler } = await loadInviteRoute();
  let auditWrites = 0;
  const handler = createAcceptInviteHandler({
    requireProfileId: async () => "user-1",
    acceptInvite: async () => ({
      data: null,
      error: { message: "already_accepted" },
    }),
    recordTeamAuditEvent: async () => {
      auditWrites += 1;
      return { ok: true };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/invites/token-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmMismatch: true }),
    }),
    { params: Promise.resolve({ token: "token-1" }) }
  );

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: "already_accepted" });
  assert.equal(auditWrites, 0);
});

test("invite acceptance returns the atomically claimed team", async () => {
  const { createAcceptInviteHandler } = await loadInviteRoute();
  const handler = createAcceptInviteHandler({
    requireProfileId: async () => "user-1",
    acceptInvite: async () => ({
      data: {
        invite_id: "invite-1",
        team_id: "team-1",
        team_slug: "builders",
        invite_email: "dev@example.com",
        invite_role: "developer",
        email_match: true,
      },
      error: null,
    }),
    recordTeamAuditEvent: async () => ({ ok: true }),
  });

  const response = await handler(
    new Request("http://localhost/api/invites/token-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ token: "token-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    team: { id: "team-1", slug: "builders" },
  });
});

test("invite acceptance rejects non-object JSON before claiming the token", async () => {
  const { createAcceptInviteHandler } = await loadInviteRoute();
  let acceptanceCalls = 0;
  const handler = createAcceptInviteHandler({
    requireProfileId: async () => "user-1",
    acceptInvite: async () => {
      acceptanceCalls += 1;
      return { data: null, error: null };
    },
  });

  for (const body of [null, [], "confirm", 1]) {
    const response = await handler(
      new Request("http://localhost/api/invites/token-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token: "token-1" }) }
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  }
  assert.equal(acceptanceCalls, 0);
});
