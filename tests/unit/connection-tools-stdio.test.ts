import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Connection } from "../../lib/types";

function makeStdioConnection(overrides: Partial<Connection> = {}) {
  return {
    id: "conn-trigger",
    name: "Trigger.dev",
    type: "mcp_server",
    auth_type: "bearer",
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: "trigger",
    ...overrides,
  } as Connection;
}

function captureConnectionLogs() {
  const info = mock.method(console, "info", () => undefined);
  const warn = mock.method(console, "warn", () => undefined);
  return () => {
    const logged = [...info.mock.calls, ...warn.mock.calls]
      .map((call) => JSON.stringify(call.arguments))
      .filter((line) => line.includes("connection_runtime"));
    mock.restoreAll();
    return logged;
  };
}

test("should give a server-side turn the preset's API tools when the connection is stdio", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  const requestedCredentialsFor: string[] = [];

  const loaded = await buildDynamicConnectionTools(
    [makeStdioConnection()],
    {},
    {
      getCredentials: async (connectionId) => {
        requestedCredentialsFor.push(connectionId);
        return "tr_pat_abc";
      },
    }
  );

  const toolNames = Object.keys(loaded.dynamicTools);
  assert.deepEqual(requestedCredentialsFor, ["conn-trigger"]);
  assert.equal(toolNames.length, 60);
  assert.ok(toolNames.includes("trigger_dev_list_runs"));
  assert.ok(toolNames.includes("trigger_dev_trigger_task"));
  // Registered as MCP-class names so Slack idempotency protects the writes.
  assert.deepEqual([...loaded.mcpToolNames].sort(), [...toolNames].sort());
  assert.deepEqual([...loaded.restToolNames], []);
  // Nothing was launched, so there is no client to close.
  assert.deepEqual(loaded.mcpCleanups, []);
});

test("should load no API tools and log the failure when the stdio connection has no saved credential", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  const readLogs = captureConnectionLogs();

  const loaded = await buildDynamicConnectionTools(
    [makeStdioConnection()],
    {},
    { getCredentials: async () => "" }
  );

  const logged = readLogs();
  assert.deepEqual(loaded.dynamicTools, {});
  assert.ok(
    logged.some(
      (line) =>
        line.includes("connection_runtime_load_failed") &&
        line.includes("missing credentials")
    )
  );
});

test("should skip a stdio connection with no API toolset without logging a load failure", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  const readLogs = captureConnectionLogs();

  const loaded = await buildDynamicConnectionTools(
    [makeStdioConnection({ source_preset: null })],
    {},
    {
      getCredentials: async () => {
        throw new Error("a skipped connection must not load credentials");
      },
    }
  );

  assert.deepEqual(readLogs(), []);
  assert.deepEqual(loaded.dynamicTools, {});
  assert.deepEqual(loaded.mcpCleanups, []);
});
