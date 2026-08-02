import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabaseSlackToolExecutionStore,
  MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS,
  MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES,
  SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES,
  SLACK_STATIC_MUTATION_TOOL_NAMES,
  SLACK_STATIC_READ_ONLY_TOOL_NAMES,
  wrapToolsWithSlackIdempotency,
  type SlackToolExecutionRecord,
  type SlackToolExecutionStore,
} from "../../lib/agents/slack-tool-idempotency";
import type { ToolSet } from "ai";

const UNCERTAIN_REPLAY_ERROR =
  "This action already failed, was suppressed, or returned an uncertain result during this Slack event. It was not retried automatically.";

function executionKey(
  input: Pick<
    SlackToolExecutionRecord,
    "scopeKey" | "userId" | "toolName" | "inputHash" | "occurrence"
  >
) {
  return [
    input.scopeKey,
    input.userId,
    input.toolName,
    input.inputHash,
    input.occurrence,
  ].join(":");
}

function createMemoryStore() {
  const records = new Map<string, SlackToolExecutionRecord>();
  const store: SlackToolExecutionStore = {
    reserve: async (input) => {
      const key = executionKey(input);
      const existing = records.get(key);
      if (existing) return { acquired: false, record: existing };

      const record: SlackToolExecutionRecord = {
        id: `execution-${records.size + 1}`,
        ...input,
        status: "started",
        output: null,
        error: null,
      };
      records.set(key, record);
      return { acquired: true, record };
    },
    complete: async (input) => {
      const record = Array.from(records.values()).find(
        (candidate) => candidate.id === input.executionId
      );
      assert.ok(record);
      record.status = "completed";
      record.output = input.output;
    },
    fail: async (input) => {
      const record = Array.from(records.values()).find(
        (candidate) => candidate.id === input.executionId
      );
      assert.ok(record);
      record.status = "failed";
      record.error = input.error;
    },
  };
  return { store, records };
}

function executableTool(execute: (input: unknown) => unknown) {
  return {
    description: "test tool",
    inputSchema: {},
    execute,
  };
}

async function callTool(tools: ToolSet, name: string, input?: unknown) {
  const execute = tools[name]?.execute;
  assert.equal(typeof execute, "function");
  return execute!((input ?? { title: "Fix billing metadata" }) as never, {
    toolCallId: `${name}-call`,
    messages: [],
  });
}

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

test("fails closed before execution when the reservation ledger is unavailable", async () => {
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => ({ run: ++executions })),
  } as unknown as ToolSet;
  const { store } = createMemoryStore();
  store.reserve = async () => {
    throw new Error("ledger unavailable");
  };
  const wrapped = wrapToolsWithSlackIdempotency(
    tools,
    {
      scopeKey: "slack:T1:Ev123",
      userId: "user-1",
      mcpToolNames: new Set<string>(),
      restToolNames: new Set<string>(),
    },
    { store }
  );

  await assert.rejects(
    () => callTool(wrapped, "github_create_issue"),
    /ledger unavailable/
  );
  assert.equal(executions, 0);
});

test("does not retry a failed action within the same Slack event", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => {
      executions += 1;
      throw new Error("connection closed after request");
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
  await assert.rejects(
    () => callTool(firstAttempt, "github_create_issue"),
    /connection closed/
  );

  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });
  const replay = await callTool(retryAttempt, "github_create_issue");
  const repeatedReplay = await callTool(retryAttempt, "github_create_issue");

  assert.equal(executions, 1);
  assert.deepEqual(replay, {
    ok: false,
    deduplicated: true,
    error: UNCERTAIN_REPLAY_ERROR,
  });
  assert.deepEqual(repeatedReplay, replay);
});

test("blocks repeated identical calls after replaying a started execution", async () => {
  const { store } = createMemoryStore();
  store.complete = async () => {
    throw new Error("completion write timed out");
  };
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => ({
      issueNumber: ++executions,
    })),
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

  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store,
  });
  const firstReplay = await callTool(retryAttempt, "github_create_issue");
  const secondReplay = await callTool(retryAttempt, "github_create_issue");

  assert.equal(executions, 1);
  assert.deepEqual(firstReplay, {
    ok: false,
    deduplicated: true,
    error: UNCERTAIN_REPLAY_ERROR,
  });
  assert.deepEqual(secondReplay, firstReplay);
});

test("suppresses extra identical mutations emitted only during a retry", async () => {
  const { store, records } = createMemoryStore();
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => ({
      issueNumber: ++executions,
    })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const firstAttempt = wrapToolsWithSlackIdempotency(tools, context, { store });
  assert.deepEqual(await callTool(firstAttempt, "github_create_issue"), {
    issueNumber: 1,
  });

  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, { store });
  assert.deepEqual(await callTool(retryAttempt, "github_create_issue"), {
    issueNumber: 1,
  });
  assert.deepEqual(await callTool(retryAttempt, "github_create_issue"), {
    ok: false,
    deduplicated: true,
    error: UNCERTAIN_REPLAY_ERROR,
  });

  assert.equal(executions, 1);
  assert.deepEqual(
    Array.from(records.values()).map((record) => record.status),
    ["completed", "failed"]
  );
});

test("serializes parallel retry reservations before suppressing an extra mutation", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    github_create_issue: executableTool(() => ({
      issueNumber: ++executions,
    })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const firstAttempt = wrapToolsWithSlackIdempotency(tools, context, { store });
  assert.deepEqual(await callTool(firstAttempt, "github_create_issue"), {
    issueNumber: 1,
  });

  let releaseFirstReservation: () => void = () => {};
  const firstReservationGate = new Promise<void>((resolve) => {
    releaseFirstReservation = resolve;
  });
  const retryStore: SlackToolExecutionStore = {
    ...store,
    reserve: async (input) => {
      if (input.occurrence === 1) {
        await firstReservationGate;
      }
      return store.reserve(input);
    },
  };
  const retryAttempt = wrapToolsWithSlackIdempotency(tools, context, {
    store: retryStore,
  });

  const replayPromise = callTool(retryAttempt, "github_create_issue");
  const extraPromise = callTool(retryAttempt, "github_create_issue");
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseFirstReservation();

  const [replay, suppressed] = await Promise.all([replayPromise, extraPromise]);
  assert.deepEqual(replay, { issueNumber: 1 });
  assert.deepEqual(suppressed, {
    ok: false,
    deduplicated: true,
    error: UNCERTAIN_REPLAY_ERROR,
  });
  assert.equal(executions, 1);
});

test("normalizes protected outputs through their JSON replay shape", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    future_write: executableTool(() => {
      executions += 1;
      return {
        createdAt: new Date("2026-07-27T12:00:00.000Z"),
        omitted: undefined,
        invalidNumber: Number.NaN,
        authorization: "Bearer secret-token",
        nested: {
          client_secret: "pi_123_secret_456",
          sessionId: "session-123",
          tokenCount: 42,
        },
      };
    }),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const first = await callTool(
    wrapToolsWithSlackIdempotency(tools, context, { store }),
    "future_write"
  );
  const replay = await callTool(
    wrapToolsWithSlackIdempotency(tools, context, { store }),
    "future_write"
  );

  assert.equal(executions, 1);
  assert.deepEqual(first, {
    createdAt: "2026-07-27T12:00:00.000Z",
    invalidNumber: null,
    authorization: "Bearer secret-token",
    nested: {
      client_secret: "pi_123_secret_456",
      sessionId: "session-123",
      tokenCount: 42,
    },
  });
  assert.deepEqual(replay, first);
});

test("uses a locale-independent digest for canonical tool input", async () => {
  const { store, records } = createMemoryStore();
  const tools = {
    future_write: executableTool(() => ({ ok: true })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  await callTool(
    wrapToolsWithSlackIdempotency(tools, context, { store }),
    "future_write",
    { a: 1, B: 2, nested: { z: true, A: false } }
  );

  assert.equal(
    Array.from(records.values())[0]?.inputHash,
    "951684625fa2ff778904111dd071c2e1a5e296e8b5a00603599190913313c866"
  );
});

test("leaves oversized outputs uncertain instead of persisting them", async () => {
  const { store, records } = createMemoryStore();
  let executions = 0;
  const tools = {
    future_write: executableTool(() => ({
      run: ++executions,
      body: "x".repeat(MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES + 1),
    })),
  } as unknown as ToolSet;
  const context = {
    scopeKey: "slack:T1:Ev123",
    userId: "user-1",
    mcpToolNames: new Set<string>(),
    restToolNames: new Set<string>(),
  };

  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const first = (await callTool(
      wrapToolsWithSlackIdempotency(tools, context, { store }),
      "future_write"
    )) as { run: number };
    const replay = await callTool(
      wrapToolsWithSlackIdempotency(tools, context, { store }),
      "future_write"
    );

    assert.equal(first.run, 1);
    assert.equal(executions, 1);
    assert.equal(Array.from(records.values())[0]?.status, "started");
    assert.equal(
      logged[0]?.[0],
      "[slack-tool-idempotency] output cannot be durably replayed"
    );
    const logContext = logged[0]?.[1] as Record<string, unknown>;
    assert.equal(logContext.executionId, "execution-1");
    assert.equal(logContext.toolName, "future_write");
    assert.equal(logContext.reason, "output_too_large");
    assert.equal(logContext.limitBytes, MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES);
    assert.ok(
      Number(logContext.outputBytes) > MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES
    );
    assert.deepEqual(replay, {
      ok: false,
      deduplicated: true,
      error: UNCERTAIN_REPLAY_ERROR,
    });
  } finally {
    console.error = originalError;
  }
});

test("hashes undefined input for zero-argument tools", async () => {
  const { store } = createMemoryStore();
  let executions = 0;
  const tools = {
    future_write: executableTool(() => ({ run: ++executions })),
  } as unknown as ToolSet;
  const wrapped = wrapToolsWithSlackIdempotency(
    tools,
    {
      scopeKey: "slack:T1:Ev123",
      userId: "user-1",
      mcpToolNames: new Set<string>(),
      restToolNames: new Set<string>(),
    },
    { store }
  );
  const execute = wrapped.future_write?.execute;
  assert.equal(typeof execute, "function");

  assert.deepEqual(
    await execute!(undefined as never, {
      toolCallId: "zero-argument-call",
      messages: [],
    }),
    { run: 1 }
  );
});

type SupabaseCall = {
  method: string;
  args: unknown[];
};

function createSupabaseStoreHarness(
  results: Array<{
    data?: unknown;
    error: { code?: string; message: string } | null;
  }>
) {
  const calls: SupabaseCall[] = [];
  let resultIndex = 0;
  const client = {
    from(...args: unknown[]) {
      calls.push({ method: "from", args });
      const result = results[resultIndex++];
      assert.ok(result, "missing planned Supabase result");
      const query = {
        insert(...methodArgs: unknown[]) {
          calls.push({ method: "insert", args: methodArgs });
          return query;
        },
        select(...methodArgs: unknown[]) {
          calls.push({ method: "select", args: methodArgs });
          return query;
        },
        update(...methodArgs: unknown[]) {
          calls.push({ method: "update", args: methodArgs });
          return query;
        },
        eq(...methodArgs: unknown[]) {
          calls.push({ method: "eq", args: methodArgs });
          return query;
        },
        async single() {
          calls.push({ method: "single", args: [] });
          return result;
        },
        async maybeSingle() {
          calls.push({ method: "maybeSingle", args: [] });
          return result;
        },
        then(
          onfulfilled?: ((value: typeof result) => unknown) | null,
          _onrejected?: ((reason: unknown) => unknown) | null
        ) {
          return Promise.resolve(onfulfilled ? onfulfilled(result) : result);
        },
      };
      return query;
    },
  };
  const store = createSupabaseSlackToolExecutionStore(
    async () => client as never
  );
  return { store, calls };
}

const storedExecutionRow = {
  id: "execution-existing",
  scope_key: "slack:T1:Ev123",
  user_id: "user-1",
  tool_name: "github_create_issue",
  input_hash: "a".repeat(64),
  occurrence: 1,
  status: "completed" as const,
  output: { issueNumber: 123 },
  error: null,
};

test("Supabase store loads the existing reservation after a unique conflict", async () => {
  const { store, calls } = createSupabaseStoreHarness([
    {
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    },
    { data: storedExecutionRow, error: null },
  ]);

  const reservation = await store.reserve({
    scopeKey: storedExecutionRow.scope_key,
    userId: storedExecutionRow.user_id,
    toolName: storedExecutionRow.tool_name,
    inputHash: storedExecutionRow.input_hash,
    occurrence: storedExecutionRow.occurrence,
  });

  assert.equal(reservation.acquired, false);
  assert.deepEqual(reservation.record.output, { issueNumber: 123 });
  assert.deepEqual(
    calls.filter((call) => call.method === "eq").map((call) => call.args),
    [
      ["scope_key", "slack:T1:Ev123"],
      ["user_id", "user-1"],
      ["tool_name", "github_create_issue"],
      ["input_hash", "a".repeat(64)],
      ["occurrence", 1],
    ]
  );
});

test("Supabase store completion and failure updates only started executions", async () => {
  const { store, calls } = createSupabaseStoreHarness([
    { data: { id: "execution-1" }, error: null },
    { data: { id: "execution-2" }, error: null },
  ]);
  const longError = `Bearer secret-token ${"x".repeat(
    MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS + 100
  )}`;

  await store.complete({
    executionId: "execution-1",
    output: { issueNumber: 123 },
  });
  await store.fail({
    executionId: "execution-2",
    error: longError,
  });

  assert.deepEqual(
    calls.filter((call) => call.method === "eq").map((call) => call.args),
    [
      ["id", "execution-1"],
      ["status", "started"],
      ["id", "execution-2"],
      ["status", "started"],
    ]
  );
  const updates = calls
    .filter((call) => call.method === "update")
    .map((call) => call.args[0] as Record<string, unknown>);
  assert.equal(updates[0]?.status, "completed");
  assert.deepEqual(updates[0]?.output, { issueNumber: 123 });
  assert.equal(updates[1]?.status, "failed");
  const storedError = String(updates[1]?.error);
  assert.equal(storedError.includes("secret-token"), false);
  assert.equal(storedError.startsWith("Bearer [redacted]"), true);
  assert.equal(storedError.length, MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS);
  assert.equal(calls.filter((call) => call.method === "maybeSingle").length, 2);
});

test("Supabase store surfaces guarded transition no-ops", async () => {
  const { store } = createSupabaseStoreHarness([
    { data: null, error: null },
    { data: null, error: null },
  ]);

  await assert.rejects(
    () =>
      store.complete({
        executionId: "execution-already-final",
        output: { issueNumber: 123 },
      }),
    /no started execution found/
  );
  await assert.rejects(
    () =>
      store.fail({
        executionId: "execution-already-final",
        error: "connection closed",
      }),
    /no started execution found/
  );
});
