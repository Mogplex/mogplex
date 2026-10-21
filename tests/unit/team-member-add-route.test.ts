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
  const db = createClient("https://db.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(
          url.pathname.split("/").at(-1),
          "add_verified_team_member"
        );
        assert.equal(init?.method, "POST");
        if (options.fail)
          return Response.json(
            { message: "failed", code: "XX000" },
            { status: 500 }
          );
        if (options.missing)
          return Response.json(
            {
              message: "member_add_account_unverified_or_missing",
              code: "P0001",
            },
            { status: 400 }
          );
        if (options.duplicate)
          return Response.json(
            { message: "duplicate", code: "23505" },
            { status: 409 }
          );
        writes.push(JSON.parse(String(init?.body)));
        return Response.json({
          member_user_id: "person",
          member_role: "developer",
        });
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
  };
  return {
    handler: createAddTeamMemberHandler(deps),
    deps,
    writes,
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
      p_team_id: teamId,
      p_email: "person@example.com",
      p_role: "developer",
      p_actor_id: "owner",
    },
  ]);
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
  });
}
