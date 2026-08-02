import assert from "node:assert/strict";
import test from "node:test";

async function loadMcpServerItemRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/mcp-servers/[id]/route");
}

test("GET /api/mcp-servers/[id] returns the requested server", async () => {
  const { createMcpServerGetHandler } = await loadMcpServerItemRoute();

  const handler = createMcpServerGetHandler({
    requireUserId: async () => "user-123",
    getUserMcpServerForWeb: async () => ({
      id: "server-1",
      name: "linear",
      enabled: true,
      transport: "http",
      command: null,
      args: [],
      envPlain: {},
      envSecretNames: [],
      url: "https://mcp.linear.app/sse",
      headerPlain: {},
      headerSecretNames: ["Authorization"],
      extra: {},
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }),
    updateUserMcpServer: async () => null,
    deleteUserMcpServer: async () => false,
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers/server-1"),
    { params: Promise.resolve({ id: "server-1" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.server.name, "linear");
  assert.equal(payload.server.headerSecretNames[0], "Authorization");
});

test("DELETE /api/mcp-servers/[id] returns 404 when the server does not exist", async () => {
  const { createMcpServerDeleteHandler } = await loadMcpServerItemRoute();

  const handler = createMcpServerDeleteHandler({
    requireUserId: async () => "user-123",
    getUserMcpServerForWeb: async () => null,
    updateUserMcpServer: async () => null,
    deleteUserMcpServer: async () => false,
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers/server-404", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: "server-404" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Server not found" });
});
