import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createTeamInviteActionHandlers } from "../../app/api/teams/[teamId]/invites/[inviteId]/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";
import type { sendTeamInvite } from "../../lib/email/send-team-invite";

const teamId = "00000000-0000-4000-8000-000000000001";
const inviteId = "00000000-0000-4000-8000-000000000002";
const validParams = { teamId, inviteId };
const context = (params = validParams) => ({
  params: Promise.resolve(params),
});
const request = (method: "POST" | "DELETE") =>
  new Request(`http://localhost/api/teams/${teamId}/invites/${inviteId}`, {
    method,
  });
type Delivery = Parameters<typeof sendTeamInvite>[0];
type Options = {
  actor?: TeamRole;
  role?: "admin" | "developer" | "viewer";
  missingInvite?: boolean;
  accepted?: boolean;
  failLookup?: boolean;
  missingTeam?: boolean;
  failWrite?: boolean;
  failDelivery?: boolean;
  inviter?: { name: string | null; username: string | null };
};

function fixture(options: Options = {}) {
  const reads: string[] = [];
  const writes: { method: string; body?: Record<string, unknown> }[] = [];
  const deliveries: Delivery[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const role = options.role ?? "viewer";
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        if (table === "team_invites") {
          assert.equal(url.searchParams.get("team_id"), `eq.${teamId}`);
          assert.equal(url.searchParams.get("id"), `eq.${inviteId}`);
          if (init?.method === "PATCH" || init?.method === "DELETE") {
            writes.push({
              method: init.method,
              ...(init.body
                ? {
                    body: JSON.parse(String(init.body)) as Record<
                      string,
                      unknown
                    >,
                  }
                : {}),
            });
            if (options.failWrite)
              return Response.json(
                { message: "Write failed", code: "XX000" },
                { status: 500 }
              );
            if (init.method === "DELETE")
              return new Response(null, { status: 204 });
            return Response.json({
              id: inviteId,
              email: "person@example.com",
              role,
              expires_at: writes[0]?.body?.expires_at,
            });
          }
          reads.push(table);
          if (options.failLookup)
            return Response.json(
              { message: "Lookup failed", code: "XX000" },
              { status: 500 }
            );
          return Response.json(
            options.missingInvite
              ? []
              : [
                  {
                    id: inviteId,
                    team_id: teamId,
                    email: "person@example.com",
                    role,
                    accepted_at: options.accepted
                      ? "2026-10-01T00:00:00Z"
                      : null,
                  },
                ]
          );
        }
        reads.push(String(table));
        if (table === "teams")
          return options.missingTeam
            ? Response.json(
                { code: "PGRST116", message: "No rows" },
                { status: 406 }
              )
            : Response.json({ name: "Test team" });
        if (table === "profiles")
          return Response.json(
            options.inviter ?? { name: "Test inviter", username: "tester" }
          );
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
      return options.failDelivery
        ? { ok: false as const, reason: "resend_error" as const }
        : { ok: true as const, channel: "resend" as const };
    },
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      return { ok: true as const };
    },
  };
  return {
    deps,
    handlers: createTeamInviteActionHandlers(deps),
    reads,
    writes,
    deliveries,
    audits,
  };
}

test("invite DELETE revokes the scoped invite and records its audit", async () => {
  const f = fixture();
  const response = await f.handlers.DELETE(request("DELETE"), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(f.writes, [{ method: "DELETE" }]);
  assert.deepEqual(f.deliveries, []);
  assert.equal(f.audits[0]?.action, "invite.revoked");
  assert.equal(f.audits[0]?.targetId, inviteId);
  assert.equal(f.audits[0]?.productTeamId, teamId);
});

for (const role of ["admin", "developer", "viewer"] as const) {
  test(`invite POST renews and delivers a saved ${role} invitation`, async () => {
    const f = fixture({ role });
    const before = Date.now();
    const response = await f.handlers.POST(request("POST"), context());
    const after = Date.now();
    assert.equal(response.status, 200);
    const result = await response.json();
    const expiresAt = Date.parse(result.invite.expiresAt);
    assert.ok(expiresAt >= before + 7 * 24 * 60 * 60 * 1000);
    assert.ok(expiresAt <= after + 7 * 24 * 60 * 60 * 1000);
    assert.deepEqual(result, {
      invite: {
        id: inviteId,
        email: "person@example.com",
        role,
        expiresAt: result.invite.expiresAt,
      },
      delivery: "resend",
    });
    assert.deepEqual(f.writes, [
      {
        method: "PATCH",
        body: {
          token: "unit-test-token",
          expires_at: result.invite.expiresAt,
          invited_by_user_id: "user-1",
        },
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
    assert.equal(f.audits[0]?.action, "invite.resent");
    assert.equal(f.audits[0]?.payload?.expires_at, result.invite.expiresAt);
  });
}

for (const method of ["POST", "DELETE"] as const) {
  for (const params of [
    { teamId: "bad-team", inviteId },
    { teamId, inviteId: "bad-invite" },
    { teamId: "", inviteId },
  ]) {
    test(`invite ${method} rejects invalid route IDs ${JSON.stringify(params)}`, async () => {
      const f = fixture();
      const handlers = createTeamInviteActionHandlers({
        ...f.deps,
        loadTeamMembershipAuth: async () => {
          throw new Error("Invalid IDs reached membership lookup");
        },
      });
      const response = await handlers[method](request(method), context(params));
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error, "Invalid team or invite ID.");
      assert.deepEqual(result.details.formErrors, []);
      assert.ok(
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

  test(`invite ${method} requires sign-in before validation`, async () => {
    const f = fixture();
    const handlers = createTeamInviteActionHandlers({
      ...f.deps,
      requireProfileId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        throw new Error("Unsigned lookup");
      },
    });
    assert.equal(
      (
        await handlers[method](
          request(method),
          context({ teamId: "bad", inviteId })
        )
      ).status,
      401
    );
    assert.deepEqual(f.reads, []);
  });

  test(`invite ${method} denies nonmembers before invite access`, async () => {
    const f = fixture();
    const handlers = createTeamInviteActionHandlers({
      ...f.deps,
      loadTeamMembershipAuth: async () => ({
        ok: false,
        status: 403,
        error: "Forbidden",
      }),
    });
    assert.equal(
      (await handlers[method](request(method), context())).status,
      403
    );
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
  });

  for (const options of [
    { missingInvite: true },
    { accepted: true },
    { failLookup: true },
  ]) {
    test(`invite ${method} preserves unavailable invite response ${JSON.stringify(options)}`, async () => {
      const f = fixture(options);
      assert.equal(
        (await f.handlers[method](request(method), context())).status,
        404
      );
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.deliveries, []);
      assert.deepEqual(f.audits, []);
    });
  }

  for (const actor of ["admin", "developer", "viewer"] as const) {
    test(`invite ${method} prevents ${actor} from managing an admin invitation`, async () => {
      const f = fixture({ actor, role: "admin" });
      assert.equal(
        (await f.handlers[method](request(method), context())).status,
        403
      );
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.deliveries, []);
    });
  }

  test(`invite ${method} allows an admin to manage a developer invitation`, async () => {
    const f = fixture({ actor: "admin", role: "developer" });
    assert.equal(
      (await f.handlers[method](request(method), context())).status,
      200
    );
    assert.equal(f.writes.length, 1);
  });

  test(`invite ${method} returns a write failure without delivery or audit`, async () => {
    const f = fixture({ failWrite: true });
    assert.equal(
      (await f.handlers[method](request(method), context())).status,
      500
    );
    assert.deepEqual(f.deliveries, []);
    assert.deepEqual(f.audits, []);
  });
}

test("invite POST returns a missing team before rotating the token", async () => {
  const f = fixture({ missingTeam: true });
  assert.equal((await f.handlers.POST(request("POST"), context())).status, 404);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.deliveries, []);
});

test("invite POST preserves renewal if delivery returns failure", async () => {
  const f = fixture({ failDelivery: true });
  const response = await f.handlers.POST(request("POST"), context());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivery, "resend_error");
  assert.equal(f.writes.length, 1);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.audits[0]?.payload?.delivery, "resend_error");
});

for (const [inviter, expected] of [
  [{ name: null, username: "tester" }, "tester"],
  [{ name: null, username: null }, null],
] as const) {
  test(`invite POST preserves inviter fallback ${expected}`, async () => {
    const f = fixture({ inviter });
    assert.equal(
      (await f.handlers.POST(request("POST"), context())).status,
      200
    );
    assert.equal(f.deliveries[0]?.inviterName, expected);
  });
}
