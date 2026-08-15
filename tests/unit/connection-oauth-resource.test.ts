import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "../../lib/types";

function createSentryConnection(
  overrides: Partial<Connection> = {}
): Connection {
  return {
    id: "conn-oauth",
    user_id: "user-1",
    name: "Sentry",
    type: "mcp_server",
    base_url: null,
    auth_type: "oauth",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.sentry.dev/mcp",
    description: "Connection",
    is_enabled: true,
    health_status: "unknown",
    scope: "global",
    repo_id: null,
    oauth_client_id: "registered-sentry-client",
    oauth_authorize_url: "https://mcp.sentry.dev/oauth/authorize",
    oauth_token_url: "https://mcp.sentry.dev/oauth/token",
    oauth_scopes: "org:read project:write team:write event:write",
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: "sentry",
    last_tested_at: null,
    last_test_error: null,
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: "2026-03-23T00:00:00.000Z",
    updated_at: "2026-03-23T00:00:00.000Z",
    ...overrides,
  };
}

test("resource binding is opt-in and does not change the Notion OAuth flow", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { getOAuthResourceIndicator } =
    await import("../../lib/connections/oauth");
  const connection = (source_preset: string, mcp_url: string) =>
    ({ source_preset, mcp_url, type: "mcp_server" }) as Connection;

  assert.equal(
    getOAuthResourceIndicator(
      connection("sentry", "https://mcp.sentry.dev/mcp")
    ),
    "https://mcp.sentry.dev/mcp"
  );
  assert.equal(
    getOAuthResourceIndicator(
      connection("notion", "https://mcp.notion.com/mcp")
    ),
    undefined
  );
});

test("native reconnect restores a missing preset MCP URL", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const originalFetch = global.fetch;
  const updates: Array<Record<string, unknown>> = [];

  global.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith("https://example.supabase.co/rest/v1/connections?")) {
      updates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { prepareOAuthConnection } =
      await import("../../lib/connections/oauth");
    const prepared = await prepareOAuthConnection(
      createSentryConnection({ mcp_url: null }),
      {
        redirectUri: "https://mogplex.example/api/connections/oauth/callback",
        origin: "https://mogplex.example",
      }
    );

    assert.equal(prepared.connection.mcp_url, "https://mcp.sentry.dev/mcp");
    assert.equal(prepared.connection.mcp_transport, "http");
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.mcp_url, "https://mcp.sentry.dev/mcp");
    assert.equal(updates[0]?.mcp_transport, "http");
  } finally {
    global.fetch = originalFetch;
  }
});
