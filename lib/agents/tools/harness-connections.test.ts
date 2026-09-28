import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTools } from "./index";

const connection = (overrides: Record<string, unknown>) => ({
  id: "conn-1",
  user_id: "user-1",
  name: "Linear",
  type: "mcp_server",
  base_url: null,
  auth_type: "none",
  auth_header: null,
  mcp_transport: "http",
  mcp_url: "https://8.8.8.8/mcp",
  description: null,
  is_enabled: true,
  approval_mode: "auto",
  health_status: null,
  scope: "user",
  repo_id: null,
  oauth_client_id: null,
  oauth_authorize_url: null,
  oauth_token_url: null,
  oauth_scopes: null,
  oauth_authorized_at: null,
  oauth_token_expires_at: null,
  source_preset: null,
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
  ...overrides,
});

let mcpRequests: number;

beforeEach(() => {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  mcpRequests = 0;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === "db.example.com") {
        return Response.json(
          url.pathname.endsWith("/connections")
            ? [
                connection({}),
                connection({
                  id: "conn-2",
                  name: "Billing",
                  type: "rest_api",
                  base_url: "https://api.billing.example.com",
                  mcp_transport: null,
                  mcp_url: null,
                }),
              ]
            : []
        );
      }
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      mcpRequests += 1;
      const body = await request.json();
      if (body.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : {
              tools: [
                {
                  name: "list_issues",
                  description: "List issues",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            };
      return Response.json(
        { jsonrpc: "2.0", id: body.id, result },
        { headers: { "mcp-session-id": "fixture-session" } }
      );
    }
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("should leave MCP server connections to the harness and still build its REST tools", async () => {
  const built = await buildTools({
    userId: "user-1",
    capabilities: new Set(["connections.create"]),
    skipMcpServerConnections: true,
  });

  expect(Object.keys(built.tools)).toContain("api_billing");
  expect(
    Object.keys(built.tools).some((name) => name.startsWith("linear_"))
  ).toBe(false);
  expect(mcpRequests).toBe(0);
  await built.cleanup();
});

it("should connect to MCP server connections for the native agent", async () => {
  const built = await buildTools({
    userId: "user-1",
    capabilities: new Set(["connections.create"]),
  });

  expect(Object.keys(built.tools)).toEqual(
    expect.arrayContaining(["api_billing", "linear_list_issues"])
  );
  await built.cleanup();
});
