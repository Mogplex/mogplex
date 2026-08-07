import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabaseSlackToolExecutionStore,
  MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS,
} from "../../lib/agents/slack-tool-idempotency";
import {
  createSupabaseStoreHarness,
  storedExecutionRow,
} from "./helpers/slack-tool-idempotency-fixtures";

test("Supabase store loads the existing reservation after a unique conflict", async () => {
  const { store, calls } = createSupabaseStoreHarness(
    createSupabaseSlackToolExecutionStore,
    [
      {
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      },
      { data: storedExecutionRow, error: null },
    ]
  );

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
  const { store, calls } = createSupabaseStoreHarness(
    createSupabaseSlackToolExecutionStore,
    [
      { data: { id: "execution-1" }, error: null },
      { data: { id: "execution-2" }, error: null },
    ]
  );
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
  const { store } = createSupabaseStoreHarness(
    createSupabaseSlackToolExecutionStore,
    [
      { data: null, error: null },
      { data: null, error: null },
    ]
  );

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
