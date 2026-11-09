import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";

type FetchInput = string | URL | Request;

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
    mcp_url: "https://mcp.sentry.dev/mcp",
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
  return import("../../lib/connections/oauth");
}

function fetchUrl(input: FetchInput) {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

test("should discover and register a custom MCP server as a public PKCE client", async () => {
  const originalFetch = global.fetch;
  const updates: Array<Record<string, unknown>> = [];
  let registration: Record<string, unknown> | undefined;
  global.fetch = async (input: FetchInput, init?: RequestInit) => {
    const url = fetchUrl(input);
    if (
      url === "https://mcp.sentry.dev/mcp/.well-known/oauth-protected-resource"
    )
      return Response.json({}, { status: 404 });
    if (
      url === "https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"
    )
      return Response.json({
        resource: "https://mcp.sentry.dev/mcp",
        authorization_servers: ["https://mcp.sentry.dev"],
      });
    if (url === "https://mcp.sentry.dev/.well-known/oauth-authorization-server")
      return Response.json({
        authorization_endpoint: "https://mcp.sentry.dev/oauth/authorize",
        token_endpoint: "https://mcp.sentry.dev/oauth/token",
        registration_endpoint: "https://mcp.sentry.dev/oauth/register",
      });
    if (url === "https://mcp.sentry.dev/oauth/register") {
      registration = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ client_id: "custom-registered-client" });
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      updates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { prepareOAuthConnection, getOAuthResourceIndicator } =
      await loadOAuthHelpers();
    const prepared = await prepareOAuthConnection(createCustomConnection(), {
      redirectUri: "https://mogplex.example/api/connections/oauth/callback",
      origin: "https://mogplex.example",
    });

    assert.equal(
      prepared.connection.oauth_client_id,
      "custom-registered-client"
    );
    assert.equal(
      prepared.connection.oauth_authorize_url,
      "https://mcp.sentry.dev/oauth/authorize"
    );
    assert.ok(prepared.codeVerifier, "custom MCP sign-in always uses PKCE");
    assert.equal(registration?.token_endpoint_auth_method, "none");
    assert.equal(updates.at(-1)?.oauth_client_id, "custom-registered-client");
    assert.equal(
      getOAuthResourceIndicator(prepared.connection),
      "https://mcp.sentry.dev/mcp"
    );
  } finally {
    global.fetch = originalFetch;
  }
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
