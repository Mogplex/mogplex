import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpStdioLaunch,
  buildMcpTransport,
  isStdioConnection,
} from "../../lib/connections/mcp-transport";
import type { Connection } from "../../lib/types";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    user_id: "user-1",
    name: "MCP Connection",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://example.com/mcp",
    description: null,
    is_enabled: true,
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
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

test("buildMcpTransport applies bearer auth by default", () => {
  const transport = buildMcpTransport(makeConnection(), "secret-token");
  assert.equal(transport.type, "http");
  assert.equal(transport.url, "https://example.com/mcp");
  assert.deepEqual(transport.headers, {
    Authorization: "Bearer secret-token",
  });
});

test("buildMcpTransport applies API keys without a bearer prefix", () => {
  const transport = buildMcpTransport(
    makeConnection({
      auth_type: "api_key",
      auth_header: "X-API-Key",
    }),
    "bb_live_123"
  );

  assert.deepEqual(transport.headers, {
    "X-API-Key": "bb_live_123",
  });
});

test("buildMcpTransport respects custom auth headers", () => {
  const transport = buildMcpTransport(
    makeConnection({
      auth_type: "api_key",
      auth_header: "X-MCP-Token",
    }),
    "custom-token"
  );

  assert.deepEqual(transport.headers, {
    "X-MCP-Token": "custom-token",
  });
});

test("buildMcpTransport injects Browserbase credentials via query params", () => {
  const transport = buildMcpTransport(
    makeConnection({
      source_preset: "browserbase",
      auth_type: "api_key",
      mcp_url: "https://mcp.browserbase.com/mcp",
    }),
    "bb_live_123"
  );

  assert.equal(
    transport.url,
    "https://mcp.browserbase.com/mcp?browserbaseApiKey=bb_live_123"
  );
  assert.deepEqual(transport.headers, {});
});

test("buildMcpTransport preserves legacy settings-created MCP connections", () => {
  const transport = buildMcpTransport(
    makeConnection({
      auth_type: "none",
      auth_header: "Authorization",
    }),
    "legacy-token"
  );

  assert.deepEqual(transport.headers, {
    Authorization: "Bearer legacy-token",
  });
});

test("buildMcpTransport preserves a user-specific Zapier MCP URL without extra auth injection", () => {
  const transport = buildMcpTransport(
    makeConnection({
      source_preset: "zapier",
      auth_type: "none",
      mcp_url: "https://mcp.zapier.com/custom/server-secret",
    })
  );

  assert.equal(transport.url, "https://mcp.zapier.com/custom/server-secret");
  assert.deepEqual(transport.headers, {});
});

test("should build the stdio launch from the preset when the connection is a Trigger.dev preset", () => {
  const conn = makeConnection({
    name: "Trigger.dev",
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: "trigger",
  });

  assert.equal(isStdioConnection(conn), true);
  assert.deepEqual(buildMcpStdioLaunch(conn, "tr_pat_secret"), {
    type: "stdio",
    command: "npx",
    args: ["-y", "trigger.dev@latest", "mcp"],
    env: { TRIGGER_ACCESS_TOKEN: "tr_pat_secret" },
  });
});

test("should refuse to build a stdio launch when the row has no stdio preset behind it", () => {
  const withoutPreset = makeConnection({
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: null,
  });
  const remotePreset = makeConnection({
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: "linear",
  });
  const remoteConnection = makeConnection({ source_preset: "trigger" });

  assert.equal(buildMcpStdioLaunch(withoutPreset, "token"), null);
  assert.equal(buildMcpStdioLaunch(remotePreset, "token"), null);
  assert.equal(buildMcpStdioLaunch(remoteConnection, "token"), null);
});

test("should throw instead of building a remote transport when the connection is stdio", () => {
  const conn = makeConnection({
    name: "Trigger.dev",
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: "trigger",
  });

  assert.throws(() => buildMcpTransport(conn, "token"), /runs over stdio/);
});
