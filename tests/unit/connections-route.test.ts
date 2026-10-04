import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { NextResponse } from "next/server";
import { createConnectionHandlers } from "../../app/api/connections/route";
import { decrypt } from "../../lib/connections/encryption";
import type { Connection } from "../../lib/types";

const id = "00000000-0000-4000-8000-000000000001";
const repoId = "00000000-0000-4000-8000-000000000002";
const envNames = [
  "MOGPLEX_DATA_BACKEND",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CONNECTIONS_ENCRYPTION_KEY",
] as const;
const oldEnv = envNames.map((name) => process.env[name]);
process.env.MOGPLEX_DATA_BACKEND = "supabase";
process.env.SUPABASE_URL = "https://database.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
process.env.CONNECTIONS_ENCRYPTION_KEY = "11".repeat(32);
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
const row: Connection = {
  id,
  user_id: "user-1",
  name: "Example",
  type: "rest_api",
  base_url: "https://api.example.com",
  auth_type: "none",
  auth_header: null,
  mcp_transport: null,
  mcp_url: null,
  description: null,
  is_enabled: true,
  approval_mode: "auto",
  health_status: "unknown",
  scope: "global",
  repo_id: null,
  oauth_client_id: null,
  oauth_authorize_url: null,
  oauth_token_url: null,
  oauth_scopes: null,
  oauth_authorized_at: null,
  oauth_token_expires_at: null,
  source_preset: null,
  last_tested_at: null,
  last_test_error: null,
  last_test_http_status: null,
  last_test_tool_count: null,
  created_at: "2026-01-01",
  updated_at: "2026-02-01",
};
const validBody = {
  name: " Example ",
  type: "rest_api",
  base_url: "https://api.example.com",
  auth_type: "none",
};
const request = (method: "POST" | "PATCH" | "DELETE", body: unknown) =>
  new Request("http://localhost", { method, body: JSON.stringify(body) });
function fixture(
  options: {
    owns?: boolean;
    ownsRepo?: boolean;
    failRead?: boolean;
    failWrite?: boolean;
    duplicate?: boolean;
    cap?: boolean;
    empty?: boolean;
  } = {}
) {
  const calls: { method: string; url: URL; body?: Record<string, unknown> }[] =
    [];
  activeFetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://database.example");
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ method, url, body });
    if (
      (method === "GET" && options.failRead) ||
      (method !== "GET" && options.failWrite)
    )
      return Response.json(
        { message: "Database failed", code: "XX000" },
        { status: 500 }
      );
    if (url.pathname === "/rest/v1/repos") {
      assert.equal(url.searchParams.get("id"), `eq.${repoId}`);
      assert.equal(url.searchParams.get("user_id"), "eq.user-1");
      return Response.json(options.ownsRepo === false ? [] : [{ id: repoId }]);
    }
    assert.equal(url.pathname, "/rest/v1/connections");
    if (method === "GET") {
      if (url.searchParams.get("select") === "user_id") {
        assert.equal(url.searchParams.get("id"), `eq.${id}`);
        return Response.json({
          user_id: options.owns === false ? "other-user" : "user-1",
        });
      }
      assert.equal(url.searchParams.get("user_id"), "eq.user-1");
      if (url.searchParams.has("source_preset"))
        return Response.json(
          options.duplicate ? [{ ...row, source_preset: "notion" }] : []
        );
      return Response.json(
        options.cap
          ? Array.from({ length: 5 }, () => ({ ...row, type: "mcp_server" }))
          : options.empty
            ? []
            : [row]
      );
    }
    if (method === "POST") return Response.json(row, { status: 201 });
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    return new Response(null, { status: 204 });
  };
  const handlers = createConnectionHandlers({
    requireUserId: async () => "user-1",
  });
  return {
    handlers,
    calls,
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}

test("connection GET returns user-scoped metadata", async () => {
  const f = fixture();
  const response = await f.handlers.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connections: [row] });
  assert.equal(f.calls.length, 1);
  assert.ok(
    !f.calls[0]?.url.searchParams
      .get("select")
      ?.includes("encrypted_credentials")
  );
});

test("connection GET retains empty lists", async () => {
  const f = fixture({ empty: true });
  assert.deepEqual(await (await f.handlers.GET()).json(), { connections: [] });
});

for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
  test(`connection ${method} preserves sign-in before any read or validation`, async () => {
    const f = fixture();
    const handlers = createConnectionHandlers({
      requireUserId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response =
      method === "GET"
        ? await handlers.GET()
        : await handlers[method](request(method, null));
    assert.equal(response.status, 401);
    assert.deepEqual(f.calls, []);
  });
}

for (const credentials of [false, true]) {
  test(`connection POST normalizes input, scopes owner and encrypts credentials (${credentials})`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(
      request("POST", {
        ...validBody,
        auth_type: credentials ? "bearer" : "none",
        credentials: " synthetic-test-secret ",
        user_id: "other-user",
        id: "other-id",
      })
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { connection: row });
    const written = f.writes()[0]?.body;
    assert.equal(written?.user_id, "user-1");
    assert.equal(written?.name, "Example");
    assert.equal(written?.scope, "global");
    assert.equal(written?.id, undefined);
    assert.equal(written?.credentials, undefined);
    if (credentials)
      assert.equal(
        decrypt(String(written?.encrypted_credentials)),
        "synthetic-test-secret"
      );
    else assert.equal(written?.encrypted_credentials, null);
  });
}

for (const body of [
  null,
  [],
  {},
  { ...validBody, name: " " },
  { ...validBody, type: "bad" },
  { ...validBody, base_url: "http://127.0.0.1" },
  { ...validBody, auth_type: "bad" },
  { ...validBody, scope: "project" },
  { source_preset: "bad" },
]) {
  test(`connection POST rejects ${JSON.stringify(body)} with flattened errors before reads or writes`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(request("POST", body));
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid connection.");
    assert.ok(result.details.formErrors.length > 0);
    assert.deepEqual(f.calls, []);
  });
}

for (const ownsRepo of [true, false]) {
  test(`connection POST verifies project ownership (${ownsRepo})`, async () => {
    const f = fixture({ ownsRepo });
    const response = await f.handlers.POST(
      request("POST", { ...validBody, scope: "project", repo_id: repoId })
    );
    assert.equal(response.status, ownsRepo ? 201 : 404);
    assert.equal(f.writes().length, ownsRepo ? 1 : 0);
    if (ownsRepo) assert.equal(f.writes()[0]?.body?.repo_id, repoId);
  });
}

test("connection POST retains duplicate preset 409", async () => {
  const f = fixture({ duplicate: true });
  const response = await f.handlers.POST(
    request("POST", { source_preset: "notion" })
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PRESET_ALREADY_CONNECTED");
  assert.deepEqual(f.writes(), []);
});

test("connection POST retains existing MCP cap", async () => {
  const f = fixture({ cap: true });
  const response = await f.handlers.POST(
    request("POST", {
      name: "MCP",
      type: "mcp_server",
      mcp_url: "https://mcp.example.com",
    })
  );
  assert.equal(response.status, 400);
  assert.deepEqual(f.writes(), []);
});

for (const method of ["PATCH", "DELETE"] as const) {
  test(`connection ${method} applies only owner-authorized settings/deletion`, async () => {
    const f = fixture();
    const response = await f.handlers[method](
      request(method, {
        id,
        is_enabled: false,
        approval_mode: "ask",
        credentials: "ignored",
        user_id: "other-user",
        name: "ignored",
      })
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(f.writes().length, 1);
    const written = f.writes()[0]!;
    assert.equal(written.method, method);
    if (method === "PATCH") {
      assert.equal(written.body?.is_enabled, false);
      assert.equal(written.body?.approval_mode, "ask");
      assert.ok(!Number.isNaN(Date.parse(String(written.body?.updated_at))));
      assert.deepEqual(Object.keys(written.body ?? {}).sort(), [
        "approval_mode",
        "is_enabled",
        "updated_at",
      ]);
    }
  });
  for (const body of [null, [], {}, { id: 1 }, { id: "bad-id" }]) {
    test(`connection ${method} rejects invalid ID body ${JSON.stringify(body)} before ownership lookup`, async () => {
      const f = fixture();
      const response = await f.handlers[method](request(method, body));
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error, "Invalid connection.");
      assert.ok(
        result.details.formErrors.length > 0 ||
          result.details.fieldErrors.id?.length > 0
      );
      assert.deepEqual(f.calls, []);
    });
  }
  test(`connection ${method} keeps non-owner denied before invalid settings`, async () => {
    const f = fixture({ owns: false });
    assert.equal(
      (await f.handlers[method](request(method, { id, is_enabled: "bad" })))
        .status,
      403
    );
    assert.deepEqual(f.writes(), []);
  });
}

for (const body of [
  { id },
  { id, is_enabled: "yes" },
  { id, approval_mode: "bad" },
]) {
  test(`connection PATCH validates settings after ownership: ${JSON.stringify(body)}`, async () => {
    const f = fixture();
    const response = await f.handlers.PATCH(request("PATCH", body));
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid connection.");
    assert.ok(result.details.formErrors.length > 0);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.writes(), []);
  });
}

for (const method of ["POST", "PATCH", "DELETE"] as const) {
  test(`connection ${method} rejects malformed JSON at 400`, async () => {
    const f = fixture();
    const response = await f.handlers[method](
      new Request("http://localhost", { method, body: "{" })
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON body." });
    assert.deepEqual(f.calls, []);
  });
  test(`connection ${method} preserves write failure at 500`, async () => {
    const f = fixture({ failWrite: true });
    const response = await f.handlers[method](
      request(method, method === "POST" ? validBody : { id, is_enabled: false })
    );
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "Database failed");
  });
}

test("connection GET retains database failure at 500", async () => {
  const f = fixture({ failRead: true });
  assert.equal((await f.handlers.GET()).status, 500);
});

test("connection POST retains credential configuration failure at 503 without write", async () => {
  const f = fixture();
  const previous = process.env.CONNECTIONS_ENCRYPTION_KEY;
  delete process.env.CONNECTIONS_ENCRYPTION_KEY;
  try {
    const response = await f.handlers.POST(
      request("POST", {
        ...validBody,
        auth_type: "bearer",
        credentials: "synthetic-test-secret",
      })
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "CONNECTIONS_UNAVAILABLE");
    assert.deepEqual(f.writes(), []);
  } finally {
    process.env.CONNECTIONS_ENCRYPTION_KEY = previous;
  }
});
