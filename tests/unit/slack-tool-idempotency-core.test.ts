import assert from "node:assert/strict";
import test from "node:test";
import type { ToolSet } from "ai";
import {
  SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES,
  SLACK_STATIC_MUTATION_TOOL_NAMES,
  SLACK_STATIC_READ_ONLY_TOOL_NAMES,
  wrapToolsWithSlackIdempotency,
} from "../../lib/agents/slack-tool-idempotency";
import {
  createMemoryStore,
  executableTool,
  callTool,
} from "./helpers/slack-tool-idempotency-fixtures";

test("treats wrapper reconstruction in one scope as a retry replay", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => {
      executions += 1;
      return {
        ok: true,
        issueNumber: 123,
        issueUrl: "https://github.com/webrenew/tools/issues/123",
      };
    }),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const firstAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });
  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });

  const first = await callTool(firstAttempt, "github_create_issue");
  const replay = await callTool(retryAttempt, "github_create_issue");

  assert.equal(executions, 1);
  assert.deepEqual(replay, first);
});

test("keeps intentional duplicate calls distinct by occurrence and replays each one", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => {
      executions += 1;
      return { issueNumber: executions };
    }),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const firstAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });
  assert.deepEqual(await callTool(firstAttempt, "github_create_issue"), {
    issueNumber: 1,
  });
  assert.deepEqual(await callTool(firstAttempt, "github_create_issue"), {
    issueNumber: 2,
  });

  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });
  assert.deepEqual(await callTool(retryAttempt, "github_create_issue"), {
    issueNumber: 1,
  });
  assert.deepEqual(await callTool(retryAttempt, "github_create_issue"), {
    issueNumber: 2,
  });
  assert.equal(executions, 2);
});

test("protects MCP tools and mutating REST calls but leaves reads uncached", async () => {
  const { store } = createMemoryStore();
  const counts = { mcp: 0, restGet: 0, restHead: 0, restPost: 0, web: 0 };
  const tools = {
    linear_create_issue: executableTool(() => ({ run: ++counts.mcp })),
    stripe_connection: executableTool((input) => {
      const method = (input as { method?: string }).method;
      if (method === "POST") return { run: ++counts.restPost };
      if (method === "HEAD") return { run: ++counts.restHead };
      return { run: ++counts.restGet };
    }),
    web_search: executableTool(() => ({ run: ++counts.web })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set(["linear_create_issue"]),
    restToolNames: new Set(["stripe_connection"]),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wrapped = wrapToolsWithSlackIdempotency(tools, context, { store });
    await callTool(wrapped, "linear_create_issue", { title: "Billing bug" });
    await callTool(wrapped, "stripe_connection", {
      method: "POST",
      path: "/v1/customers",
    });
    await callTool(wrapped, "stripe_connection", {
      method: "GET",
      path: "/v1/customers",
    });
    await callTool(wrapped, "stripe_connection", {
      method: "HEAD",
      path: "/v1/customers",
    });
    await callTool(wrapped, "web_search", { query: "Stripe metadata" });
  }

  assert.deepEqual(counts, {
    mcp: 1,
    restGet: 2,
    restHead: 2,
    restPost: 1,
    web: 2,
  });
});

test("leaves the read-only github_api tool uncached", async () => {
  const { store } = createMemoryStore();
  const executions = { read: 0, write: 0 };
  const tools = {
    github_api: executableTool((input) => {
      const method = (input as { method: string }).method;
      return method === "POST"
        ? { run: ++executions.write }
        : { run: ++executions.read };
    }),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await callTool(
      wrapToolsWithSlackIdempotency(tools, context, { store }),
      "github_api",
      { path: "/repos/webrenew/mogplex", method: "GET" }
    );
    await callTool(
      wrapToolsWithSlackIdempotency(tools, context, { store }),
      "github_api",
      { path: "/repos/webrenew/mogplex", method: "HEAD" }
    );
    await callTool(
      wrapToolsWithSlackIdempotency(tools, context, { store }),
      "github_api",
      { path: "/repos/webrenew/mogplex/issues", method: "POST" }
    );
  }

  assert.deepEqual(executions, { read: 4, write: 1 });
});

test("fails closed for static and newly added tools that are not explicitly read-only", async () => {
  const { store } = createMemoryStore();
  const counts = { virtualExec: 0, futureWrite: 0, web: 0 };
  const tools = {
    virtual_exec: executableTool(() => ({ run: ++counts.virtualExec })),
    future_write: executableTool(() => ({ run: ++counts.futureWrite })),
    web_search: executableTool(() => ({ run: ++counts.web })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wrapped = wrapToolsWithSlackIdempotency(tools, context, { store });
    await callTool(wrapped, "virtual_exec", { command: "printf safe" });
    await callTool(wrapped, "future_write", { value: "mutate" });
    await callTool(wrapped, "web_search", { query: "safe read" });
  }

  assert.deepEqual(counts, {
    virtualExec: 1,
    futureWrite: 1,
    web: 2,
  });
});

test("explicitly classifies every registered static tool", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { TOOL_CAPABILITY } = await import("../../lib/agents/tools");
  const classified = new Set([
    ...SLACK_STATIC_READ_ONLY_TOOL_NAMES,
    ...SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES,
    ...SLACK_STATIC_MUTATION_TOOL_NAMES,
  ]);

  assert.deepEqual(classified, new Set(Object.keys(TOOL_CAPABILITY)));
  assert.deepEqual(
    [...SLACK_STATIC_READ_ONLY_TOOL_NAMES].filter((name) =>
      SLACK_STATIC_MUTATION_TOOL_NAMES.has(name)
    ),
    []
  );
  assert.deepEqual(
    [...SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES].filter(
      (name) =>
        SLACK_STATIC_READ_ONLY_TOOL_NAMES.has(name) ||
        SLACK_STATIC_MUTATION_TOOL_NAMES.has(name)
    ),
    []
  );
});
