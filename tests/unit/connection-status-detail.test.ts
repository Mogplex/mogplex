import assert from "node:assert/strict";
import test from "node:test";
import { getConnectionStatusDetail } from "../../lib/connections/status";

const healthy = {
  auth_type: "bearer" as const,
  health_status: "healthy" as const,
  last_test_error: null,
  last_test_http_status: null,
  oauth_authorized_at: null,
};

test("should say where the tools load when a healthy stdio connection has no tool count", () => {
  const detail = getConnectionStatusDetail({
    ...healthy,
    mcp_transport: "stdio",
    last_test_tool_count: null,
  });

  assert.equal(detail, "Token verified · tools load in sandboxes and the CLI");
});

test("should keep reporting the tool count when a healthy remote connection has one", () => {
  const detail = getConnectionStatusDetail({
    ...healthy,
    mcp_transport: "http",
    last_test_tool_count: 12,
  });

  assert.equal(detail, "12 tools detected");
});

test("should show the test error when a stdio connection's token is rejected", () => {
  const detail = getConnectionStatusDetail({
    ...healthy,
    health_status: "auth_failed",
    mcp_transport: "stdio",
    last_test_tool_count: null,
    last_test_error: "Trigger.dev rejected the credential",
  });

  assert.equal(detail, "Trigger.dev rejected the credential");
});
