import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";
import { encrypt } from "../../lib/connections/encryption";

type FetchInput = string | URL | Request;

function createConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-oauth",
    user_id: "user-1",
    name: "Notion",
    type: "mcp_server",
    base_url: null,
    auth_type: "oauth",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.notion.com/mcp",
    description: "Connection",
    is_enabled: true,
    health_status: "unknown",
    scope: "global",
    repo_id: null,
    oauth_client_id: "client-123",
    oauth_authorize_url: "https://auth.notion.example/authorize",
    oauth_token_url: "https://auth.notion.example/token",
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: "notion",
    last_tested_at: null,
    last_test_error: null,
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: "2026-03-23T00:00:00.000Z",
    updated_at: "2026-03-23T00:00:00.000Z",
    ...overrides,
  };
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

function isStoredConnectionStateFetch(url: string) {
  return (
    url.startsWith("https://example.supabase.co/rest/v1/connections?") &&
    url.includes("id=eq.conn-oauth")
  );
}

test("buildAuthorizeUrl adds PKCE parameters and provider-specific authorize params", async () => {
  const { buildAuthorizeUrl, generatePkceChallenge } = await loadOAuthHelpers();
  const verifier = "verifier-123";
  const authorizeUrl = new URL(
    buildAuthorizeUrl(
      createConnection(),
      "https://mogplex.example/api/connections/oauth/callback",
      "state-123",
      {
        codeChallenge: generatePkceChallenge(verifier),
        authorizeParams: { prompt: "consent" },
        resource: "https://mcp.notion.com/mcp",
      }
    )
  );

  assert.equal(authorizeUrl.searchParams.get("client_id"), "client-123");
  assert.equal(authorizeUrl.searchParams.get("state"), "state-123");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("prompt"), "consent");
  assert.equal(
    authorizeUrl.searchParams.get("resource"),
    "https://mcp.notion.com/mcp"
  );
});

test("exchangeCodeForTokens binds the token request to the Sentry MCP resource", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (isStoredConnectionStateFetch(url)) {
      return Response.json({
        encrypted_credentials: encrypt(JSON.stringify({})),
      });
    }

    if (url === "https://mcp.sentry.dev/oauth/token") {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("resource"), "https://mcp.sentry.dev/mcp");
      assert.equal(body.get("code_verifier"), "pkce-verifier");
      return Response.json({
        access_token: "sentry-mcp-access-token",
        refresh_token: "sentry-mcp-refresh-token",
        expires_in: 3600,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { exchangeCodeForTokens } = await loadOAuthHelpers();
    const tokens = await exchangeCodeForTokens(
      createConnection({
        source_preset: "sentry",
        mcp_url: "https://mcp.sentry.dev/mcp",
        oauth_client_id: "sentry-client",
        oauth_authorize_url: "https://mcp.sentry.dev/oauth/authorize",
        oauth_token_url: "https://mcp.sentry.dev/oauth/token",
      }),
      "authorization-code",
      "https://mogplex.example/api/connections/oauth/callback",
      { codeVerifier: "pkce-verifier" }
    );

    assert.equal(tokens.access_token, "sentry-mcp-access-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("prepareOAuthConnection replaces legacy scopes with the native Sentry preset contract", async () => {
  const originalFetch = global.fetch;
  const updateBodies: Array<Record<string, unknown>> = [];

  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (
      url === "https://mcp.sentry.dev/mcp/.well-known/oauth-protected-resource"
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (
      url === "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://mcp.sentry.dev/mcp",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    }
    if (
      url === "https://mcp.sentry.dev/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        authorization_endpoint: "https://mcp.sentry.dev/oauth/authorize",
        token_endpoint: "https://mcp.sentry.dev/oauth/token",
        registration_endpoint: "https://mcp.sentry.dev/oauth/register",
      });
    }
    if (url === "https://mcp.sentry.dev/oauth/register") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.scope, "org:read project:write team:write event:write");
      return Response.json({ client_id: "native-sentry-client" });
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      updateBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>
      );
      return Response.json({});
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { prepareOAuthConnection } = await loadOAuthHelpers();
    const prepared = await prepareOAuthConnection(
      createConnection({
        source_preset: "sentry",
        mcp_url: "https://mcp.sentry.dev/mcp",
        oauth_client_id: null,
        oauth_authorize_url: null,
        oauth_token_url: null,
        oauth_scopes: "event:read",
      }),
      {
        redirectUri: "https://mogplex.example/api/connections/oauth/callback",
        origin: "https://mogplex.example",
      }
    );

    assert.equal(prepared.connection.oauth_client_id, "native-sentry-client");
    assert.equal(
      prepared.connection.oauth_scopes,
      "org:read project:write team:write event:write"
    );
    assert.equal(updateBodies.length, 2);
    assert.equal(
      updateBodies[0]?.oauth_scopes,
      "org:read project:write team:write event:write"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("getValidAccessToken returns a native Sentry MCP OAuth token", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input: FetchInput) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (isStoredConnectionStateFetch(url)) {
      return Response.json({
        encrypted_credentials: encrypt(
          JSON.stringify({
            access_token: "sentry-mcp-access-token",
            refresh_token: "sentry-mcp-refresh-token",
          })
        ),
        updated_at: "2026-04-22T00:00:00.000Z",
        oauth_authorized_at: "2026-04-22T00:00:00.000Z",
        oauth_token_expires_at: "2099-04-22T01:00:00.000Z",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { getValidAccessToken } = await loadOAuthHelpers();
    const accessToken = await getValidAccessToken(
      createConnection({
        source_preset: "sentry",
        oauth_client_id: "sentry-client",
        oauth_authorize_url: "https://mcp.sentry.dev/oauth/authorize",
        oauth_token_url: "https://mcp.sentry.dev/oauth/token",
        updated_at: "2026-04-22T00:00:00.000Z",
      })
    );

    assert.equal(accessToken, "sentry-mcp-access-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("getValidAccessToken fails closed when native credentials cannot be decrypted", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input: FetchInput) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (isStoredConnectionStateFetch(url)) {
      return Response.json({
        encrypted_credentials: "not-valid-ciphertext",
        updated_at: "2026-04-22T00:00:00.000Z",
        oauth_authorized_at: "2026-04-22T00:00:00.000Z",
        oauth_token_expires_at: null,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { getValidAccessToken } = await loadOAuthHelpers();
    await assert.rejects(
      () =>
        getValidAccessToken(
          createConnection({
            source_preset: "sentry",
            oauth_client_id: null,
            oauth_authorize_url: null,
            oauth_token_url: null,
            updated_at: "2026-04-22T00:00:00.000Z",
          })
        ),
      /Unsupported state or unable to authenticate data|Invalid authentication tag|unable to authenticate data/i
    );
  } finally {
    global.fetch = originalFetch;
  }
});
