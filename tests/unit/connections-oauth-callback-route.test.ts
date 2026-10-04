import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { createConnectionOAuthCallbackGetHandler } from "../../app/api/connections/oauth/callback/route";
import { encrypt, decrypt } from "../../lib/connections/encryption";
import type { Connection } from "../../lib/types";

const id = "00000000-0000-4000-8000-000000000001";
const nonce = "00000000-0000-4000-8000-000000000002";
const validState = { connectionId: id, nonce, userId: "user-1" };
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
  auth_type: "oauth",
  auth_header: null,
  mcp_transport: null,
  mcp_url: null,
  description: null,
  is_enabled: true,
  approval_mode: "auto",
  health_status: "unknown",
  scope: "global",
  repo_id: null,
  oauth_client_id: "synthetic-client",
  oauth_authorize_url: "https://8.8.8.8/authorize",
  oauth_token_url: "https://8.8.8.8/token",
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
function fixture(
  options: {
    state?: string;
    missingCookie?: boolean;
    user?: string | null;
    missing?: boolean;
    failRead?: boolean;
    failExchange?: boolean;
    failWrite?: boolean;
    conflict?: boolean;
    pkce?: boolean;
  } = {}
) {
  const state = options.state ?? btoa(JSON.stringify(validState));
  const reads: string[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const writes: Record<string, unknown>[] = [];
  let authCalls = 0;
  const encrypted = encrypt(
    JSON.stringify({ client_secret: "synthetic-client-secret" })
  );
  activeFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://8.8.8.8") {
      assert.equal(url.pathname, "/token");
      assert.equal(init?.method, "POST");
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return options.failExchange
        ? Response.json({ error: "synthetic_failure" }, { status: 401 })
        : Response.json({
            access_token: "synthetic-access-token",
            refresh_token: "synthetic-refresh-token",
            expires_in: 3600,
          });
    }
    assert.equal(url.origin, "https://database.example");
    assert.equal(url.pathname, "/rest/v1/connections");
    if (init?.method === "PATCH") {
      assert.equal(url.searchParams.get("id"), `eq.${id}`);
      assert.equal(url.searchParams.get("updated_at"), "eq.2026-02-01");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push(body);
      return options.failWrite
        ? Response.json(
            { message: "Write failed", code: "XX000" },
            { status: 500 }
          )
        : options.conflict
          ? Response.json(
              {
                code: "PGRST116",
                message:
                  "JSON object requested, multiple (or no) rows returned",
                details: "The result contains 0 rows",
              },
              { status: 406 }
            )
          : Response.json(body);
    }
    reads.push(url.search);
    if (options.failRead)
      return Response.json(
        { message: "Read failed", code: "XX000" },
        { status: 500 }
      );
    const select = url.searchParams.get("select");
    if (select === "*,encrypted_credentials") {
      assert.equal(url.searchParams.get("user_id"), "eq.user-1");
      return Response.json(
        options.missing ? null : { ...row, encrypted_credentials: encrypted }
      );
    }
    if (select === "encrypted_credentials")
      return Response.json({ encrypted_credentials: encrypted });
    return Response.json([
      {
        encrypted_credentials: encrypted,
        updated_at: row.updated_at,
        oauth_authorized_at: null,
        oauth_token_expires_at: null,
      },
    ]);
  };
  const deps = {
    getUserId: async () => {
      authCalls++;
      return options.user === undefined
        ? "user-1"
        : (options.user ?? undefined);
    },
    getCookies: async () => ({
      get: (name: string) => {
        if (name === "conn_oauth_state")
          return options.missingCookie ? undefined : { value: state };
        return options.pkce ? { value: "synthetic-pkce-verifier" } : undefined;
      },
    }),
  };
  const request = (
    query = `code=synthetic-code&state=${encodeURIComponent(state)}`
  ) =>
    new Request(
      `https://app.example.com/api/connections/oauth/callback?${query}`
    );
  return {
    handler: createConnectionOAuthCallbackGetHandler(deps),
    request,
    reads,
    tokenRequests,
    writes,
    authCalls: () => authCalls,
  };
}
function assertRedirect(response: Response, result: string) {
  assert.equal(response.status, 307);
  assert.equal(
    new URL(response.headers.get("location")!).searchParams.get("oauth"),
    result
  );
  const cleared = response.headers.get("set-cookie") ?? "";
  assert.ok(cleared.includes("conn_oauth_state=; Path=/; Max-Age=0"));
  assert.ok(cleared.includes("conn_oauth_pkce_verifier=; Path=/; Max-Age=0"));
}

for (const pkce of [false, true]) {
  test(`OAuth callback exchanges code and stores encrypted tokens after ownership (PKCE ${pkce})`, async () => {
    const f = fixture({ pkce });
    assertRedirect(await f.handler(f.request()), "success");
    assert.equal(f.tokenRequests.length, 1);
    const token = f.tokenRequests[0]!;
    assert.equal(token.get("grant_type"), "authorization_code");
    assert.equal(token.get("client_id"), "synthetic-client");
    assert.equal(token.get("code"), "synthetic-code");
    assert.equal(token.get("client_secret"), "synthetic-client-secret");
    assert.equal(
      token.get("code_verifier"),
      pkce ? "synthetic-pkce-verifier" : null
    );
    assert.ok(
      token.get("redirect_uri")?.endsWith("/api/connections/oauth/callback")
    );
    assert.equal(f.writes.length, 1);
    const saved = f.writes[0]!;
    assert.equal(saved.auth_type, "oauth");
    assert.deepEqual(JSON.parse(decrypt(String(saved.encrypted_credentials))), {
      client_secret: "synthetic-client-secret",
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
    });
    assert.ok(!Number.isNaN(Date.parse(String(saved.oauth_authorized_at))));
    assert.ok(!Number.isNaN(Date.parse(String(saved.oauth_token_expires_at))));
    assert.equal(f.authCalls(), 1);
  });
}

for (const decoded of [
  null,
  {},
  [],
  { userId: "user-1", nonce },
  { ...validState, connectionId: 3 },
  { ...validState, connectionId: "bad" },
  { ...validState, nonce: undefined },
  { ...validState, nonce: 1 },
  { ...validState, nonce: "bad" },
  { ...validState, userId: 3 },
]) {
  test(`OAuth callback rejects malformed decoded state before ownership/token calls: ${JSON.stringify(decoded)}`, async () => {
    const f = fixture({ state: btoa(JSON.stringify(decoded)) });
    assertRedirect(await f.handler(f.request()), "invalid_state");
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.tokenRequests, []);
    assert.deepEqual(f.writes, []);
  });
}

for (const query of [
  "",
  "code=synthetic-code",
  "state=wrong",
  "code=synthetic-code&state=wrong",
]) {
  test(`OAuth callback retains missing/mismatched CSRF query redirect: ${query}`, async () => {
    const f = fixture();
    assertRedirect(await f.handler(f.request(query)), "invalid_state");
    assert.equal(f.authCalls(), 0);
    assert.deepEqual(f.reads, []);
  });
}

test("OAuth callback retains missing stored state denial", async () => {
  const f = fixture({ missingCookie: true });
  assertRedirect(await f.handler(f.request()), "invalid_state");
  assert.equal(f.authCalls(), 0);
});

for (const state of ["%%%", btoa("not JSON")]) {
  test(`OAuth callback retains malformed base64/JSON state denial: ${state}`, async () => {
    const f = fixture({ state });
    assertRedirect(await f.handler(f.request()), "invalid_state");
    assert.deepEqual(f.reads, []);
  });
}

test("OAuth callback retains session-user mismatch denial before ownership", async () => {
  const f = fixture({
    state: btoa(JSON.stringify({ ...validState, userId: "other-user" })),
  });
  assertRedirect(await f.handler(f.request()), "invalid_state");
  assert.deepEqual(f.reads, []);
});

test("OAuth callback retains unauthenticated login redirect and cookie clearing", async () => {
  const f = fixture({ user: null });
  const response = await f.handler(f.request());
  assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  assert.equal(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "unauthorized"
  );
  assert.ok(response.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.deepEqual(f.reads, []);
});

for (const options of [{ missing: true }, { failRead: true }]) {
  test(`OAuth callback retains missing owned row redirect (${JSON.stringify(options)})`, async () => {
    const f = fixture(options);
    assertRedirect(await f.handler(f.request()), "not_found");
    assert.deepEqual(f.tokenRequests, []);
    assert.deepEqual(f.writes, []);
  });
}

for (const options of [
  { failExchange: true },
  { failWrite: true },
  { conflict: true },
]) {
  test(`OAuth callback retains token_error redirect on exchange/persistence failure (${JSON.stringify(options)})`, async () => {
    const f = fixture(options);
    assertRedirect(await f.handler(f.request()), "token_error");
    assert.equal(f.tokenRequests.length, 1);
    if (options.conflict) assert.equal(f.writes.length, 2);
    if (options.failExchange) assert.equal(f.writes.length, 0);
  });
}
