import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createTeamInvitePostHandler } from "../../app/api/teams/[teamId]/invites/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";
import type { sendTeamInvite } from "../../lib/email/send-team-invite";

const context = () => ({ params: Promise.resolve({ teamId: "team-1" }) });
const request = (body: unknown) =>
  new Request("http://localhost/api/teams/team-1/invites", {
    method: "POST",
    body: JSON.stringify(body),
  });
type Delivery = Parameters<typeof sendTeamInvite>[0];
type Options = {
  actor?: TeamRole;
  existingMember?: boolean;
  failInsert?: boolean;
  failLookup?: boolean;
  failDelivery?: boolean;
};

function fixture(options: Options = {}) {
  const writes: unknown[] = [];
  const reads: string[] = [];
  const deliveries: Delivery[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        if (init?.method === "POST") {
          assert.equal(table, "team_invites");
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push(body);
          if (options.failInsert)
            return Response.json(
              { message: "Insert failed", code: "XX000" },
              { status: 500 }
            );
          return Response.json(
            {
              id: "invite-1",
              email: body.email,
              role: body.role,
              expires_at: "2026-10-10T00:00:00Z",
            },
            { status: 201 }
          );
        }
        reads.push(
          `${table}:${url.searchParams.get("email") ?? url.searchParams.get("id") ?? ""}`
        );
        if (options.failLookup)
          return Response.json(
            { message: "Lookup failed", code: "XX000" },
            { status: 500 }
          );
        if (table === "profiles" && url.searchParams.has("email"))
          return Response.json(
            options.existingMember ? [{ id: "user-2" }] : []
          );
        if (table === "team_members")
          return Response.json([{ team_id: "team-1" }]);
        if (table === "teams")
          return Response.json([
            { id: "team-1", name: "Test team", slug: "test-team" },
          ]);
        if (table === "profiles")
          return Response.json([{ name: "Test inviter", username: "tester" }]);
        throw new Error(`Unexpected database request ${table}`);
      },
    },
  });
  const actor = options.actor ?? "owner";
  const deps = {
    db,
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true as const,
      role: actor,
      canManage: actor === "owner" || actor === "admin",
    }),
    generateInviteToken: () => "unit-test-token",
    sendTeamInvite: async (input: Delivery) => {
      deliveries.push(input);
      if (options.failDelivery) throw new Error("Delivery failed");
      return { ok: true as const, channel: "resend" as const };
    },
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      return { ok: true as const };
    },
  };
  return {
    deps,
    handler: createTeamInvitePostHandler(deps),
    writes,
    reads,
    deliveries,
    audits,
  };
}

for (const role of ["admin", "developer", "viewer"] as const) {
  test(`invite POST saves normalized email and ${role} role, sends delivery and audits`, async () => {
    const f = fixture();
    const response = await f.handler(
      request({ email: "  PERSON@Example.COM  ", role, team_id: "other-team" }),
      context()
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      invite: {
        id: "invite-1",
        email: "person@example.com",
        role,
        expiresAt: "2026-10-10T00:00:00Z",
      },
      delivery: "resend",
    });
    assert.deepEqual(f.writes, [
      {
        team_id: "team-1",
        email: "person@example.com",
        role,
        token: "unit-test-token",
        invited_by_user_id: "user-1",
      },
    ]);
    assert.deepEqual(f.deliveries, [
      {
        email: "person@example.com",
        teamName: "Test team",
        inviterName: "Test inviter",
        role,
        token: "unit-test-token",
      },
    ]);
    assert.equal(f.audits[0]?.action, "invite.created");
    assert.equal(f.audits[0]?.payload?.role, role);
    assert.equal(f.audits[0]?.productTeamId, "team-1");
  });
}

for (const body of [
  null,
  [],
  false,
  "email",
  {},
  { email: 12, role: "viewer" },
  { email: "bad-email", role: "viewer" },
  { email: "person@example.com", role: null },
  { email: "person@example.com", role: "owner" },
]) {
  test(`invite POST rejects invalid input ${JSON.stringify(body)} with flattened errors`, async () => {
    const f = fixture();
    const response = await f.handler(request(body), context());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid invite.");
    assert.ok(Array.isArray(result.details.formErrors));
    assert.ok(
      result.details.formErrors.length > 0 ||
        Object.values(result.details.fieldErrors).some(
          (errors) => Array.isArray(errors) && errors.length > 0
        )
    );
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.deliveries, []);
    assert.deepEqual(f.audits, []);
  });
}

test("invite POST keeps malformed JSON at 400 before database access", async () => {
  const f = fixture();
  const response = await f.handler(
    new Request("http://localhost", { method: "POST", body: "{" }),
    context()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  assert.deepEqual(f.reads, []);
});

test("invite POST requires sign-in before validation or membership access", async () => {
  const f = fixture();
  const handler = createTeamInvitePostHandler({
    ...f.deps,
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    loadTeamMembershipAuth: async () => {
      throw new Error("Unsigned membership lookup");
    },
  });
  const response = await handler(request(null), context());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(f.writes, []);
});

test("invite POST denies nonmembers before writes or delivery", async () => {
  const f = fixture();
  const handler = createTeamInvitePostHandler({
    ...f.deps,
    loadTeamMembershipAuth: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
  });
  const response = await handler(
    request({ email: "person@example.com", role: "viewer" }),
    context()
  );
  assert.equal(response.status, 403);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.deliveries, []);
});

for (const actor of ["admin", "developer", "viewer"] as const) {
  test(`invite POST prevents ${actor} from inviting an admin`, async () => {
    const f = fixture({ actor });
    const response = await f.handler(
      request({ email: "person@example.com", role: "admin" }),
      context()
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.deliveries, []);
  });
}

test("invite POST lets an admin invite a developer", async () => {
  const f = fixture({ actor: "admin" });
  const response = await f.handler(
    request({ email: "person@example.com", role: "developer" }),
    context()
  );
  assert.equal(response.status, 201);
  assert.equal(f.writes.length, 1);
});

test("invite POST returns 409 for an existing member without another invite", async () => {
  const f = fixture({ existingMember: true });
  const response = await f.handler(
    request({ email: "person@example.com", role: "viewer" }),
    context()
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "That user is already a team member",
  });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.deliveries, []);
});

for (const options of [{ failLookup: true }, { failInsert: true }]) {
  test(`invite POST reports database failure ${JSON.stringify(options)} without delivery or audit`, async () => {
    const f = fixture(options);
    const response = await f.handler(
      request({ email: "person@example.com", role: "viewer" }),
      context()
    );
    assert.equal(response.status, 500);
    assert.deepEqual(f.deliveries, []);
    assert.deepEqual(f.audits, []);
  });
}

test("invite POST preserves saved invite if delivery fails", async () => {
  const f = fixture({ failDelivery: true });
  const response = await f.handler(
    request({ email: "person@example.com", role: "viewer" }),
    context()
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.invite.id, "invite-1");
  assert.equal(result.delivery, "resend_error");
  assert.equal(f.writes.length, 1);
  assert.equal(f.audits[0]?.payload?.delivery, "resend_error");
});
