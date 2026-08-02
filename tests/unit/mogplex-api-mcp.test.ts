import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  MogplexApiClient,
  MogplexApiClientError,
} from "../../lib/mogplex-api/client";
import {
  MOGPLEX_MCP_PROTOCOL_VERSION,
  MOGPLEX_MCP_TOOLS,
  handleMogplexMcpPayload,
  type MogplexMcpClient,
} from "../../lib/mogplex-api/mcp";
import type { MogplexApiAutomation } from "../../lib/mogplex-api/automations";
import type { MogplexApiRunDetail } from "../../lib/mogplex-api/runs";

type SingleMcpResponse = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

async function loadMcpRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/mcp/route");
}

function buildRun(
  overrides: Partial<MogplexApiRunDetail> = {}
): MogplexApiRunDetail {
  return {
    runId: "run-1",
    aiCallId: "call-1",
    sandboxRecordId: "sandbox-record-1",
    sandboxId: "sbx_123",
    repoId: "repo-1",
    harness: "codex",
    status: "pending",
    branch: {
      base: "main",
      working: "mogplex/external/run-1",
      createBranch: true,
    },
    rootDirectory: null,
    eventsUrl: "/api/v1/mogplex/runs/run-1/events",
    cancelUrl: "/api/v1/mogplex/runs/run-1/cancel",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    error: null,
    runtime: {
      provider: "trigger",
      runId: "trigger-run-1",
    },
    ...overrides,
  };
}

function buildFakeMcpClient(
  overrides: Partial<MogplexMcpClient> = {}
): MogplexMcpClient {
  const run = buildRun();
  const automation: MogplexApiAutomation = {
    id: "automation-1",
    installationId: 123,
    name: "Review PRs",
    description: null,
    notes: null,
    status: "active",
    draftGraph: { nodes: [], edges: [] },
    publishedVersion: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    runSummary: {
      lastRunId: null,
      lastRunStatus: null,
      runningCount: 0,
      pendingCount: 0,
      failed24h: 0,
    },
  };
  return {
    listAgents: async () => ({ agents: [] }),
    listModels: async () => ({ models: [] }),
    listRepos: async () => ({ repos: [] }),
    listRepoEnvVars: async () => ({ envVars: [] }),
    upsertRepoEnvVar: async () => ({
      action: "created",
      key: "API_KEY",
      updatedCount: 1,
    }),
    deleteRepoEnvVar: async () => ({ key: "API_KEY", deletedCount: 1 }),
    listSandboxes: async () => ({ sandboxes: [] }),
    createSandbox: async () => ({
      sandbox: {
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
        repo_id: "repo-1",
        status: "running",
        base_branch: "main",
        working_branch: "main",
        root_directory: null,
        preview_url: null,
        created_at: "2026-07-20T00:00:00.000Z",
        last_active_at: "2026-07-20T00:00:00.000Z",
        error: null,
      },
    }),
    getSandboxLogs: async () => ({
      sandbox: {
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
        repo_id: "repo-1",
        status: "running",
        base_branch: "main",
        working_branch: "main",
        root_directory: null,
        preview_url: null,
        created_at: "2026-07-20T00:00:00.000Z",
        last_active_at: "2026-07-20T00:00:00.000Z",
        error: null,
        install_log: "installed",
        dev_log: "ready",
      },
      lifecycle_events: [],
    }),
    listAutomations: async () => ({
      automations: [
        {
          id: automation.id,
          installationId: automation.installationId,
          name: automation.name,
          description: automation.description,
          status: automation.status,
          publishedVersionId: null,
          createdAt: automation.createdAt,
          updatedAt: automation.updatedAt,
        },
      ],
      nextCursor: null,
    }),
    getAutomation: async () => ({ automation }),
    createAutomation: async () => ({ automation }),
    updateAutomation: async () => ({ automation }),
    publishAutomation: async () => ({ automation }),
    setAutomationModel: async () => ({ automation }),
    triggerAutomation: async () => ({
      run: {
        automationId: automation.id,
        jobRunId: "job-1",
        outcome: "queued",
        reason: null,
        started: true,
        status: "running",
        runtime: { provider: "trigger", runId: "runtime-1" },
      },
    }),
    listAutomationRuns: async () => ({ runs: [] }),
    getAutomationRunLogs: async () => ({ run: { id: "job-1" } as never }),
    startAgentRun: async () => ({ ...run, replayed: false }),
    getRun: async () => ({ run }),
    getRunEvents: async () => ({ run, events: [] }),
    cancelRun: async () => ({
      run: buildRun({ status: "cancelled" }),
      status: "cancelled",
    }),
    ...overrides,
  };
}

function assertSingleMcpResponse(response: unknown): SingleMcpResponse {
  assert.ok(response);
  assert.equal(Array.isArray(response), false);
  return response as SingleMcpResponse;
}

test("MogplexApiClient delegates list calls with PAT auth and query params", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        ok: true,
        data: {
          repos: [
            {
              id: "repo-1",
              full_name: "webrenew/mogplex",
              default_branch: "main",
              root_directory: null,
            },
          ],
        },
      });
    },
  });

  const result = await client.listRepos({ query: "mog", limit: 12 });

  assert.equal(result.repos.length, 1);
  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/repos?q=mog&limit=12",
      authorization: "Bearer mog_test",
    },
  ]);
});

test("MogplexApiClient sends automation pagination parameters", async () => {
  const seen: string[] = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({
        ok: true,
        data: { automations: [], nextCursor: "next-page" },
      });
    },
  });

  const result = await client.listAutomations({
    limit: 25,
    cursor: "current-page",
  });

  assert.deepEqual(seen, [
    "https://app.example/api/v1/mogplex/automations?limit=25&cursor=current-page",
  ]);
  assert.equal(result.nextCursor, "next-page");
});

test("MogplexApiClient surfaces Mogplex API error envelopes", async () => {
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "Bearer mog_test",
    fetch: async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Run not found",
          },
        },
        { status: 404 }
      ),
  });

  await assert.rejects(
    () => client.getRun({ runId: "missing" }),
    (error) => {
      assert.ok(error instanceof MogplexApiClientError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "Run not found");
      return true;
    }
  );
});

test("MogplexApiClient sends automation triggers through the scoped API with idempotency", async () => {
  const seen: Array<{
    url: string;
    method: string | undefined;
    idempotencyKey: string | null;
    body: string | null;
  }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Response.json({
        ok: true,
        data: {
          run: {
            automationId: "automation-1",
            jobRunId: "job-1",
            outcome: "queued",
            reason: null,
            started: true,
            status: "running",
            runtime: { provider: "trigger", runId: "runtime-1" },
          },
        },
      });
    },
  });

  await client.triggerAutomation({
    automationId: "automation-1",
    repoId: "repo-1",
    input: { pull_request: { number: 42 } },
    idempotencyKey: "tool-call-1",
  });

  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/automations/automation-1/trigger",
      method: "POST",
      idempotencyKey: "tool-call-1",
      body: JSON.stringify({
        repoId: "repo-1",
        input: { pull_request: { number: 42 } },
      }),
    },
  ]);
});

test("Mogplex MCP initialize and tools/list expose the run control tools", async () => {
  const initialize = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MOGPLEX_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0.1.0" },
      },
    },
    { client: buildFakeMcpClient() }
  );
  const tools = await handleMogplexMcpPayload(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { client: buildFakeMcpClient() }
  );

  const initializeResponse = assertSingleMcpResponse(initialize);
  const toolsResponse = assertSingleMcpResponse(tools);

  assert.equal(initializeResponse.jsonrpc, "2.0");
  assert.equal(
    (initializeResponse as { result: { protocolVersion: string } }).result
      .protocolVersion,
    MOGPLEX_MCP_PROTOCOL_VERSION
  );
  assert.deepEqual(
    (
      toolsResponse as { result: { tools: typeof MOGPLEX_MCP_TOOLS } }
    ).result.tools.map((tool) => tool.name),
    [
      "mogplex_list_repos",
      "mogplex_list_env_vars",
      "mogplex_set_env_var",
      "mogplex_delete_env_var",
      "mogplex_list_agents",
      "mogplex_list_models",
      "mogplex_list_sandboxes",
      "mogplex_create_sandbox",
      "mogplex_get_sandbox_logs",
      "mogplex_list_automations",
      "mogplex_get_automation",
      "mogplex_create_automation",
      "mogplex_update_automation",
      "mogplex_publish_automation",
      "mogplex_set_automation_model",
      "mogplex_trigger_automation",
      "mogplex_list_automation_runs",
      "mogplex_get_automation_run_logs",
      "mogplex_start_agent_run",
      "mogplex_get_run",
      "mogplex_get_run_events",
      "mogplex_cancel_run",
    ]
  );
});

test("Mogplex MCP start tool generates idempotency keys and returns structured run data", async () => {
  let seenIdempotencyKey: string | undefined;
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "start-1",
      method: "tools/call",
      params: {
        name: "mogplex_start_agent_run",
        arguments: {
          repoId: "repo-1",
          prompt: "Fix the failing test",
          createBranch: true,
        },
      },
    },
    {
      client: buildFakeMcpClient({
        startAgentRun: async (input) => {
          seenIdempotencyKey = input.idempotencyKey;
          return { ...buildRun(), replayed: false };
        },
      }),
    }
  );

  assert.match(String(seenIdempotencyKey), /^mcp:/);
  const result = (
    assertSingleMcpResponse(response) as {
      result: { structuredContent: { run: MogplexApiRunDetail } };
    }
  ).result;
  assert.equal(result.structuredContent.run.runId, "run-1");
  assert.equal(
    result.structuredContent.run.branch.working,
    "mogplex/external/run-1"
  );
});

test("Mogplex MCP automation trigger generates an idempotency key", async () => {
  let seenIdempotencyKey: string | undefined;
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "automation-start-1",
      method: "tools/call",
      params: {
        name: "mogplex_trigger_automation",
        arguments: {
          automationId: "automation-1",
          repoId: "repo-1",
        },
      },
    },
    {
      client: buildFakeMcpClient({
        triggerAutomation: async (input) => {
          seenIdempotencyKey = input.idempotencyKey;
          return {
            run: {
              automationId: input.automationId,
              jobRunId: "job-1",
              outcome: "queued",
              reason: null,
              started: true,
              status: "running",
              runtime: { provider: "trigger", runId: "runtime-1" },
            },
          };
        },
      }),
    }
  );

  assert.match(String(seenIdempotencyKey), /^mcp:/);
  const result = (
    assertSingleMcpResponse(response) as {
      result: { structuredContent: { run: { jobRunId: string } } };
    }
  ).result;
  assert.equal(result.structuredContent.run.jobRunId, "job-1");
});

test("Mogplex MCP automation listing forwards bounded pagination", async () => {
  const calls: unknown[] = [];
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "automation-list-1",
      method: "tools/call",
      params: {
        name: "mogplex_list_automations",
        arguments: { limit: 25, cursor: "current-page" },
      },
    },
    {
      client: buildFakeMcpClient({
        listAutomations: async (input) => {
          calls.push(input);
          return { automations: [], nextCursor: "next-page" };
        },
      }),
    }
  );

  assert.deepEqual(calls, [{ limit: 25, cursor: "current-page" }]);
  const result = (
    assertSingleMcpResponse(response) as {
      result: { structuredContent: { nextCursor: string } };
    }
  ).result;
  assert.equal(result.structuredContent.nextCursor, "next-page");
});

test("Mogplex MCP env var tools list, set, and delete through the client", async () => {
  const calls: Array<{ tool: string; input: unknown }> = [];
  const client = buildFakeMcpClient({
    listRepoEnvVars: async (input) => {
      calls.push({ tool: "list", input });
      return {
        envVars: [
          {
            id: "env-1",
            key: "DATABASE_URL",
            target: ["production", "preview", "development"],
            type: "encrypted",
            updatedAt: null,
          },
        ],
      };
    },
    upsertRepoEnvVar: async (input) => {
      calls.push({ tool: "set", input });
      return { action: "created", key: input.key, updatedCount: 1 };
    },
    deleteRepoEnvVar: async (input) => {
      calls.push({ tool: "delete", input });
      return { key: input.key, deletedCount: 2 };
    },
  });

  const listResponse = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "env-list",
      method: "tools/call",
      params: {
        name: "mogplex_list_env_vars",
        arguments: { repoId: "repo-1" },
      },
    },
    { client }
  );
  const setResponse = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "env-set",
      method: "tools/call",
      params: {
        name: "mogplex_set_env_var",
        arguments: {
          repoId: "repo-1",
          key: "STRIPE_SECRET_KEY",
          value: "sk_test_123",
          target: ["production", "preview"],
          type: "sensitive",
        },
      },
    },
    { client }
  );
  const deleteResponse = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "env-delete",
      method: "tools/call",
      params: {
        name: "mogplex_delete_env_var",
        arguments: { repoId: "repo-1", key: "OLD_KEY" },
      },
    },
    { client }
  );

  assert.deepEqual(calls, [
    { tool: "list", input: { repoId: "repo-1" } },
    {
      tool: "set",
      input: {
        repoId: "repo-1",
        key: "STRIPE_SECRET_KEY",
        value: "sk_test_123",
        target: ["production", "preview"],
        type: "sensitive",
      },
    },
    { tool: "delete", input: { repoId: "repo-1", key: "OLD_KEY" } },
  ]);

  const listResult = (
    assertSingleMcpResponse(listResponse) as {
      result: {
        structuredContent: { envVars: Array<{ key: string; value?: string }> };
      };
    }
  ).result;
  assert.equal(listResult.structuredContent.envVars[0]?.key, "DATABASE_URL");
  assert.equal(
    "value" in (listResult.structuredContent.envVars[0] ?? {}),
    false
  );

  const setResult = (
    assertSingleMcpResponse(setResponse) as {
      result: { structuredContent: { action: string } };
    }
  ).result;
  assert.equal(setResult.structuredContent.action, "created");

  const deleteResult = (
    assertSingleMcpResponse(deleteResponse) as {
      result: { structuredContent: { deletedCount: number } };
    }
  ).result;
  assert.equal(deleteResult.structuredContent.deletedCount, 2);
});

test("Mogplex MCP rejects invalid env var keys before calling the API", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "env-bad-key",
      method: "tools/call",
      params: {
        name: "mogplex_set_env_var",
        arguments: { repoId: "repo-1", key: "1BAD-KEY", value: "x" },
      },
    },
    {
      client: buildFakeMcpClient({
        upsertRepoEnvVar: async () => {
          throw new Error("should not reach the API for invalid keys");
        },
      }),
    }
  );

  const parsed = assertSingleMcpResponse(response) as {
    error?: { code: number; message: string };
  };
  assert.equal(parsed.error?.code, -32602);
  assert.match(String(parsed.error?.message), /key/);
});

test("MogplexApiClient sends env var mutations to the repo-scoped endpoint", async () => {
  const seen: Array<{
    url: string;
    method: string | undefined;
    body: string | null;
  }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Response.json({
        ok: true,
        data: { action: "created", key: "API_KEY", updatedCount: 1 },
      });
    },
  });

  await client.upsertRepoEnvVar({
    repoId: "repo-1",
    key: "API_KEY",
    value: "secret",
    target: ["production"],
  });

  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/repos/repo-1/env-vars",
      method: "POST",
      body: JSON.stringify({
        key: "API_KEY",
        value: "secret",
        target: ["production"],
      }),
    },
  ]);
});

test("Mogplex MCP returns protocol errors for invalid tool arguments", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "bad-args",
      method: "tools/call",
      params: {
        name: "mogplex_start_agent_run",
        arguments: {
          prompt: "Missing repo id",
        },
      },
    },
    { client: buildFakeMcpClient() }
  );

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: "bad-args",
    error: {
      code: -32602,
      message: "repoId: Required",
    },
  });
});

test("Mogplex MCP maps API failures into tool execution errors", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "get-1",
      method: "tools/call",
      params: {
        name: "mogplex_get_run",
        arguments: { runId: "missing" },
      },
    },
    {
      client: buildFakeMcpClient({
        getRun: async () => {
          throw new MogplexApiClientError("NOT_FOUND", "Run not found", 404);
        },
      }),
    }
  );

  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string } };
      };
    }
  ).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "NOT_FOUND");
});

test("POST /api/v1/mogplex/mcp advertises OAuth when authentication is missing", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async () => {
      throw new Error("resolveApiKey should not run");
    },
    createClient: () => buildFakeMcpClient(),
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("www-authenticate"),
    'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/v1/mogplex/mcp"'
  );
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32001,
      message: "Unauthorized",
      data: {
        code: "UNAUTHORIZED",
        suggestion: "Sign in with OAuth or configure a Mogplex API token.",
      },
    },
  });
});

test("POST /api/v1/mogplex/mcp accepts OAuth bearer tokens", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async () => {
      throw new Error("PAT resolver should not run for OAuth tokens");
    },
    resolveOAuthToken: async (authorization) => {
      assert.equal(authorization, "Bearer oauth.jwt.token");
      return {
        ok: true,
        auth: {
          userId: "profile-123",
          keyId: "oauth-client-1",
          scopes: ["read", "write"],
        },
      };
    },
    createClient: ({ authorization }) => {
      assert.equal(authorization, "Bearer oauth.jwt.token");
      return buildFakeMcpClient();
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      headers: { authorization: "Bearer oauth.jwt.token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.tools.length, 22);
});

test("POST /api/v1/mogplex/mcp handles authenticated tools/list", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async (authorization) => {
      assert.equal(authorization, "Bearer mog_valid");
      return {
        ok: true,
        auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
      };
    },
    createClient: ({ authorization }) => {
      assert.equal(authorization, "Bearer mog_valid");
      return buildFakeMcpClient();
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-protocol-version"), "2025-11-25");
  assert.equal(payload.result.tools.length, 22);
});

test("OPTIONS /api/v1/mogplex/mcp rejects origins outside the allow-list", async () => {
  const { OPTIONS } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = "https://chat.example.com";
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const response = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://attacker.example",
        },
      })
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-headers"), null);
    assert.equal(response.headers.get("access-control-allow-methods"), null);
    assert.equal(response.headers.get("access-control-max-age"), null);
    assert.equal(response.headers.get("vary"), "origin");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "[mogplex-mcp/cors] rejected origin");
  } finally {
    console.warn = originalConsoleWarn;
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});

test("OPTIONS /api/v1/mogplex/mcp logs cross-origin rejections when no allow-list is configured", async () => {
  const { OPTIONS } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const response = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://chat.example.com",
        },
      })
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-headers"), null);
    assert.equal(response.headers.get("access-control-allow-methods"), null);
    assert.equal(response.headers.get("access-control-max-age"), null);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], {
      origin: "https://chat.example.com",
      requestOrigin: "https://mogplex.example",
      allowedOrigins: [],
    });
  } finally {
    console.warn = originalConsoleWarn;
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});

test("Mogplex MCP batch isolates unexpected parser failures", async () => {
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const crashingMessage = { jsonrpc: "2.0", method: "ping" };
  Object.defineProperty(crashingMessage, "id", {
    get() {
      throw new Error("id exploded");
    },
  });

  try {
    const response = await handleMogplexMcpPayload(
      [{ jsonrpc: "2.0", id: "ok", method: "tools/list" }, crashingMessage],
      { client: buildFakeMcpClient() }
    );

    assert.ok(Array.isArray(response));
    assert.equal(response.length, 2);
    assert.equal(response[0]?.jsonrpc, "2.0");
    assert.equal("result" in response[0]!, true);
    assert.deepEqual(response[1], {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: "Mogplex MCP request failed",
        data: {
          code: "INTERNAL_ERROR",
        },
      },
    });
    assert.equal(errors[0]?.[0], "[mogplex-mcp] unexpected message failure");
  } finally {
    console.error = originalConsoleError;
  }
});

test("OPTIONS and POST /api/v1/mogplex/mcp reflect allowed origins", async () => {
  const { OPTIONS, createMogplexMcpPostHandler } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = "https://chat.example.com";

  try {
    const preflight = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://chat.example.com",
        },
      })
    );
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-headers"),
      "authorization, content-type, mcp-protocol-version, mcp-session-id"
    );
    assert.equal(
      preflight.headers.get("access-control-allow-methods"),
      "POST, OPTIONS"
    );
    assert.equal(preflight.headers.get("access-control-max-age"), "86400");
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://chat.example.com"
    );

    const handler = createMogplexMcpPostHandler({
      resolveApiKey: async () => ({
        ok: true,
        auth: {
          userId: "user-123",
          keyId: "key-1",
          scopes: ["read"],
        },
      }),
      createClient: () => buildFakeMcpClient(),
    });
    const response = await handler(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer mog_valid",
          origin: "https://chat.example.com",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://chat.example.com"
    );
  } finally {
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});
