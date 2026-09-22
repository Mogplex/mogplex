import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildDynamicConnectionTools,
  cleanupMcpClients,
} from "../agents/tools/connections";
import type { McpServerRow } from "./types";
import type { Connection } from "@/lib/types";

const server = (overrides: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user-1",
  name: "Documentation",
  enabled: true,
  transport: "http",
  command: null,
  args: [],
  env_refs: {},
  env_plain: {},
  url: "https://8.8.8.8/mcp",
  header_refs: { Authorization: "secret-1" },
  header_plain: { "X-Project": "docs" },
  extra: {},
  created_at: "2026-09-22T00:00:00Z",
  updated_at: "2026-09-22T00:00:00Z",
  ...overrides,
});

let rows: McpServerRow[];
let requests: Request[];
let secrets: Array<{ id: string; decrypted_secret: string }>;
let failCatalog = false;
let failDiscovery = false;
let stallDiscovery = false;
let onDiscovery: () => void = () => undefined;

beforeEach(() => {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  rows = [server()];
  requests = [];
  secrets = [{ id: "secret-1", decrypted_secret: "Bearer test-secret" }];
  failCatalog = false;
  failDiscovery = false;
  stallDiscovery = false;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/user_mcp_servers")) {
        if (failCatalog)
          return Response.json({ message: "unavailable" }, { status: 503 });
        return Response.json(
          rows.filter((row) =>
            ["user_id", "enabled", "transport"].every((key) => {
              const value = url.searchParams.get(key);
              return !value || value === `eq.${row[key as keyof McpServerRow]}`;
            })
          )
        );
      }
      if (url.pathname.endsWith("/decrypted_secrets"))
        return Response.json(secrets);
      if (url.hostname === "db.example.com") return Response.json([]);
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      const body = await request.json();
      if (body.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (
        body.method === "tools/list" &&
        stallDiscovery &&
        url.pathname === "/slow"
      ) {
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true }
          );
          onDiscovery();
        });
      }
      if (
        body.method === "tools/list" &&
        failDiscovery &&
        url.pathname === "/broken"
      ) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "find_docs",
                    description: "Find docs",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : { content: [{ type: "text", text: "Documentation found" }] };
      return Response.json(
        { jsonrpc: "2.0", id: body.id, result },
        { headers: { "mcp-session-id": "fixture-session" } }
      );
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("loads a saved HTTP server without an Integration, calls its tool with saved headers, and closes it", async () => {
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  const names = Object.keys(built.dynamicTools);
  expect(names).toHaveLength(1);
  expect(built.mcpToolNames.has(names[0])).toBe(true);
  const result = await built.dynamicTools[names[0]].execute!(
    {},
    { toolCallId: "call-1", messages: [], context: undefined }
  );
  expect(result).toMatchObject({ content: [{ text: "Documentation found" }] });
  const calls = requests.filter((request) =>
    request.url.startsWith("https://8.8.8.8")
  );
  expect(calls.length).toBeGreaterThan(0);
  for (const request of calls) {
    expect(request.headers.get("Authorization")).toBe("Bearer test-secret");
    expect(request.headers.get("X-Project")).toBe("docs");
    expect(request.redirect).toBe("error");
  }
  await cleanupMcpClients(built.mcpCleanups);
  await cleanupMcpClients(built.mcpCleanups);
  expect(
    requests.filter((request) => request.method === "DELETE")
  ).toHaveLength(1);
});

it("excludes other users, disabled entries, stdio, and local URLs before reading their secrets or making MCP requests", async () => {
  rows = [
    server({ user_id: "user-2" }),
    server({ enabled: false }),
    server({ transport: "stdio", command: "npx", url: null }),
    server({ url: "http://127.0.0.1/mcp" }),
  ];
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(built.dynamicTools).toEqual({});
  expect(requests).toHaveLength(1);
});

it("does not read the catalog without a user", async () => {
  const built = await buildDynamicConnectionTools([], {});
  expect(built.dynamicTools).toEqual({});
  expect(requests).toHaveLength(0);
});

it("makes saved tools available through the workspace chat entry point with no Integrations", async () => {
  const { buildTools } = await import("../agents/tools/index");
  const built = await buildTools({
    userId: "user-1",
    capabilities: new Set(["connections.create"]),
  });
  expect(
    Object.keys(built.tools).some((name) =>
      name.startsWith("saved_documentation_")
    )
  ).toBe(true);
  expect(built.connections).toEqual([]);
  await built.cleanup();
});

it("does not load saved tools when the workspace team capability is denied", async () => {
  const { buildTools } = await import("../agents/tools/index");
  const built = await buildTools({
    userId: "user-1",
    teamId: "team-1",
    capabilities: new Set(),
  });
  expect(
    Object.keys(built.tools).some((name) => name.startsWith("saved_"))
  ).toBe(false);
  expect(
    requests.some((request) => request.url.includes("user_mcp_servers"))
  ).toBe(false);
  await built.cleanup();
});

it("does not attempt anonymous access when a saved secret is missing", async () => {
  secrets = [];
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(built.dynamicTools).toEqual({});
  expect(
    requests.every(
      (request) => new URL(request.url).hostname === "db.example.com"
    )
  ).toBe(true);
});

it("isolates catalog errors", async () => {
  failCatalog = true;
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(built.dynamicTools).toEqual({});
});

it("keeps existing Integration tools available when the saved catalog fails", async () => {
  failCatalog = true;
  const connection = {
    id: "integration-1",
    name: "Existing docs",
    type: "mcp_server",
    mcp_transport: "http",
    mcp_url: "https://8.8.8.8/mcp",
    auth_type: "bearer",
    approval_mode: "auto",
  } as Connection;
  const built = await buildDynamicConnectionTools(
    [connection],
    { userId: "user-1" },
    {
      getCredentials: async () => "integration-secret",
    }
  );
  expect(Object.keys(built.dynamicTools)).toEqual(["existing_docs_find_docs"]);
  expect(built.mcpToolNames.has("existing_docs_find_docs")).toBe(true);
  const result = await built.dynamicTools.existing_docs_find_docs.execute!(
    {},
    {
      toolCallId: "existing-call",
      messages: [],
      context: undefined,
    }
  );
  expect(result).toMatchObject({ content: [{ text: "Documentation found" }] });
  expect(
    requests
      .find((request) => request.url.startsWith("https://8.8.8.8"))
      ?.headers.get("Authorization")
  ).toBe("Bearer integration-secret");
  expect(
    requests.find((request) => request.url.startsWith("https://8.8.8.8"))
      ?.redirect
  ).toBe("error");
  await cleanupMcpClients(built.mcpCleanups);
});

it("bounds saved-server startup, keeps healthy tools, and does not abort later tool calls", async () => {
  vi.useFakeTimers();
  stallDiscovery = true;
  const started = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  rows.push(
    server({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Slow",
      url: "https://8.8.8.8/slow",
    })
  );
  const loading = buildDynamicConnectionTools([], { userId: "user-1" });
  await started;
  await vi.advanceTimersByTimeAsync(8001);
  const built = await loading;
  expect(Object.keys(built.dynamicTools)).toHaveLength(1);
  expect(
    requests.find((request) => request.url.endsWith("/slow"))?.signal.aborted
  ).toBe(true);
  expect(
    requests
      .filter((request) => request.url.endsWith("/mcp"))
      .every((request) => !request.signal.aborted)
  ).toBe(true);
  const tool = Object.values(built.dynamicTools)[0];
  expect(
    await tool.execute!(
      {},
      { toolCallId: "after-deadline", messages: [], context: undefined }
    )
  ).toMatchObject({ content: [{ text: "Documentation found" }] });
  await cleanupMcpClients(built.mcpCleanups);
});

it("returns healthy saved tools before Control's outer startup deadline", async () => {
  const { loadControlConnectionTools } =
    await import("@/app/api/control/chat/_lib/connection-tools");
  vi.useFakeTimers();
  stallDiscovery = true;
  const started = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  rows.push(
    server({
      id: "22222222-2222-4222-8222-222222222222",
      url: "https://8.8.8.8/slow",
    })
  );
  let settled = false;
  const loading = loadControlConnectionTools(
    { userId: "user-1", teamId: null, enabled: true },
    {
      resolveCapabilities: async () => new Set(["*"]),
      loadConnections: async () => [],
      buildTools: buildDynamicConnectionTools,
      timeoutMs: 8000,
    }
  ).then((value) => {
    settled = true;
    return value;
  });
  await started;
  await vi.advanceTimersByTimeAsync(6001);
  expect(settled).toBe(true);
  const loaded = await loading;
  expect(Object.keys(loaded.tools)).toHaveLength(1);
  await loaded.cleanup();
});

it.each([
  { enabled_tools: [] },
  { disabled_tools: ["find_docs"] },
  { tools: { find_docs: { enabled: false } } },
  { tools: { find_docs: { approval_mode: "deny" } } },
  { default_tools_approval_mode: "prompt" },
  { disabled_tools: "invalid" },
])(
  "honors saved tool restrictions without broadening access: %j",
  async (extra) => {
    rows = [server({ extra })];
    const built = await buildDynamicConnectionTools([], { userId: "user-1" });
    expect(built.dynamicTools).toEqual({});
    await cleanupMcpClients(built.mcpCleanups);
  }
);

it("marks explicitly prompted tools for Control approval and preserves per-tool overrides", async () => {
  rows = [server({ extra: { default_tools_approval_mode: "prompt" } })];
  const built = await buildDynamicConnectionTools([], {
    userId: "user-1",
    canAskApproval: true,
  });
  expect([...built.askToolNames]).toEqual(Object.keys(built.dynamicTools));
  expect(built.askToolNames.size).toBe(1);
  await cleanupMcpClients(built.mcpCleanups);
  rows = [
    server({
      extra: {
        default_tools_approval_mode: "prompt",
        tools: { find_docs: { approval_mode: "approve" } },
      },
    }),
  ];
  const automatic = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(Object.keys(automatic.dynamicTools)).toHaveLength(1);
  expect(automatic.askToolNames.size).toBe(0);
  await cleanupMcpClients(automatic.mcpCleanups);
});

it("isolates a failed server and closes its session while loading the other server", async () => {
  failDiscovery = true;
  rows.push(
    server({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Broken",
      url: "https://8.8.8.8/broken",
    })
  );
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(Object.keys(built.dynamicTools)).toHaveLength(1);
  expect(
    requests.some(
      (request) =>
        request.method === "DELETE" && request.url.endsWith("/broken")
    )
  ).toBe(true);
  await cleanupMcpClients(built.mcpCleanups);
});

it("uses distinct valid tool names for servers with colliding display names and reloads enabled state each turn", async () => {
  rows = [
    server({ name: "a-b" }),
    server({ name: "a b", id: "22222222-2222-4222-8222-222222222222" }),
  ];
  const built = await buildDynamicConnectionTools([], { userId: "user-1" });
  expect(Object.keys(built.dynamicTools)).toHaveLength(2);
  for (const name of Object.keys(built.dynamicTools))
    expect(name).toMatch(/^[\w-]{1,64}$/);
  await cleanupMcpClients(built.mcpCleanups);
  rows = rows.map((row) => ({ ...row, enabled: false }));
  expect(
    (await buildDynamicConnectionTools([], { userId: "user-1" })).dynamicTools
  ).toEqual({});
});
