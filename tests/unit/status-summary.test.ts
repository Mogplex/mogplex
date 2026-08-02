import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMcpStatus } from "../../lib/connections/status-summary";
import type { Connection } from "../../lib/types";
import type { ConnectionHealthStatus } from "../../lib/connections/status";

let idCounter = 0;
function server(
  overrides: Partial<Pick<Connection, "is_enabled" | "health_status">> = {}
): Connection {
  idCounter += 1;
  return {
    id: `conn-${idCounter}`,
    user_id: "u1",
    name: "s",
    type: "mcp_server",
    base_url: null,
    auth_type: "none",
    auth_header: null,
    mcp_transport: "http",
    mcp_url: "https://example.com/mcp",
    description: null,
    is_enabled: true,
    health_status: "healthy",
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test("summarizeMcpStatus: empty state when no servers", () => {
  const result = summarizeMcpStatus([]);
  assert.equal(result.state, "empty");
  assert.equal(result.label, "Tools: 0");
  assert.match(result.dot, /muted/);
});

test("summarizeMcpStatus: none-enabled when all servers disabled", () => {
  const result = summarizeMcpStatus([
    server({ is_enabled: false }),
    server({ is_enabled: false, health_status: "healthy" }),
  ]);
  assert.equal(result.state, "none-enabled");
  assert.equal(result.label, "Tools: 0/2");
});

test("summarizeMcpStatus: all-healthy when every enabled server is healthy", () => {
  const result = summarizeMcpStatus([
    server({ health_status: "healthy" }),
    server({ health_status: "healthy" }),
    server({ is_enabled: false, health_status: "error" }),
  ]);
  assert.equal(result.state, "all-healthy");
  assert.equal(result.dot, "bg-green-500");
  assert.equal(result.label, "Tools: 2/2");
});

test("summarizeMcpStatus: partial when enabled mixes healthy with unknown", () => {
  const result = summarizeMcpStatus([
    server({ health_status: "healthy" }),
    server({ health_status: "unknown" }),
  ]);
  assert.equal(result.state, "partial");
  assert.equal(result.dot, "bg-amber-400");
  assert.equal(result.label, "Tools: 1/2");
});

for (const status of [
  "unreachable",
  "error",
  "auth_failed",
] satisfies ConnectionHealthStatus[]) {
  test(`summarizeMcpStatus: failing when any enabled server is ${status}`, () => {
    const result = summarizeMcpStatus([
      server({ health_status: "healthy" }),
      server({ health_status: status }),
    ]);
    assert.equal(result.state, "failing");
    assert.equal(result.dot, "bg-red-500");
  });
}

test("summarizeMcpStatus: ignores disabled servers when determining failure", () => {
  const result = summarizeMcpStatus([
    server({ health_status: "healthy" }),
    server({ is_enabled: false, health_status: "error" }),
  ]);
  assert.equal(result.state, "all-healthy");
});
