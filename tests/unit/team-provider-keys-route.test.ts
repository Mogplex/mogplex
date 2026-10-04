import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { NextResponse } from "next/server";
import { createTeamProviderKeyHandlers } from "../../app/api/teams/[teamId]/keys/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = (id = teamId) => ({ params: Promise.resolve({ teamId: id }) });
const envNames = [
  "MOGPLEX_DATA_BACKEND",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const oldEnv = envNames.map((name) => process.env[name]);
process.env.MOGPLEX_DATA_BACKEND = "supabase";
process.env.SUPABASE_URL = "https://database.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
let activeFetch: typeof fetch = async (_input, _init) => {
  throw new Error("Unexpected network request");
};
const network = mock.method(globalThis, "fetch", ((input, init) =>
  activeFetch(input, init)) as typeof fetch);
after(() => {
  network.mock.restore();
  for (const [i, name] of envNames.entries()) {
    if (oldEnv[i] === undefined) delete process.env[name];
    else process.env[name] = oldEnv[i];
  }
});

function fixture(
  options: { actor?: TeamRole; fail?: boolean; empty?: boolean } = {}
) {
  const calls: { method: string; url: URL; body?: Record<string, unknown> }[] =
    [];
  const audits: RecordTeamAuditEventInput[] = [];
  activeFetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://database.example");
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ method, url, body });
    if (options.fail)
      return Response.json(
        { message: "Vault unavailable", code: "XX000" },
        { status: 500 }
      );
    if (method === "GET") {
      assert.equal(url.pathname, "/rest/v1/team_provider_keys");
      assert.equal(url.searchParams.get("team_id"), `eq.${teamId}`);
      assert.equal(
        url.searchParams.get("select"),
        "provider,created_at,updated_at"
      );
      assert.equal(url.searchParams.get("order"), "provider.asc");
      return Response.json(
        options.empty
          ? []
          : [
              {
                provider: "openai",
                created_at: "2026-01-01",
                updated_at: "2026-02-01",
              },
            ]
      );
    }
    assert.ok(
      [
        "/rest/v1/rpc/store_team_provider_key",
        "/rest/v1/rpc/delete_team_provider_key",
      ].includes(url.pathname)
    );
    return new Response(null, { status: 204 });
  };
  const actor = options.actor ?? "owner";
  const deps = {
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
  return { deps, handlers: createTeamProviderKeyHandlers(deps), calls, audits };
}
const request = (method: "PUT" | "DELETE", body: unknown) =>
  new Request("http://localhost", { method, body: JSON.stringify(body) });

for (const actor of ["owner", "admin", "developer", "viewer"] as const) {
  test(`key GET returns metadata and capabilities to ${actor}`, async () => {
    const f = fixture({ actor });
    const response = await f.handlers.GET(
      new Request("http://localhost"),
      context()
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      keys: [
        {
          provider: "openai",
          created_at: "2026-01-01",
          updated_at: "2026-02-01",
        },
      ],
      viewer: {
        role: actor,
        canManage: actor === "owner" || actor === "admin",
      },
    });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.audits, []);
  });
}

for (const provider of [
  "ai_gateway",
  "anthropic",
  "openai",
  "openrouter",
] as const) {
  for (const method of ["PUT", "DELETE"] as const) {
    test(`key ${method} supports ${provider} with scoped vault RPC and secret-free audit`, async () => {
      const f = fixture({ actor: "admin" });
      const response = await f.handlers[method](
        request(method, {
          provider,
          key: "  synthetic-test-key  ",
          team_id: "other-team",
        }),
        context()
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(f.calls.length, 1);
      assert.equal(
        f.calls[0]?.url.pathname,
        `/rest/v1/rpc/${method === "PUT" ? "store" : "delete"}_team_provider_key`
      );
      assert.deepEqual(
        f.calls[0]?.body,
        method === "PUT"
          ? {
              p_team_id: teamId,
              p_provider: provider,
              p_key: "synthetic-test-key",
            }
          : { p_team_id: teamId, p_provider: provider }
      );
      assert.deepEqual(f.audits, [
        {
          productTeamId: teamId,
          actorUserId: "user-1",
          action:
            method === "PUT"
              ? "team_provider_key.updated"
              : "team_provider_key.deleted",
          targetType: "provider_key",
          targetId: provider,
          payload: { provider },
        },
      ]);
    });
  }
}

for (const method of ["PUT", "DELETE"] as const) {
  const invalidBodies: unknown[] = [
    null,
    [],
    false,
    "key",
    {},
    { provider: "bad" },
    { provider: 1 },
    { provider: " openai " },
  ];
  if (method === "PUT")
    invalidBodies.push(
      { provider: "openai" },
      { provider: "openai", key: null },
      { provider: "openai", key: 3 },
      { provider: "openai", key: "   " }
    );
  for (const body of invalidBodies) {
    test(`key ${method} rejects ${JSON.stringify(body)} before vault access with flattened errors`, async () => {
      const f = fixture();
      const response = await f.handlers[method](
        request(method, body),
        context()
      );
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error, "Invalid provider key.");
      assert.ok(
        result.details.formErrors.length > 0 ||
          Object.values(result.details.fieldErrors).some(
            (errors) => Array.isArray(errors) && errors.length > 0
          )
      );
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.audits, []);
    });
  }
  test(`key ${method} retains malformed JSON at 400`, async () => {
    const f = fixture();
    const response = await f.handlers[method](
      new Request("http://localhost", { method, body: "{" }),
      context()
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
    assert.deepEqual(f.calls, []);
  });
  for (const actor of ["developer", "viewer"] as const) {
    test(`key ${method} rejects ${actor} before parsing invalid JSON`, async () => {
      const f = fixture({ actor });
      const response = await f.handlers[method](
        new Request("http://localhost", { method, body: "{" }),
        context()
      );
      assert.equal(response.status, 403);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.audits, []);
    });
  }
}

for (const method of ["GET", "PUT", "DELETE"] as const) {
  const req = () =>
    method === "GET"
      ? new Request("http://localhost")
      : request(method, { provider: "openai", key: "synthetic-test-key" });
  test(`key ${method} retains sign-in before UUID validation`, async () => {
    const f = fixture();
    const handlers = createTeamProviderKeyHandlers({
      ...f.deps,
      requireProfileId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        throw new Error("Must not check membership");
      },
    });
    assert.equal(
      (await handlers[method](req(), context("bad-team"))).status,
      401
    );
    assert.deepEqual(f.calls, []);
  });
  test(`key ${method} rejects invalid team UUID before membership or vault reads`, async () => {
    const f = fixture();
    const handlers = createTeamProviderKeyHandlers({
      ...f.deps,
      loadTeamMembershipAuth: async () => {
        throw new Error("Must not check membership");
      },
    });
    const response = await handlers[method](req(), context("bad-team"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid team ID.",
      details: { formErrors: [], fieldErrors: { teamId: ["Invalid uuid"] } },
    });
    assert.deepEqual(f.calls, []);
  });
  for (const status of [403, 404, 500] as const) {
    test(`key ${method} preserves membership failure ${status}`, async () => {
      const f = fixture();
      const handlers = createTeamProviderKeyHandlers({
        ...f.deps,
        loadTeamMembershipAuth: async () => ({
          ok: false as const,
          error: "Membership failed",
          status,
        }),
      });
      const response = await handlers[method](req(), context());
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: "Membership failed" });
      assert.deepEqual(f.calls, []);
    });
  }
  test(`key ${method} returns 500 on vault failure without recording audit`, async () => {
    const f = fixture({ fail: true });
    const response = await f.handlers[method](req(), context());
    assert.equal(response.status, 500);
    assert.ok((await response.json()).error.includes("Vault unavailable"));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.audits, []);
  });
}

test("key GET retains empty key lists", async () => {
  const f = fixture({ empty: true });
  const response = await f.handlers.GET(
    new Request("http://localhost"),
    context()
  );
  assert.deepEqual(await response.json(), {
    keys: [],
    viewer: { role: "owner", canManage: true },
  });
});
