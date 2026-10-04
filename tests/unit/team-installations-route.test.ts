import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createTeamInstallationHandlers,
  type ListTeamInstallationsResponse,
} from "../../app/api/teams/[teamId]/installations/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = (id = teamId) => ({ params: Promise.resolve({ teamId: id }) });
const request = (body: unknown) =>
  new Request(`http://localhost/api/teams/${teamId}/installations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
type Options = {
  actor?: TeamRole;
  attachedTeam?: string;
  missing?: boolean;
  failLookup?: boolean;
  failWrite?: boolean;
  empty?: boolean;
};

function fixture(options: Options = {}) {
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const row = {
    id: "installation-row-1",
    installation_id: "123",
    account_login: "example-org",
    account_type: "Organization",
    target_type: "Organization",
    product_team_id: options.attachedTeam ?? null,
    user_id: "user-1",
  };
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.pathname.split("/").at(-1), "github_installations");
        if (init?.method === "PATCH") {
          assert.equal(url.searchParams.get("id"), "eq.installation-row-1");
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return options.failWrite
            ? Response.json(
                { message: "Write failed", code: "XX000" },
                { status: 500 }
              )
            : new Response(null, { status: 204 });
        }
        reads.push(url.search);
        if (options.failLookup)
          return Response.json(
            { message: "Read failed", code: "XX000" },
            { status: 500 }
          );
        if (url.searchParams.has("installation_id")) {
          assert.equal(url.searchParams.get("user_id"), "eq.user-1");
          return Response.json(options.missing ? [] : [row]);
        }
        assert.equal(url.searchParams.get("product_team_id"), `eq.${teamId}`);
        return Response.json(
          options.empty
            ? []
            : [
                { ...row, product_team_id: teamId },
                {
                  ...row,
                  id: "installation-row-2",
                  installation_id: 456,
                  account_login: null,
                  account_type: null,
                  target_type: null,
                  product_team_id: teamId,
                },
              ]
        );
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
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      return { ok: true as const };
    },
  };
  return {
    deps,
    handlers: createTeamInstallationHandlers(deps),
    reads,
    writes,
    audits,
  };
}

for (const actor of ["owner", "admin"] as const) {
  test(`installation GET returns team-scoped rows to ${actor}`, async () => {
    const f = fixture({ actor });
    const response = await f.handlers.GET(
      new Request("http://localhost"),
      context()
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as ListTeamInstallationsResponse;
    assert.deepEqual(result.installations, [
      {
        id: "installation-row-1",
        installation_id: 123,
        account_login: "example-org",
        account_type: "Organization",
        target_type: "Organization",
        product_team_id: teamId,
        attached_by_user_id: "user-1",
      },
      {
        id: "installation-row-2",
        installation_id: 456,
        account_login: null,
        account_type: null,
        target_type: null,
        product_team_id: teamId,
        attached_by_user_id: "user-1",
      },
    ]);
    assert.deepEqual(f.writes, []);
  });
}

for (const installationId of [123, "123", "00123"]) {
  test(`installation POST accepts number/digit-string ${installationId} and attaches within team scope`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(
      request({
        installation_id: installationId,
        product_team_id: "other-team",
        user_id: "other-user",
      }),
      context()
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      attached: {
        id: "installation-row-1",
        installation_id: 123,
        account_login: "example-org",
        account_type: "Organization",
        target_type: "Organization",
        product_team_id: teamId,
        attached_by_user_id: "user-1",
      },
    });
    assert.deepEqual(f.writes, [{ product_team_id: teamId }]);
    assert.ok(f.reads[0]?.includes("installation_id=eq.123"));
    assert.equal(f.audits[0]?.action, "team.installation.attached");
    assert.equal(f.audits[0]?.productTeamId, teamId);
    assert.equal(f.audits[0]?.targetId, "installation-row-1");
    assert.deepEqual(f.audits[0]?.payload, {
      installation_id: 123,
      account_login: "example-org",
    });
  });
}

for (const body of [
  null,
  [],
  false,
  "install",
  {},
  { installation_id: null },
  { installation_id: true },
  { installation_id: "bad" },
  { installation_id: "1e3" },
  { installation_id: "-1" },
  { installation_id: "0" },
  { installation_id: 0 },
  { installation_id: -1 },
  { installation_id: 1.5 },
  { installation_id: Number.MAX_SAFE_INTEGER + 1 },
  { installation_id: 1e21 },
  { installation_id: "9007199254740993" },
  { installation_id: "1000000000000000000000" },
]) {
  test(`installation POST rejects invalid body ${JSON.stringify(body)} with flattened errors`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(request(body), context());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid installation ID.");
    assert.ok(Array.isArray(result.details.formErrors));
    assert.ok(
      result.details.formErrors.length > 0 ||
        Object.values(result.details.fieldErrors).some(
          (errors) => Array.isArray(errors) && errors.length > 0
        )
    );
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  });
}

test("installation POST preserves malformed JSON at 400", async () => {
  const f = fixture();
  const response = await f.handlers.POST(
    new Request("http://localhost", { method: "POST", body: "{" }),
    context()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  assert.deepEqual(f.reads, []);
});

for (const method of ["GET", "POST"] as const) {
  test(`installation ${method} requires sign-in before validation`, async () => {
    const f = fixture();
    const handlers = createTeamInstallationHandlers({
      ...f.deps,
      requireProfileId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        throw new Error("Unsigned lookup");
      },
    });
    assert.equal(
      (await handlers[method](request(null), context("bad-team"))).status,
      401
    );
    assert.deepEqual(f.reads, []);
  });

  test(`installation ${method} rejects malformed team ID before database access`, async () => {
    const f = fixture();
    const handlers = createTeamInstallationHandlers({
      ...f.deps,
      loadTeamMembershipAuth: async () => {
        throw new Error("Invalid team reached auth");
      },
    });
    const response = await handlers[method](request(null), context("bad-team"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid team ID.",
      details: { formErrors: [], fieldErrors: { teamId: ["Invalid uuid"] } },
    });
    assert.deepEqual(f.reads, []);
  });

  test(`installation ${method} denies nonmembers before parsing`, async () => {
    const f = fixture();
    const handlers = createTeamInstallationHandlers({
      ...f.deps,
      loadTeamMembershipAuth: async () => ({
        ok: false,
        status: 403,
        error: "Forbidden",
      }),
    });
    assert.equal(
      (await handlers[method](request(null), context())).status,
      403
    );
    assert.deepEqual(f.reads, []);
  });

  for (const actor of ["developer", "viewer"] as const) {
    test(`installation ${method} denies ${actor} before parsing`, async () => {
      const f = fixture({ actor });
      assert.equal(
        (await f.handlers[method](request(null), context())).status,
        403
      );
      assert.deepEqual(f.reads, []);
      assert.deepEqual(f.writes, []);
    });
  }

  test(`installation ${method} reports database failure without writes`, async () => {
    const f = fixture({ failLookup: true });
    assert.equal(
      (await f.handlers[method](request({ installation_id: 123 }), context()))
        .status,
      500
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  });
}

test("installation POST lets an admin attach an owned installation", async () => {
  const f = fixture({ actor: "admin" });
  assert.equal(
    (await f.handlers.POST(request({ installation_id: 123 }), context()))
      .status,
    201
  );
  assert.equal(f.writes.length, 1);
});

test("installation POST reports missing owned installation without writes", async () => {
  const f = fixture({ missing: true });
  const response = await f.handlers.POST(
    request({ installation_id: 123 }),
    context()
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Installation not found for this user",
  });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
});

test("installation POST refuses an installation attached to another team", async () => {
  const f = fixture({ attachedTeam: "other-team" });
  assert.equal(
    (await f.handlers.POST(request({ installation_id: 123 }), context()))
      .status,
    409
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
});

test("installation POST is idempotent for its existing team", async () => {
  const f = fixture({ attachedTeam: teamId });
  assert.equal(
    (await f.handlers.POST(request({ installation_id: 123 }), context()))
      .status,
    200
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
});

test("installation POST reports attach failure without audit", async () => {
  const f = fixture({ failWrite: true });
  assert.equal(
    (await f.handlers.POST(request({ installation_id: 123 }), context()))
      .status,
    500
  );
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.audits, []);
});

test("installation GET returns an empty list", async () => {
  const f = fixture({ empty: true });
  const response = await f.handlers.GET(
    new Request("http://localhost"),
    context()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { installations: [] });
});
