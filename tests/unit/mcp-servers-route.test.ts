import assert from "node:assert/strict";
import test from "node:test";

async function loadMcpServersRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/mcp-servers/route");
}

test("GET /api/mcp-servers?format=cli returns the CLI payload for the authed user", async () => {
  const { createMcpServersGetHandler } = await loadMcpServersRoute();

  const handler = createMcpServersGetHandler({
    getUserId: async () => "user-123",
    listUserMcpServersForCli: async () => [
      {
        name: "supabase",
        enabled: true,
        config: {
          command: "npx",
          args: ["-y", "@supabase/mcp-server-supabase@latest"],
          env: {
            SUPABASE_ACCESS_TOKEN: "sbp_abc123",
          },
        },
      },
    ],
    listUserMcpServersForWeb: async () => [],
    listConnectionsForCli: async () => [],
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers?format=cli")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      name: "supabase",
      enabled: true,
      config: {
        command: "npx",
        args: ["-y", "@supabase/mcp-server-supabase@latest"],
        env: {
          SUPABASE_ACCESS_TOKEN: "sbp_abc123",
        },
      },
    },
  ]);
});

test("GET /api/mcp-servers?format=cli merges connections, custom wins on name collision", async () => {
  const { createMcpServersGetHandler } = await loadMcpServersRoute();

  const handler = createMcpServersGetHandler({
    getUserId: async () => "user-123",
    listUserMcpServersForCli: async () => [
      {
        name: "supabase",
        enabled: true,
        config: {
          command: "npx",
          args: ["-y", "@supabase/mcp-server-supabase@latest"],
          env: {},
        },
      },
    ],
    listUserMcpServersForWeb: async () => [],
    listConnectionsForCli: async () => [
      {
        name: "supabase",
        enabled: true,
        config: { url: "https://mcp.supabase.com/mcp", http_headers: {} },
      },
      {
        name: "linear",
        enabled: true,
        config: {
          url: "https://mcp.linear.app/mcp",
          http_headers: { Authorization: "Bearer lin_api_xyz" },
        },
      },
    ],
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers?format=cli")
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 2);
  // Custom supabase wins over the connection-based one
  assert.equal(body[0].name, "supabase");
  assert.ok("command" in body[0].config);
  // Linear comes from connections
  assert.equal(body[1].name, "linear");
  assert.equal(body[1].config.url, "https://mcp.linear.app/mcp");
});

test("GET /api/mcp-servers?format=cli returns 401 without auth", async () => {
  const { createMcpServersGetHandler } = await loadMcpServersRoute();

  const handler = createMcpServersGetHandler({
    getUserId: async () => undefined,
    listUserMcpServersForCli: async () => [],
    listUserMcpServersForWeb: async () => [],
    listConnectionsForCli: async () => [],
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers?format=cli")
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test('POST /api/mcp-servers rejects names containing "__"', async () => {
  const { createMcpServersPostHandler } = await loadMcpServersRoute();

  const handler = createMcpServersPostHandler({
    requireUserId: async () => "user-123",
    createUserMcpServer: async () => {
      throw new Error("should not create");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "foo__bar",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: [],
        envPlain: {},
        envSecrets: {},
        headerPlain: {},
        headerSecrets: {},
        extra: {},
      }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'name must not contain "__"',
    code: "INVALID_NAME",
  });
});

test("POST /api/mcp-servers rejects stdio payloads that also provide a url", async () => {
  const { createMcpServersPostHandler } = await loadMcpServersRoute();

  const handler = createMcpServersPostHandler({
    requireUserId: async () => "user-123",
    createUserMcpServer: async () => {
      throw new Error("should not create");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/mcp-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "supabase",
        enabled: true,
        transport: "stdio",
        command: "npx",
        url: "https://mcp.example.com",
        args: [],
        envPlain: {},
        envSecrets: {},
        headerPlain: {},
        headerSecrets: {},
        extra: {},
      }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "stdio servers cannot include url",
    code: "INVALID_TRANSPORT_FIELDS",
  });
});
