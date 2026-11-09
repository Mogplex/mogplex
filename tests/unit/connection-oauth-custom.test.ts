import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";
import { decrypt, encrypt } from "../../lib/connections/encryption";

type FetchInput = string | URL | Request;

// A public IP literal skips the outbound DNS check, so these tests never
// depend on name resolution (lib/security/outbound-url.ts).
const MCP_ORIGIN = "https://203.0.113.10";
const MCP_URL = `${MCP_ORIGIN}/mcp`;
const TOKEN_URL = `${MCP_ORIGIN}/oauth/token`;

function createCustomConnection(
  overrides: Partial<Connection> = {}
): Connection {
  return {
    id: "conn-custom",
    user_id: "user-1",
    name: "Custom MCP",
    type: "mcp_server",
    base_url: null,
    auth_type: "oauth",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: MCP_URL,
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
    created_at: "2026-11-09T00:00:00.000Z",
    updated_at: "2026-11-09T00:00:00.000Z",
    ...overrides,
  } as Connection;
}

async function loadOAuthHelpers() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  // Test-only key so connection-encryption helpers can run in isolation.
  process.env.CONNECTIONS_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return import("../../lib/connections/oauth");
}

function fetchUrl(input: FetchInput) {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

const DISCOVERED_ENDPOINTS = {
  authorization_endpoint: `${MCP_ORIGIN}/oauth/authorize`,
  token_endpoint: TOKEN_URL,
  registration_endpoint: `${MCP_ORIGIN}/oauth/register`,
};

/**
 * Prepares a custom MCP row against a stubbed MCP server that publishes its
 * authorization server (with `endpoints`) and registers clients with
 * `registered` as the reply.
 */
async function prepareWithDiscovery(
  registered: Record<string, unknown>,
  endpoints: Record<string, unknown> = DISCOVERED_ENDPOINTS
) {
  const helpers = await loadOAuthHelpers();
  const originalFetch = global.fetch;
  const updates: Array<Record<string, unknown>> = [];
  let registration: Record<string, unknown> | undefined;
  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url = fetchUrl(input);
    if (url === `${MCP_URL}/.well-known/oauth-protected-resource`)
      return Response.json({}, { status: 404 });
    if (url === `${MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp`)
      return Response.json({
        resource: MCP_URL,
        authorization_servers: [MCP_ORIGIN],
      });
    if (url === `${MCP_ORIGIN}/.well-known/oauth-authorization-server`)
      return Response.json(endpoints);
    if (url === `${MCP_ORIGIN}/oauth/register`) {
      registration = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(registered);
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      updates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const prepared = await helpers.prepareOAuthConnection(
      createCustomConnection(),
      {
        redirectUri: "https://mogplex.example/api/connections/oauth/callback",
        origin: "https://mogplex.example",
      }
    );
    return { helpers, prepared, updates, registration };
  } finally {
    global.fetch = originalFetch;
  }
}

function storedCredentials(update: Record<string, unknown> | undefined) {
  assert.equal(typeof update?.encrypted_credentials, "string");
  return JSON.parse(decrypt(String(update?.encrypted_credentials))) as Record<
    string,
    unknown
  >;
}

test("should discover and register a custom MCP server as a public PKCE client", async () => {
  const { helpers, prepared, updates, registration } =
    await prepareWithDiscovery({ client_id: "custom-registered-client" });

  assert.equal(prepared.connection.oauth_client_id, "custom-registered-client");
  assert.equal(
    prepared.connection.oauth_authorize_url,
    `${MCP_ORIGIN}/oauth/authorize`
  );
  assert.ok(prepared.codeVerifier, "custom MCP sign-in always uses PKCE");
  assert.equal(registration?.token_endpoint_auth_method, "none");
  assert.equal(updates.at(-1)?.oauth_client_id, "custom-registered-client");
  assert.equal(helpers.getOAuthResourceIndicator(prepared.connection), MCP_URL);
});

test("should replace a saved client secret when Mogplex registers a new public client", async () => {
  const { updates } = await prepareWithDiscovery({
    client_id: "custom-registered-client",
  });

  // The registration write replaces the row's credentials, so a secret saved
  // without a client id is never sent for the new public client.
  assert.deepEqual(storedCredentials(updates.at(-1)), {});
});

test("should keep the secret a registration issues for a custom MCP client", async () => {
  const { updates } = await prepareWithDiscovery({
    client_id: "custom-confidential-client",
    client_secret: "issued-secret",
  });

  assert.deepEqual(storedCredentials(updates.at(-1)), {
    client_secret: "issued-secret",
  });
});

for (const [field, value, reason] of [
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- rejection-path fixture
  ["authorization_endpoint", "http://203.0.113.10/oauth/authorize", /https/],
  // eslint-disable-next-line no-script-url -- rejection-path fixture
  ["authorization_endpoint", "javascript:alert(1)", /http or https/],
  ["authorization_endpoint", "https://localhost/oauth/authorize", /public/],
  ["token_endpoint", "https://127.0.0.1/oauth/token", /public/],
  ["token_endpoint", "https://10.0.0.5/oauth/token", /public/],
] as const) {
  test(`should fail sign-in when discovery advertises ${field} ${value}`, async () => {
    const attempt = prepareWithDiscovery(
      { client_id: "never-registered" },
      { ...DISCOVERED_ENDPOINTS, [field]: value }
    );

    await assert.rejects(attempt, (error: Error) => {
      assert.match(error.message, new RegExp(`^${field} `));
      assert.match(error.message, reason);
      // The message names the field, never the advertised URL.
      assert.ok(!error.message.includes(value));
      return true;
    });
  });
}

test("should leave non-MCP and non-OAuth custom connections out of browser sign-in", async () => {
  const { prepareOAuthConnection, getOAuthResourceIndicator } =
    await loadOAuthHelpers();
  for (const connection of [
    createCustomConnection({ type: "rest_api", mcp_url: null }),
    createCustomConnection({ auth_type: "bearer" }),
  ]) {
    const prepared = await prepareOAuthConnection(connection, {
      redirectUri: "https://mogplex.example/api/connections/oauth/callback",
      origin: "https://mogplex.example",
    });
    assert.equal(prepared.codeVerifier, null);
    assert.equal(prepared.connection, connection);
    assert.equal(getOAuthResourceIndicator(connection), undefined);
  }
});

type StoredState = {
  encrypted_credentials: string;
  updated_at: string;
  oauth_authorized_at: string | null;
  oauth_token_expires_at: string | null;
};

/**
 * Runs `run` against a stubbed authorization server and an in-memory row whose
 * credentials start as `credentials`. Returns every token request body and the
 * row's final credentials.
 */
async function withTokenServer(
  credentials: Record<string, unknown>,
  run: (
    helpers: Awaited<ReturnType<typeof loadOAuthHelpers>>,
    initial: StoredState
  ) => Promise<unknown>
) {
  const helpers = await loadOAuthHelpers();
  const originalFetch = global.fetch;
  let row: StoredState = {
    encrypted_credentials: encrypt(JSON.stringify(credentials)),
    updated_at: "2026-11-09T00:00:00.000Z",
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
  };
  const initial = row;
  const tokenBodies: URLSearchParams[] = [];
  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url = fetchUrl(input);
    if (url === TOKEN_URL) {
      tokenBodies.push(new URLSearchParams(String(init?.body)));
      return Response.json({
        access_token: `access-${tokenBodies.length}`,
        refresh_token: `refresh-${tokenBodies.length}`,
      });
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      if (init?.method === "PATCH") {
        const update = JSON.parse(String(init.body)) as Partial<StoredState>;
        row = { ...row, ...update, updated_at: `${row.updated_at}+` };
      }
      return Response.json(row);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    await run(helpers, initial);
  } finally {
    global.fetch = originalFetch;
  }
  return {
    tokenBodies,
    credentials: JSON.parse(decrypt(row.encrypted_credentials)) as Record<
      string,
      unknown
    >,
  };
}

/** Signs in through the code exchange, stores the tokens, then refreshes. */
function signInThenRefresh(
  connection: Connection,
  credentials: Record<string, unknown> = {}
) {
  return withTokenServer(credentials, async (helpers, initial) => {
    const tokens = await helpers.exchangeCodeForTokens(
      connection,
      "authorization-code",
      "https://mogplex.example/api/connections/oauth/callback",
      { codeVerifier: "pkce-verifier" }
    );
    await helpers.storeOAuthTokensWithRetry(connection.id, initial, tokens);
    await helpers.refreshOAuthToken(connection);
  });
}

const signedInEndpoints = {
  oauth_authorize_url: `${MCP_ORIGIN}/oauth/authorize`,
  oauth_token_url: TOKEN_URL,
};

test("should refresh with the resource when a registered custom client signed in with it", async () => {
  const { tokenBodies, credentials } = await signInThenRefresh(
    createCustomConnection({
      ...signedInEndpoints,
      oauth_client_id: "custom-registered-client",
    })
  );

  const [exchange, refresh] = tokenBodies;
  assert.equal(exchange?.get("grant_type"), "authorization_code");
  assert.equal(exchange?.get("resource"), MCP_URL);
  assert.equal(credentials.resource_indicator, true);
  assert.equal(refresh?.get("grant_type"), "refresh_token");
  assert.equal(refresh?.get("resource"), MCP_URL);
});

test("should refresh with the resource when a hand-configured custom client signed in with it", async () => {
  const { tokenBodies } = await signInThenRefresh(
    createCustomConnection({
      ...signedInEndpoints,
      oauth_client_id: "hand-configured-client",
    }),
    { client_secret: "hand-configured-secret" }
  );

  const [exchange, refresh] = tokenBodies;
  assert.equal(exchange?.get("client_secret"), "hand-configured-secret");
  assert.equal(exchange?.get("resource"), MCP_URL);
  assert.equal(refresh?.get("resource"), MCP_URL);
});

test("should refresh tokens from before the exchange recorded the resource without it", async () => {
  const { tokenBodies } = await withTokenServer(
    { refresh_token: "legacy-refresh-token" },
    (helpers) =>
      helpers.refreshOAuthToken(
        createCustomConnection({
          ...signedInEndpoints,
          oauth_client_id: "hand-configured-client",
        })
      )
  );

  assert.equal(tokenBodies.length, 1);
  assert.equal(tokenBodies[0]?.get("refresh_token"), "legacy-refresh-token");
  assert.equal(tokenBodies[0]?.get("resource"), null);
});

test("should clear the resource marker when a later sign-in does not name a resource", async () => {
  // Notion's preset does not declare a resource indicator.
  const { tokenBodies, credentials } = await signInThenRefresh(
    createCustomConnection({
      ...signedInEndpoints,
      source_preset: "notion",
      oauth_client_id: "notion-client",
    }),
    { resource_indicator: true }
  );

  assert.equal(tokenBodies[0]?.get("resource"), null);
  assert.equal(credentials.resource_indicator, undefined);
  assert.equal(tokenBodies[1]?.get("resource"), null);
});

test("should keep the resource indicator on refresh for presets that declare it", async () => {
  const { tokenBodies } = await withTokenServer(
    { refresh_token: "preset-refresh-token" },
    (helpers) =>
      helpers.refreshOAuthToken(
        createCustomConnection({
          ...signedInEndpoints,
          source_preset: "sentry",
          oauth_client_id: "sentry-client",
        })
      )
  );

  assert.equal(tokenBodies[0]?.get("resource"), MCP_URL);
});
