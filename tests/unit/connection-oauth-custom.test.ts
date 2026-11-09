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

/**
 * Prepares a custom MCP row against a stubbed MCP server that publishes its
 * authorization server and registers clients with `registered` as the reply.
 */
async function prepareWithDiscovery(registered: Record<string, unknown>) {
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
      return Response.json({
        authorization_endpoint: `${MCP_ORIGIN}/oauth/authorize`,
        token_endpoint: TOKEN_URL,
        registration_endpoint: `${MCP_ORIGIN}/oauth/register`,
      });
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
  assert.deepEqual(storedCredentials(updates.at(-1)), {
    registered_client: true,
  });
});

test("should keep the secret a registration issues for a custom MCP client", async () => {
  const { updates } = await prepareWithDiscovery({
    client_id: "custom-confidential-client",
    client_secret: "issued-secret",
  });

  assert.deepEqual(storedCredentials(updates.at(-1)), {
    client_secret: "issued-secret",
    registered_client: true,
  });
});

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

/**
 * Runs one token request against a stubbed authorization server and returns
 * the form body it received plus the credential writes that followed. Stored
 * credentials hold a refresh token and any extra `credentials`.
 */
async function captureTokenRequest(
  run: (
    helpers: Awaited<ReturnType<typeof loadOAuthHelpers>>
  ) => Promise<unknown>,
  credentials: Record<string, unknown> = {}
) {
  const helpers = await loadOAuthHelpers();
  const originalFetch = global.fetch;
  const stored = {
    encrypted_credentials: encrypt(
      JSON.stringify({ refresh_token: "stored-refresh-token", ...credentials })
    ),
    updated_at: "2026-11-09T00:00:00.000Z",
    oauth_authorized_at: "2026-11-09T00:00:00.000Z",
    oauth_token_expires_at: "2026-11-09T01:00:00.000Z",
  };
  const refreshed = {
    ...stored,
    encrypted_credentials: encrypt(
      JSON.stringify({ access_token: "fresh-access-token" })
    ),
  };
  let tokenBody: URLSearchParams | undefined;
  const writes: Array<Record<string, unknown>> = [];
  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url = fetchUrl(input);
    if (url === TOKEN_URL) {
      tokenBody = new URLSearchParams(String(init?.body));
      return Response.json({ access_token: "fresh-access-token" });
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      if (init?.method !== "PATCH") return Response.json(stored);
      writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json(refreshed);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    await run(helpers);
  } finally {
    global.fetch = originalFetch;
  }
  assert.ok(tokenBody, "the token endpoint was called");
  return { body: tokenBody, writes };
}

const registeredCustomConnection = createCustomConnection({
  oauth_client_id: "custom-registered-client",
  oauth_authorize_url: `${MCP_ORIGIN}/oauth/authorize`,
  oauth_token_url: TOKEN_URL,
});

test("should name the custom MCP server as the resource when exchanging the code", async () => {
  const { body } = await captureTokenRequest(({ exchangeCodeForTokens }) =>
    exchangeCodeForTokens(
      registeredCustomConnection,
      "authorization-code",
      "https://mogplex.example/api/connections/oauth/callback",
      { codeVerifier: "pkce-verifier" }
    )
  );

  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("resource"), MCP_URL);
});

test("should refresh with the resource indicator when Mogplex registered the custom MCP client", async () => {
  const { body, writes } = await captureTokenRequest(
    ({ refreshOAuthToken }) => refreshOAuthToken(registeredCustomConnection),
    { registered_client: true }
  );

  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("resource"), MCP_URL);
  // The marker survives the token write, so the next refresh still sends it.
  assert.equal(storedCredentials(writes.at(-1)).registered_client, true);
});

test("should refresh a hand-configured custom MCP client without the resource indicator", async () => {
  const { body } = await captureTokenRequest(({ refreshOAuthToken }) =>
    refreshOAuthToken(registeredCustomConnection)
  );

  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), "stored-refresh-token");
  assert.equal(body.get("resource"), null);
});

test("should keep the resource indicator on refresh for presets that declare it", async () => {
  const { body } = await captureTokenRequest(({ refreshOAuthToken }) =>
    refreshOAuthToken({
      ...registeredCustomConnection,
      source_preset: "sentry",
    })
  );

  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("resource"), MCP_URL);
});
