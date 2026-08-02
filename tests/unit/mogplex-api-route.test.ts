import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

async function loadReposRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/repos/route");
}

async function loadSandboxesRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/sandboxes/route");
}

async function loadMcpServersRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/mcp/servers/route");
}

async function loadMogplexApiRequestHelpers() {
  return import("../../lib/mogplex-api/request");
}

async function withConsoleErrorSilenced<T>(callback: () => Promise<T>) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = originalConsoleError;
  }
}

test("GET /api/v1/mogplex/repos returns repos in the external envelope", async () => {
  const { createMogplexApiReposGetHandler } = await loadReposRoute();
  const authCalls: Array<string | null> = [];
  const calls: Array<{
    userId: string;
    options: { query?: string | null; limit?: number };
  }> = [];
  const handler = createMogplexApiReposGetHandler({
    resolveApiKey: async (authorization) => {
      authCalls.push(authorization);
      return {
        ok: true,
        auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
      };
    },
    listRepos: async (userId, options) => {
      calls.push({ userId, options: options ?? {} });
      return [
        {
          id: "repo-1",
          full_name: "webrenew/mogplex",
          installation_id: 123,
          default_branch: "main",
          root_directory: null,
        },
      ];
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos?q=mog&limit=500", {
      headers: { authorization: "Bearer mog_valid" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      repos: [
        {
          id: "repo-1",
          full_name: "webrenew/mogplex",
          installation_id: 123,
          default_branch: "main",
          root_directory: null,
        },
      ],
    },
  });
  assert.deepEqual(calls, [
    { userId: "user-123", options: { query: "mog", id: null, limit: 200 } },
  ]);
  assert.deepEqual(authCalls, ["Bearer mog_valid"]);
});

test("GET /api/v1/mogplex/repos forwards an id lookup to the repo list", async () => {
  const { createMogplexApiReposGetHandler } = await loadReposRoute();
  const calls: Array<{
    userId: string;
    options: { query?: string | null; id?: string | null; limit?: number };
  }> = [];
  const repoId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const handler = createMogplexApiReposGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listRepos: async (userId, options) => {
      calls.push({ userId, options: options ?? {} });
      return [
        {
          id: repoId,
          full_name: "webrenew/hidden-gem",
          installation_id: 456,
          default_branch: "main",
          root_directory: null,
        },
      ];
    },
  });

  const response = await handler(
    new NextRequest(`http://localhost/api/v1/mogplex/repos?id=${repoId}`, {
      headers: { authorization: "Bearer mog_valid" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.repos[0]?.id, repoId);
  assert.deepEqual(calls, [
    { userId: "user-123", options: { query: null, id: repoId, limit: 100 } },
  ]);
});

test("GET /api/v1/mogplex/repos rejects requests without a PAT", async () => {
  const { createMogplexApiReposGetHandler } = await loadReposRoute();
  let authCalls = 0;
  const handler = createMogplexApiReposGetHandler({
    resolveApiKey: async () => {
      authCalls += 1;
      return {
        ok: true,
        auth: { userId: "browser-session-user", keyId: "key-1", scopes: [] },
      };
    },
    listRepos: async () => [],
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos")
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    },
  });
  assert.equal(authCalls, 0);
});

test("GET /api/v1/mogplex/repos rejects invalid PATs without falling back to session auth", async () => {
  const { createMogplexApiReposGetHandler } = await loadReposRoute();
  const authCalls: Array<string | null> = [];
  const handler = createMogplexApiReposGetHandler({
    resolveApiKey: async (authorization) => {
      authCalls.push(authorization);
      return { ok: false, reason: "invalid" };
    },
    listRepos: async () => {
      throw new Error("listRepos should not run");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/repos", {
      headers: { authorization: "Bearer mog_invalid" },
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    },
  });
  assert.deepEqual(authCalls, ["Bearer mog_invalid"]);
});

test("GET /api/v1/mogplex/repos returns generic envelope internal errors", async () => {
  const { createMogplexApiReposGetHandler } = await loadReposRoute();
  const handler = createMogplexApiReposGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"],
      },
    }),
    listRepos: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await withConsoleErrorSilenced(() =>
    handler(
      new NextRequest("http://localhost/api/v1/mogplex/repos", {
        headers: { authorization: "Bearer mog_valid" },
      })
    )
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to list repos",
    },
  });
});

test("GET /api/v1/mogplex/sandboxes returns filtered sandboxes in the external envelope", async () => {
  const { createMogplexApiSandboxesGetHandler } = await loadSandboxesRoute();
  const calls: Array<{
    userId: string;
    options: { repoId?: string | null; status?: string | null; limit?: number };
  }> = [];
  const handler = createMogplexApiSandboxesGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"],
      },
    }),
    listSandboxes: async (userId, options) => {
      calls.push({ userId, options: options ?? {} });
      return [
        {
          id: "sandbox-record-1",
          sandbox_id: "sbx_123",
          repo_id: "repo-1",
          status: "running",
          base_branch: "main",
          working_branch: "mogplex/external/run-1",
          root_directory: "apps/web",
          preview_url: "https://preview.example",
          created_at: "2026-04-27T00:00:00.000Z",
          last_active_at: "2026-04-27T00:01:00.000Z",
          error: null,
        },
      ];
    },
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/sandboxes?repo_id=repo-1&status=running&limit=12",
      { headers: { authorization: "Bearer mog_valid" } }
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sandboxes.length, 1);
  assert.equal(
    payload.data.sandboxes[0].working_branch,
    "mogplex/external/run-1"
  );
  assert.deepEqual(calls, [
    {
      userId: "user-123",
      options: { repoId: "repo-1", status: "running", limit: 12 },
    },
  ]);
});

test("GET /api/v1/mogplex/sandboxes returns generic envelope internal errors", async () => {
  const { createMogplexApiSandboxesGetHandler } = await loadSandboxesRoute();
  const handler = createMogplexApiSandboxesGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"],
      },
    }),
    listSandboxes: async () => {
      throw new Error("sandboxes table missing");
    },
  });

  const response = await withConsoleErrorSilenced(() =>
    handler(
      new NextRequest("http://localhost/api/v1/mogplex/sandboxes", {
        headers: { authorization: "Bearer mog_valid" },
      })
    )
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to list sandboxes",
    },
  });
});

test("GET /api/v1/mogplex/mcp/servers returns merged servers in the external envelope", async () => {
  const { createMogplexApiMcpServersGetHandler } = await loadMcpServersRoute();
  const calls: Array<{ userId: string }> = [];
  const handler = createMogplexApiMcpServersGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listServers: async (userId) => {
      calls.push({ userId });
      return [
        {
          name: "custom-server",
          enabled: true,
          config: { command: "node", args: ["server.js"] },
        },
        {
          name: "linear",
          enabled: true,
          config: {
            url: "https://mcp.linear.app",
            http_headers: { Authorization: "Bearer secret" },
          },
        },
      ];
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp/servers", {
      headers: { authorization: "Bearer mog_valid" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.servers.length, 2);
  assert.equal(payload.data.servers[0].name, "custom-server");
  assert.deepEqual(calls, [{ userId: "user-123" }]);
});

test("GET /api/v1/mogplex/mcp/servers rejects requests without a PAT", async () => {
  const { createMogplexApiMcpServersGetHandler } = await loadMcpServersRoute();
  const handler = createMogplexApiMcpServersGetHandler({
    resolveApiKey: async () => {
      throw new Error("resolveApiKey should not run");
    },
    listServers: async () => {
      throw new Error("listServers should not run");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp/servers")
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "UNAUTHORIZED", message: "Unauthorized" },
  });
});

test("GET /api/v1/mogplex/mcp/servers rejects PATs without the read scope", async () => {
  const { createMogplexApiMcpServersGetHandler } = await loadMcpServersRoute();
  const handler = createMogplexApiMcpServersGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: [] },
    }),
    listServers: async () => {
      throw new Error("listServers should not run for forbidden scope");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp/servers", {
      headers: { authorization: "Bearer mog_valid" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "FORBIDDEN");
});

test("GET /api/v1/mogplex/mcp/servers returns generic envelope internal errors", async () => {
  const { createMogplexApiMcpServersGetHandler } = await loadMcpServersRoute();
  const handler = createMogplexApiMcpServersGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listServers: async () => {
      throw new Error("supabase outage");
    },
  });

  const response = await withConsoleErrorSilenced(() =>
    handler(
      new NextRequest("http://localhost/api/v1/mogplex/mcp/servers", {
        headers: { authorization: "Bearer mog_valid" },
      })
    )
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Failed to list MCP servers" },
  });
});

test("mogplex API request helpers cap list limits and reject long idempotency keys", async () => {
  const {
    MOGPLEX_API_IDEMPOTENCY_KEY_HEADER,
    parseMogplexApiListLimit,
    readMogplexApiIdempotencyKey,
  } = await loadMogplexApiRequestHelpers();

  assert.equal(parseMogplexApiListLimit("500"), 200);
  assert.equal(parseMogplexApiListLimit("0"), 1);
  assert.equal(parseMogplexApiListLimit("not-a-number"), 100);

  assert.equal(
    readMogplexApiIdempotencyKey(
      new Headers({ [MOGPLEX_API_IDEMPOTENCY_KEY_HEADER]: "run-123" })
    ),
    "run-123"
  );
  assert.equal(
    readMogplexApiIdempotencyKey(
      new Headers({
        [MOGPLEX_API_IDEMPOTENCY_KEY_HEADER]: "x".repeat(201),
      })
    ),
    null
  );
});
