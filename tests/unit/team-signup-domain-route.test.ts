import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { TeamRole } from "../../lib/team-capabilities";

import { createTeamSignupDomainHandlers } from "../../app/api/teams/[teamId]/signup-domain/route";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ teamId }) };
const request = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

function fixture(
  role: TeamRole | null = "owner",
  eligibleDomain: string | null = "example.com"
) {
  let domain: string | null = null;
  let enabled = false;
  const writes: Array<{ domain: string | null; enabled: boolean }> = [];
  const deps = {
    requireProfileId: async () => "owner-id",
    loadTeamMembershipAuth: async () =>
      role === null
        ? { ok: false as const, status: 403 as const, error: "Forbidden" }
        : {
            ok: true as const,
            role,
            canManage: role === "owner" || role === "admin",
          },
    read: async () => ({ domain, enabled, eligibleDomain }),
    write: async (
      _id: string,
      _actor: string,
      value: string | null,
      nextEnabled: boolean
    ) => {
      domain = value;
      enabled = nextEnabled;
      writes.push({ domain: value, enabled });
    },
  };
  return {
    deps,
    writes,
    handlers: createTeamSignupDomainHandlers(deps),
  };
}

for (const role of ["owner", "admin"] as const) {
  test(`${role} enables only their verified domain, reads saved state and disables`, async () => {
    const f = fixture(role);
    assert.equal(
      (await f.handlers.PATCH(request({ enabled: true }), context)).status,
      200
    );
    assert.equal(
      (
        await (
          await f.handlers.GET(new Request("http://localhost"), context)
        ).json()
      ).domain,
      "example.com"
    );
    assert.equal(
      (await f.handlers.PATCH(request({ enabled: false }), context)).status,
      200
    );
    assert.deepEqual(f.writes, [
      { domain: "example.com", enabled: true },
      { domain: "example.com", enabled: false },
    ]);
  });
}
for (const role of ["developer", "viewer", null] as const) {
  test(`${role} cannot change enrollment`, async () => {
    const f = fixture(role);
    assert.equal(
      (await f.handlers.PATCH(request({ enabled: true }), context)).status,
      403
    );
    assert.deepEqual(f.writes, []);
  });
}
test("cannot use an unverified domain, supply an arbitrary domain or malformed data", async () => {
  const f = fixture("owner", null);
  assert.equal(
    (await f.handlers.PATCH(request({ enabled: true }), context)).status,
    400
  );
  for (const body of [
    { enabled: true, domain: "victim.test" },
    {},
    { enabled: "true" },
  ]) {
    assert.equal((await f.handlers.PATCH(request(body), context)).status, 400);
  }
  assert.deepEqual(f.writes, []);
});
test("requires sign-in, validates IDs, and returns storage failure without success", async () => {
  const f = fixture();
  const unauthorized = createTeamSignupDomainHandlers({
    ...f.deps,
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal(
    (await unauthorized.PATCH(request({ enabled: true }), context)).status,
    401
  );
  assert.equal(
    (
      await f.handlers.GET(new Request("http://localhost"), {
        params: Promise.resolve({ teamId: "bad" }),
      })
    ).status,
    400
  );
  const failed = createTeamSignupDomainHandlers({
    ...f.deps,
    write: async () => {
      throw new Error("unavailable");
    },
  });
  assert.equal(
    (await failed.PATCH(request({ enabled: true }), context)).status,
    500
  );
  assert.deepEqual(f.writes, []);
});

test("a different-domain admin can disable but cannot silently replace the configured domain", async () => {
  const f = fixture("admin", "other.test");
  const handlers = createTeamSignupDomainHandlers({
    ...f.deps,
    read: async () => ({
      domain: "example.com",
      enabled: false,
      eligibleDomain: "other.test",
    }),
  });
  assert.equal(
    (await handlers.PATCH(request({ enabled: true }), context)).status,
    403
  );
  assert.deepEqual(f.writes, []);
  assert.equal(
    (await handlers.PATCH(request({ enabled: false }), context)).status,
    200
  );
  assert.deepEqual(f.writes, [{ domain: "example.com", enabled: false }]);
});
