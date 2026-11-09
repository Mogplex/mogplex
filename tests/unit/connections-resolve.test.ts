import assert from "node:assert/strict";
import test from "node:test";
import type { Connection, ConnectionOverride } from "../../lib/types";

async function loadService() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/connections/service");
}

function mcp(id: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    type: "mcp_server",
    scope: "global",
    is_enabled: true,
    created_at: "2026-11-09T00:00:00.000Z",
    ...overrides,
  } as Connection;
}

test("should resolve every enabled MCP server with no count limit", async () => {
  const { resolveRepoConnections } = await loadService();
  const global = Array.from({ length: 9 }, (_, index) =>
    mcp(`global-${index}`)
  );
  const project = Array.from({ length: 4 }, (_, index) =>
    mcp(`project-${index}`, { scope: "project" })
  );

  const { resolvedConnections } = resolveRepoConnections(global, project, []);

  assert.equal(resolvedConnections.length, 13);
});

test("should still drop excluded and disabled MCP servers", async () => {
  const { resolveRepoConnections } = await loadService();
  const overrides = [
    { connection_id: "global-0", excluded: true },
  ] as ConnectionOverride[];

  const { resolvedConnections } = resolveRepoConnections(
    [mcp("global-0"), mcp("global-1"), mcp("global-2", { is_enabled: false })],
    [mcp("project-0", { scope: "project", is_enabled: false })],
    overrides
  );

  assert.deepEqual(
    resolvedConnections.map((connection) => connection.id),
    ["global-1"]
  );
});
