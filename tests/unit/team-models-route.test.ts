import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createTeamModelHandlers,
  type TeamModelsResponse,
} from "../../app/api/teams/[teamId]/models/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = (id = teamId) => ({ params: Promise.resolve({ teamId: id }) });
const request = (body: unknown) =>
  new Request(`http://localhost/api/teams/${teamId}/models`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
type Options = {
  actor?: TeamRole;
  allowlist?: string[] | null;
  failModels?: boolean;
  failRead?: boolean;
  missingTeam?: boolean;
  failWrite?: boolean;
  missingIds?: boolean;
};

function fixture(options: Options = {}) {
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        if (table === "teams")
          assert.equal(url.searchParams.get("id"), `eq.${teamId}`);
        if (init?.method === "PATCH") {
          assert.equal(table, "teams");
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return options.failWrite
            ? Response.json(
                { message: "Write failed", code: "XX000" },
                { status: 500 }
              )
            : new Response(null, { status: 204 });
        }
        reads.push(String(table));
        if (table === "ai_models")
          return options.failModels
            ? Response.json(
                { message: "Catalog failed", code: "XX000" },
                { status: 500 }
              )
            : Response.json(
                options.missingIds
                  ? [{ id: "model-a" }]
                  : [{ id: "model-a" }, { id: "model-b" }]
              );
        if (table === "teams") {
          if (options.failRead)
            return Response.json(
              { message: "Read failed", code: "XX000" },
              { status: 500 }
            );
          return Response.json(
            options.missingTeam
              ? null
              : { model_allowlist: options.allowlist ?? null }
          );
        }
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
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      return { ok: true as const };
    },
  };
  return {
    deps,
    handlers: createTeamModelHandlers(deps),
    reads,
    writes,
    audits,
  };
}

for (const actor of ["owner", "admin", "developer", "viewer"] as const) {
  test(`team models GET returns stored settings and ${actor} capabilities`, async () => {
    const f = fixture({ actor, allowlist: ["model-a"] });
    const response = await f.handlers.GET(
      new Request("http://localhost"),
      context()
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()) as TeamModelsResponse, {
      modelAllowlist: ["model-a"],
      viewer: { canManage: actor === "owner" || actor === "admin" },
    });
    assert.deepEqual(f.writes, []);
  });
}

for (const [input, expected] of [
  [null, null],
  [[], []],
  [
    [" model-b ", "model-a", "model-b"],
    ["model-a", "model-b"],
  ],
] as const) {
  test(`team models PATCH preserves normalized allowlist ${JSON.stringify(input)}`, async () => {
    const f = fixture({ allowlist: ["model-a"] });
    const response = await f.handlers.PATCH(
      request({ model_allowlist: input, team_id: "other-team" }),
      context()
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(f.writes, [{ model_allowlist: expected }]);
    assert.deepEqual(f.audits[0]?.payload, {
      from_model_allowlist: ["model-a"],
      to_model_allowlist: expected,
    });
    assert.equal(f.audits[0]?.action, "model_allowlist.changed");
    assert.equal(f.audits[0]?.productTeamId, teamId);
    assert.equal(f.audits[0]?.targetId, teamId);
    assert.equal(
      f.reads.includes("ai_models"),
      Array.isArray(input) && input.length > 0
    );
  });
}

test("team models PATCH allows admin management", async () => {
  const f = fixture({ actor: "admin" });
  assert.equal(
    (await f.handlers.PATCH(request({ model_allowlist: null }), context()))
      .status,
    200
  );
  assert.equal(f.writes.length, 1);
});

for (const body of [
  null,
  [],
  false,
  "models",
  {},
  { model_allowlist: true },
  { model_allowlist: "model-a" },
  { model_allowlist: [12] },
  { model_allowlist: [null] },
  { model_allowlist: [""] },
  { model_allowlist: ["  "] },
]) {
  test(`team models PATCH rejects invalid body ${JSON.stringify(body)} with flattened errors`, async () => {
    const f = fixture();
    const response = await f.handlers.PATCH(request(body), context());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid model list.");
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

test("team models PATCH keeps malformed JSON at 400", async () => {
  const f = fixture();
  const response = await f.handlers.PATCH(
    new Request("http://localhost", { method: "PATCH", body: "{" }),
    context()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  assert.deepEqual(f.reads, []);
});

for (const method of ["GET", "PATCH"] as const) {
  test(`team models ${method} requires sign-in before validation`, async () => {
    const f = fixture();
    const handlers = createTeamModelHandlers({
      ...f.deps,
      requireProfileId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        throw new Error("Unsigned lookup");
      },
    });
    assert.equal(
      (await handlers[method](request(null), context("bad"))).status,
      401
    );
    assert.deepEqual(f.reads, []);
  });

  test(`team models ${method} rejects invalid team IDs before database access`, async () => {
    const f = fixture();
    const handlers = createTeamModelHandlers({
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
    assert.deepEqual(f.writes, []);
  });

  test(`team models ${method} rejects nonmembers before database access`, async () => {
    const f = fixture();
    const handlers = createTeamModelHandlers({
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
    assert.deepEqual(f.writes, []);
  });

  for (const options of [{ failRead: true }, { missingTeam: true }]) {
    test(`team models ${method} preserves read error ${JSON.stringify(options)}`, async () => {
      const f = fixture(options);
      const response = await f.handlers[method](
        request({ model_allowlist: null }),
        context()
      );
      assert.equal(response.status, options.failRead ? 500 : 404);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.audits, []);
    });
  }
}

for (const actor of ["developer", "viewer"] as const) {
  test(`team models PATCH denies ${actor} before body validation`, async () => {
    const f = fixture({ actor });
    assert.equal(
      (await f.handlers.PATCH(request(null), context())).status,
      403
    );
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
  });
}

test("team models PATCH keeps unknown catalog IDs at 422 without writes", async () => {
  const f = fixture({ missingIds: true });
  const response = await f.handlers.PATCH(
    request({ model_allowlist: ["model-a", "model-b"] }),
    context()
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Unknown model IDs: model-b",
  });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
});

test("team models PATCH reports catalog lookup failure without writes", async () => {
  const f = fixture({ failModels: true });
  assert.equal(
    (
      await f.handlers.PATCH(
        request({ model_allowlist: ["model-a"] }),
        context()
      )
    ).status,
    500
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
});

test("team models PATCH reports write failure without an audit", async () => {
  const f = fixture({ failWrite: true });
  assert.equal(
    (await f.handlers.PATCH(request({ model_allowlist: null }), context()))
      .status,
    500
  );
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.audits, []);
});
