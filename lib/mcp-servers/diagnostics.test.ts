import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testSavedMcpServer } from "./diagnostics";
import type { McpServerRow } from "./types";

const id = "11111111-1111-4111-8111-111111111111";
let row: McpServerRow;
let requests: Request[];
let methods: string[];
let missingSecret: boolean;
let httpStatus: number;
let stall: boolean;
let stallClose: boolean;
let tools: string[];
let onDiscovery: () => void;
let databaseFailure: boolean;
let discoveryError: Error | undefined;

beforeEach(() => {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  row = {
    id,
    user_id: "owner",
    name: "Docs",
    transport: "http",
    enabled: true,
    command: null,
    args: [],
    env_refs: {},
    env_plain: {},
    url: "https://8.8.8.8/mcp",
    header_refs: { Authorization: "secret-id" },
    header_plain: {},
    extra: {},
    created_at: "2026-09-22T00:00:00Z",
    updated_at: "2026-09-22T01:00:00Z",
  };
  requests = [];
  methods = [];
  missingSecret = false;
  httpStatus = 200;
  stall = false;
  stallClose = false;
  tools = ["search", "publish", "delete"];
  onDiscovery = () => undefined;
  databaseFailure = false;
  discoveryError = undefined;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/user_mcp_servers")) {
        if (databaseFailure)
          return Response.json(
            { message: "fixture-secret-never-return", code: "DB_UNAVAILABLE" },
            { status: 503 }
          );
        return Response.json(
          url.searchParams.get("user_id") === `eq.${row.user_id}` &&
            url.searchParams.get("id") === `eq.${row.id}`
            ? row
            : null
        );
      }
      if (url.pathname.endsWith("/decrypted_secrets"))
        return Response.json(
          missingSecret
            ? []
            : [
                {
                  id: "secret-id",
                  decrypted_secret: "Bearer fixture-secret-never-return",
                },
              ]
        );
      if (request.method === "DELETE" && stallClose)
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true }
          );
          onDiscovery();
        });
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      const body = await request.json();
      methods.push(body.method);
      if (body.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        if (discoveryError) throw discoveryError;
        if (stall)
          return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true }
            );
            onDiscovery();
          });
        if (httpStatus !== 200)
          return new Response("fixture-secret-never-return", {
            status: httpStatus,
          });
      }
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : {
              tools: tools.map((name) => ({
                name,
                inputSchema: { type: "object", properties: {} },
              })),
            };
      return Response.json(
        { jsonrpc: "2.0", id: body.id, result },
        { headers: { "mcp-session-id": "fixture-session" } }
      );
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("discovers saved tools with Vault headers, explains effective permissions, and closes without executing tools", async () => {
  row.extra = {
    default_tools_approval_mode: "prompt",
    tools: {
      search: { approval_mode: "approve" },
      delete: { approval_mode: "deny" },
    },
  };
  const result = await testSavedMcpServer("owner", id);
  expect(result).toMatchObject({
    status: "success",
    enabled: true,
    serverUpdatedAt: row.updated_at,
    tools: [
      { name: "search", approval: "approve" },
      { name: "publish", approval: "prompt" },
      { name: "delete", approval: "deny" },
    ],
  });
  expect(methods).toContain("tools/list");
  expect(methods).not.toContain("tools/call");
  expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  expect(
    requests
      .filter((r) => r.url.startsWith("https://8.8.8.8"))
      .every(
        (r) =>
          r.headers.get("authorization") ===
          "Bearer fixture-secret-never-return"
      )
  ).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /fixture-secret|header_refs|8\.8\.8\.8/
  );
});

it.each(["other", "owner"])(
  "isolates missing or other-owner servers before credentials are read (%s)",
  async (user) => {
    expect(
      await testSavedMcpServer(user, user === "owner" ? "missing-id" : id)
    ).toBeNull();
    expect(requests).toHaveLength(1);
  }
);

it("reports database failure without treating it as a missing server or exposing details", async () => {
  databaseFailure = true;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const result = await testSavedMcpServer("owner", id);
  expect(result).toMatchObject({
    status: "error",
    code: "settings_unavailable",
  });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(methods).toEqual([]);
  expect(warning).toHaveBeenCalledWith(
    "[mcp-servers] Connection test failed",
    expect.objectContaining({
      code: "settings_unavailable",
      databaseCode: "DB_UNAVAILABLE",
    })
  );
  expect(JSON.stringify(warning.mock.calls)).not.toContain("fixture-secret");
});

it("recognizes authentication errors nested in a transport failure", async () => {
  discoveryError = new Error("fixture-secret-never-return", {
    cause: { statusCode: 401 },
  });
  const result = await testSavedMcpServer("owner", id);
  expect(result).toMatchObject({ status: "error", code: "authentication" });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
});

it("reports disabled and empty servers truthfully while allowing a test", async () => {
  row.enabled = false;
  tools = [];
  expect(await testSavedMcpServer("owner", id)).toMatchObject({
    status: "success",
    enabled: false,
    tools: [],
  });
});

it.each([
  { change: { transport: "stdio" as const }, code: "cli_only" },
  { change: { url: "http://127.0.0.1/mcp" }, code: "unsafe_url" },
  { change: { url: "file:///etc/passwd" }, code: "unsafe_url" },
  { change: { extra: { enabled_tools: "all" } }, code: "invalid_policy" },
])(
  "returns $code before reading secrets or contacting the server",
  async ({ change, code }) => {
    Object.assign(row, change);
    expect(await testSavedMcpServer("owner", id)).toMatchObject({
      status: "error",
      code,
    });
    expect(requests).toHaveLength(1);
  }
);

it("reports a missing secret without trying anonymous access", async () => {
  missingSecret = true;
  expect(await testSavedMcpServer("owner", id)).toMatchObject({
    status: "error",
    code: "missing_secret",
  });
  expect(methods).toEqual([]);
});

it.each([401, 403, 404])(
  "classifies HTTP %s without returning the upstream body",
  async (status) => {
    httpStatus = status;
    const result = await testSavedMcpServer("owner", id);
    expect(result).toMatchObject({
      status: "error",
      code: status === 404 ? "connection" : "authentication",
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    // A 404 expires the SDK's session, so there is no session left to delete.
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(
      status === 404 ? 0 : 1
    );
  }
);

it("bounds stalled discovery and aborts the network request", async () => {
  vi.useFakeTimers();
  stall = true;
  const started = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  const result = testSavedMcpServer("owner", id);
  await started;
  await vi.advanceTimersByTimeAsync(6001);
  expect(await result).toMatchObject({ status: "error", code: "timeout" });
  expect(
    requests.filter((request) => request.method === "DELETE")
  ).toHaveLength(1);
  expect(
    requests.some(
      (r) => r.url.startsWith("https://8.8.8.8") && r.signal.aborted
    )
  ).toBe(true);
});

it("honors request cancellation", async () => {
  stall = true;
  const started = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  const controller = new AbortController();
  const result = testSavedMcpServer("owner", id, controller.signal);
  await started;
  controller.abort();
  expect(await result).toMatchObject({ status: "error", code: "timeout" });
  expect(
    requests.filter((request) => request.method === "DELETE")
  ).toHaveLength(1);
});

it("preserves successful discovery while bounding a stalled session close", async () => {
  vi.useFakeTimers();
  stallClose = true;
  const closing = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  const result = testSavedMcpServer("owner", id);
  await closing;
  await vi.advanceTimersByTimeAsync(2001);
  expect(await result).toMatchObject({
    status: "success",
    tools: [{ name: "search" }, { name: "publish" }, { name: "delete" }],
  });
  expect(
    requests.find((request) => request.method === "DELETE")?.signal.aborted
  ).toBe(true);
});

it("bounds stalled discovery plus stalled teardown within eight seconds", async () => {
  vi.useFakeTimers();
  stall = true;
  stallClose = true;
  const started = new Promise<void>((resolve) => {
    onDiscovery = resolve;
  });
  const result = testSavedMcpServer("owner", id);
  await started;
  await vi.advanceTimersByTimeAsync(8001);
  expect(await result).toMatchObject({ status: "error", code: "timeout" });
  expect(
    requests.find((request) => request.method === "DELETE")?.signal.aborted
  ).toBe(true);
});
