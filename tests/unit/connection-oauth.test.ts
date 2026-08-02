import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";
import { encrypt } from "../../lib/connections/encryption";

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
  process.env.PIPEDREAM_CLIENT_ID = "pd-client";
  process.env.PIPEDREAM_CLIENT_SECRET = "pd-secret";
  process.env.PIPEDREAM_PROJECT_ID = "proj_test";
  process.env.PIPEDREAM_PROJECT_ENVIRONMENT = "development";
  process.env.PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY = "pd-webhook-secret";
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
      }
    )
  );

  assert.equal(authorizeUrl.searchParams.get("client_id"), "client-123");
  assert.equal(authorizeUrl.searchParams.get("state"), "state-123");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("prompt"), "consent");
});

test("getValidAccessToken resolves brokered Sentry OAuth credentials through Pipedream", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
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
            kind: "pipedream_connect",
            provider: "sentry",
            account_id: "apn_sentry_123",
            app_slug: "sentry",
            account_name: "Acme Sentry",
            external_user_id: "user-1",
            authorized_scopes: ["event:read"],
            connected_at: "2026-04-22T00:00:00.000Z",
            expires_at: null,
          })
        ),
        updated_at: "2026-04-22T00:00:00.000Z",
        oauth_authorized_at: "2026-04-22T00:00:00.000Z",
        oauth_token_expires_at: null,
      });
    }

    if (url === "https://api.pipedream.com/v1/oauth/token") {
      assert.equal(init?.method, "POST");
      return Response.json({
        access_token: "pd-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }

    if (
      url ===
      "https://api.pipedream.com/v1/connect/proj_test/accounts/apn_sentry_123?include_credentials=true"
    ) {
      return Response.json({
        id: "apn_sentry_123",
        name: "Acme Sentry",
        external_id: "user-1",
        healthy: true,
        dead: null,
        app: {
          id: "oa_sentry",
          name_slug: "sentry",
          name: "Sentry",
          auth_type: "oauth",
        },
        created_at: "2026-04-22T00:00:00.000Z",
        updated_at: "2026-04-22T00:00:00.000Z",
        authorized_scopes: ["event:read"],
        credentials: {
          oauth_access_token: "sentry-oauth-access-token",
        },
        expires_at: null,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { getValidAccessToken } = await loadOAuthHelpers();
    const accessToken = await getValidAccessToken(
      createConnection({
        source_preset: "sentry",
        oauth_client_id: null,
        oauth_authorize_url: null,
        oauth_token_url: null,
        updated_at: "2026-04-22T00:00:00.000Z",
      })
    );

    assert.equal(accessToken, "sentry-oauth-access-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("getValidAccessToken warns when managed auth credentials cannot be decrypted", async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  let warned = false;

  console.warn = (...args: unknown[]) => {
    warned = true;
    assert.equal(
      args[0],
      "[managed-auth] failed to decrypt managed auth credentials"
    );
  };
  global.fetch = async (input: string | URL | Request) => {
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
    assert.equal(warned, true);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
