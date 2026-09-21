import assert from "node:assert/strict";
import test from "node:test";
import { buildCliMcpRecord } from "../../lib/connections/cli-record";
import { checkStdioConnection } from "../../lib/connections/stdio-check";
import type { Connection } from "../../lib/types";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-trigger",
    user_id: "user-1",
    name: "Trigger.dev",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "stdio",
    mcp_url: null,
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
    source_preset: "trigger",
    last_tested_at: null,
    last_test_error: null,
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function fetchReturning(status: number) {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(null, { status });
  };
  return { calls, fetchImpl };
}

test("should hand the CLI a command/args/env record when the connection is a stdio preset", () => {
  assert.deepEqual(buildCliMcpRecord(makeConnection(), "tr_pat_abc"), {
    name: "Trigger.dev",
    enabled: true,
    config: {
      command: "npx",
      args: ["-y", "trigger.dev@latest", "mcp"],
      env: { TRIGGER_ACCESS_TOKEN: "tr_pat_abc" },
    },
  });
});

test("should keep handing the CLI url/http_headers records when the connection is remote", () => {
  const remote = makeConnection({
    name: "Linear",
    mcp_transport: "http",
    mcp_url: "https://mcp.linear.app/mcp",
    source_preset: "linear",
  });

  assert.deepEqual(buildCliMcpRecord(remote, "lin_api_xyz"), {
    name: "Linear",
    enabled: true,
    config: {
      url: "https://mcp.linear.app/mcp",
      http_headers: { Authorization: "Bearer lin_api_xyz" },
    },
  });
});

test("should give the CLI nothing when a stdio row has no preset launch", () => {
  const orphan = makeConnection({ source_preset: null });

  assert.equal(buildCliMcpRecord(orphan, "token"), null);
});

test("should report healthy when Trigger.dev accepts the token", async () => {
  const { calls, fetchImpl } = fetchReturning(200);

  const result = await checkStdioConnection(
    makeConnection(),
    "tr_pat_abc",
    fetchImpl
  );

  assert.deepEqual(calls, [
    {
      url: "https://api.trigger.dev/api/v2/whoami",
      authorization: "Bearer tr_pat_abc",
    },
  ]);
  assert.equal(result.healthy, true);
  assert.equal(result.status, "healthy");
});

test("should report auth_failed when Trigger.dev rejects the token", async () => {
  const { fetchImpl } = fetchReturning(401);

  const result = await checkStdioConnection(
    makeConnection(),
    "tr_pat_bad",
    fetchImpl
  );

  assert.equal(result.healthy, false);
  assert.equal(result.status, "auth_failed");
  assert.equal(result.httpStatus, 401);
  assert.match(result.error ?? "", /rejected the credential/);
});

test("should report error rather than auth_failed when the check endpoint is down", async () => {
  const { fetchImpl } = fetchReturning(503);

  const result = await checkStdioConnection(
    makeConnection(),
    "tr_pat_abc",
    fetchImpl
  );

  assert.equal(result.status, "error");
});

test("should not call out when the token is missing or the preset is gone", async () => {
  const { calls, fetchImpl } = fetchReturning(200);

  const missingToken = await checkStdioConnection(
    makeConnection(),
    undefined,
    fetchImpl
  );
  const missingPreset = await checkStdioConnection(
    makeConnection({ source_preset: null }),
    "tr_pat_abc",
    fetchImpl
  );

  assert.equal(missingToken.status, "auth_failed");
  assert.equal(missingPreset.status, "misconfigured");
  assert.deepEqual(calls, []);
});
