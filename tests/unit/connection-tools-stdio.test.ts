import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Connection } from "../../lib/types";

test("should skip a stdio connection in a server-side turn without logging a load failure", async () => {
  const { buildDynamicConnectionTools } =
    await import("../../lib/agents/tools/connections");
  const stdioConnection = {
    id: "conn-trigger",
    name: "Trigger.dev",
    type: "mcp_server",
    auth_type: "bearer",
    mcp_transport: "stdio",
    mcp_url: null,
    source_preset: "trigger",
  } as Connection;
  const info = mock.method(console, "info", () => undefined);
  const warn = mock.method(console, "warn", () => undefined);

  const loaded = await buildDynamicConnectionTools([stdioConnection], {});

  const logged = [...info.mock.calls, ...warn.mock.calls].map((call) =>
    JSON.stringify(call.arguments)
  );
  mock.restoreAll();

  assert.deepEqual(loaded.dynamicTools, {});
  assert.deepEqual(loaded.mcpCleanups, []);
  assert.deepEqual(
    logged.filter((line) => line.includes("connection_runtime")),
    []
  );
});
