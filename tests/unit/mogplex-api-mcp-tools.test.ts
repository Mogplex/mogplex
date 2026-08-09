import assert from "node:assert/strict";
import test from "node:test";

import { MogplexApiClientError } from "../../lib/mogplex-api/client";
import {
  MOGPLEX_MCP_PROTOCOL_VERSION,
  MOGPLEX_MCP_TOOLS,
  handleMogplexMcpPayload,
} from "../../lib/mogplex-api/mcp";
import type { MogplexApiRunDetail } from "../../lib/mogplex-api/runs";

import {
  assertSingleMcpResponse,
  buildFakeMcpClient,
  buildRun,
} from "./helpers/mogplex-api-mcp-fixtures";

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
      "mogplex_rerun_pr_review",
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

test("Mogplex MCP rerun PR review forwards repo and PR number to the API", async () => {
  const calls: unknown[] = [];
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "rerun-pr-review-1",
      method: "tools/call",
      params: {
        name: "mogplex_rerun_pr_review",
        arguments: { repoId: "repo-1", prNumber: 42 },
      },
    },
    {
      client: buildFakeMcpClient({
        rerunPrReview: async (input) => {
          calls.push(input);
          return {
            queued: true,
            jobRunId: "job-rerun-1",
            prNumber: input.prNumber,
            repoId: input.repoId,
            started: true,
            deferred: false,
            reason: null,
            status: "running",
            runtimeProvider: "trigger",
            runtimeRunId: "runtime-1",
            workflowRunId: "workflow-1",
            versionFallbackUsed: false,
          };
        },
      }),
    }
  );

  assert.deepEqual(calls, [{ repoId: "repo-1", prNumber: 42 }]);
  const result = (
    assertSingleMcpResponse(response) as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: { jobRunId: string; queued: boolean };
      };
    }
  ).result;
  assert.equal(result.structuredContent.queued, true);
  assert.equal(result.structuredContent.jobRunId, "job-rerun-1");
  assert.match(result.content[0]?.text ?? "", /PR #42/);
});

test("Mogplex MCP rerun PR review rejects invalid arguments before calling the API", async () => {
  const response = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "rerun-pr-review-bad",
      method: "tools/call",
      params: {
        name: "mogplex_rerun_pr_review",
        arguments: { repoId: "repo-1", prNumber: 0 },
      },
    },
    {
      client: buildFakeMcpClient({
        rerunPrReview: async () => {
          throw new Error("should not reach the API for invalid arguments");
        },
      }),
    }
  );

  const parsed = assertSingleMcpResponse(response) as {
    error?: { code: number; message: string };
  };
  assert.equal(parsed.error?.code, -32602);
  assert.match(String(parsed.error?.message), /prNumber/);
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
