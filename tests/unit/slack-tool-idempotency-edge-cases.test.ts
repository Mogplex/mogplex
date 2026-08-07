import assert from "node:assert/strict";
import test from "node:test";
import type { ToolSet } from "ai";
import {
  MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES,
  wrapToolsWithSlackIdempotency,
  type SlackToolExecutionStore,
} from "../../lib/agents/slack-tool-idempotency";
import {
  UNCERTAIN_REPLAY_ERROR,
  createMemoryStore,
  executableTool,
  callTool,
} from "./helpers/slack-tool-idempotency-fixtures";

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
