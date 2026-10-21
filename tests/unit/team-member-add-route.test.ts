import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAddTeamMemberHandler } from "../../app/api/teams/[teamId]/members/add/route";
import type { TeamRole } from "../../lib/team-capabilities";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ teamId }) };
const request = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify(body),
  });

function fixture(
  options: {
    role?: TeamRole;
    missing?: boolean;
    fail?: boolean;
    duplicate?: boolean;
  } = {}
) {
  const writes: unknown[] = [];
  let audits = 0;
  const db = createClient("https://db.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        if (options.fail)
          return Response.json(
            { message: "failed", code: "XX000" },
            { status: 500 }
          );
        if (table === "user") {
          assert.equal(url.searchParams.get("emailVerified"), "eq.true");
          return Response.json(options.missing ? [] : [{ id: "auth-person" }]);
        }
        if (table === "profiles") {
          assert.equal(url.searchParams.get("auth_user_id"), "eq.auth-person");
          return Response.json([{ id: "person" }]);
        }
        assert.equal(table, "team_members");
        assert.equal(init?.method, "POST");
        if (options.duplicate)
          return Response.json(
            { message: "duplicate", code: "23505" },
            { status: 409 }
          );
        writes.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      },
    },
  });
  const role = options.role ?? "owner";
  const deps = {
    db,
    requireProfileId: async () => "owner",
    loadTeamMembershipAuth: async () => ({
      ok: true as const,
      role,
      canManage: role === "owner" || role === "admin",
    }),
    recordTeamAuditEvent: async () => {
      audits++;
      return { ok: true as const };
    },
  };
  return {
    handler: createAddTeamMemberHandler(deps),
    deps,
    writes,
    audits: () => audits,
  };
}

test("adds a verified existing account to the URL team with the selected role and audit", async () => {
  const f = fixture();
  const response = await f.handler(
    request({
      email: "Person@Example.com",
      role: "developer",
      team_id: "wrong",
    }),
    context
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    member: { userId: "person", role: "developer" },
  });
  assert.deepEqual(f.writes, [
    {
      team_id: teamId,
      user_id: "person",
      role: "developer",
      invited_by_user_id: "owner",
    },
  ]);
  assert.equal(f.audits(), 1);
});
for (const role of ["developer", "viewer"] as const) {
  test(`${role} cannot add a teammate`, async () => {
    const f = fixture({ role });
    assert.equal(
      (
        await f.handler(
          request({ email: "a@example.com", role: "developer" }),
          context
        )
      ).status,
      403
    );
    assert.deepEqual(f.writes, []);
  });
}
test("admins cannot add admins or owners", async () => {
  const f = fixture({ role: "admin" });
  for (const role of ["admin", "owner"]) {
    assert.ok(
      [400, 403].includes(
        (await f.handler(request({ email: "a@example.com", role }), context))
          .status
      )
    );
  }
  assert.deepEqual(f.writes, []);
});
test("requires sign-in and valid route/body before inserting", async () => {
  const f = fixture();
  const denied = createAddTeamMemberHandler({
    ...f.deps,
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await denied(request({}), context)).status, 401);
  assert.equal((await f.handler(request({}), context)).status, 400);
  assert.equal(
    (
      await f.handler(request({}), {
        params: Promise.resolve({ teamId: "bad" }),
      })
    ).status,
    400
  );
  assert.deepEqual(f.writes, []);
});
for (const [options, status] of [
  [{ missing: true }, 404],
  [{ fail: true }, 500],
  [{ duplicate: true }, 409],
] as const) {
  test(`does not report addition for ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.equal(
      (
        await f.handler(
          request({ email: "a@example.com", role: "developer" }),
          context
        )
      ).status,
      status
    );
    assert.deepEqual(f.writes, []);
    assert.equal(f.audits(), 0);
  });
}
