import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteExpiredSlackToolExecutions,
  SLACK_TOOL_EXECUTION_RETENTION_MS,
} from "../../lib/agents/slack-tool-retention";

test("deletes Slack tool executions older than the retry retention window", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const selectedBatches = [
    { data: [{ id: "execution-1" }, { id: "execution-2" }], error: null },
    { data: [{ id: "execution-3" }], error: null },
  ];
  const deletedBatches = [
    { count: 2, error: null },
    { count: 1, error: null },
  ];
  const selectQuery = {
    lt(...args: unknown[]) {
      calls.push({ method: "lt", args });
      return selectQuery;
    },
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return selectQuery;
    },
    limit(...args: unknown[]) {
      calls.push({ method: "limit", args });
      return Promise.resolve(selectedBatches.shift());
    },
  };
  const deleteQuery = {
    in(...args: unknown[]) {
      calls.push({ method: "in", args });
      return Promise.resolve(deletedBatches.shift());
    },
  };
  const tableQuery = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return selectQuery;
    },
    delete(...args: unknown[]) {
      calls.push({ method: "delete", args });
      return deleteQuery;
    },
  };
  const client = {
    from(...args: unknown[]) {
      calls.push({ method: "from", args });
      return tableQuery;
    },
  };
  const now = new Date("2026-07-27T12:00:00.000Z");

  const summary = await deleteExpiredSlackToolExecutions({
    client: client as never,
    now,
    batchSize: 2,
  });

  assert.deepEqual(summary, {
    cutoff: new Date(
      now.getTime() - SLACK_TOOL_EXECUTION_RETENTION_MS
    ).toISOString(),
    deleted: 3,
    batches: 2,
    hasMore: false,
  });
  assert.deepEqual(calls, [
    { method: "from", args: ["slack_tool_executions"] },
    { method: "select", args: ["id"] },
    {
      method: "lt",
      args: ["started_at", "2026-07-26T12:00:00.000Z"],
    },
    {
      method: "order",
      args: ["started_at", { ascending: true }],
    },
    { method: "limit", args: [2] },
    { method: "from", args: ["slack_tool_executions"] },
    { method: "delete", args: [{ count: "exact" }] },
    { method: "in", args: ["id", ["execution-1", "execution-2"]] },
    { method: "from", args: ["slack_tool_executions"] },
    { method: "select", args: ["id"] },
    {
      method: "lt",
      args: ["started_at", "2026-07-26T12:00:00.000Z"],
    },
    {
      method: "order",
      args: ["started_at", { ascending: true }],
    },
    { method: "limit", args: [2] },
    { method: "from", args: ["slack_tool_executions"] },
    { method: "delete", args: [{ count: "exact" }] },
    { method: "in", args: ["id", ["execution-3"]] },
  ]);
});

test("surfaces Slack tool retention deletion failures", async () => {
  const selectQuery = {
    lt() {
      return selectQuery;
    },
    order() {
      return selectQuery;
    },
    async limit() {
      return { data: [{ id: "execution-1" }], error: null };
    },
  };
  const deleteQuery = {
    async in() {
      return {
        count: null,
        error: { message: "database unavailable" },
      };
    },
  };
  const query = {
    select() {
      return selectQuery;
    },
    delete() {
      return deleteQuery;
    },
  };

  await assert.rejects(
    () =>
      deleteExpiredSlackToolExecutions({
        client: { from: () => query } as never,
        now: new Date("2026-07-27T12:00:00.000Z"),
      }),
    /Failed to delete expired Slack tool executions: database unavailable/
  );
});

test("bounds each retention attempt and reports remaining backlog", async () => {
  const selectQuery = {
    lt() {
      return selectQuery;
    },
    order() {
      return selectQuery;
    },
    async limit() {
      return { data: [{ id: "execution-1" }], error: null };
    },
  };
  const deleteQuery = {
    async in() {
      return { count: 1, error: null };
    },
  };
  const tableQuery = {
    select() {
      return selectQuery;
    },
    delete() {
      return deleteQuery;
    },
  };

  const summary = await deleteExpiredSlackToolExecutions({
    client: { from: () => tableQuery } as never,
    now: new Date("2026-07-27T12:00:00.000Z"),
    batchSize: 1,
    maxBatches: 1,
  });

  assert.deepEqual(summary, {
    cutoff: "2026-07-26T12:00:00.000Z",
    deleted: 1,
    batches: 1,
    hasMore: true,
  });
});

test("scheduled retention records cleanup metadata and logs", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { runScheduledSlackToolExecutionRetention } =
    await import("../../trigger/slack-tool-execution-retention");
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: Array<{ message: string; data: unknown }> = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };

  const summary = await runScheduledSlackToolExecutionRetention({
    deleteExpiredSlackToolExecutions: async () => ({
      cutoff: "2026-07-26T12:00:00.000Z",
      deleted: 3,
      batches: 1,
      hasMore: false,
    }),
    metadata: metadataStub as never,
    logger: {
      log(message, data) {
        logs.push({ message, data });
      },
      warn() {},
    },
  });

  assert.deepEqual(summary, {
    cutoff: "2026-07-26T12:00:00.000Z",
    deleted: 3,
    batches: 1,
    hasMore: false,
  });
  assert.deepEqual(metadataEntries, [
    ["deleted", 3],
    ["cutoff", "2026-07-26T12:00:00.000Z"],
    ["batches", 1],
    ["has_more", false],
  ]);
  assert.deepEqual(logs, [
    {
      message: "Deleted 3 expired Slack tool execution records",
      data: summary,
    },
  ]);
});

test("scheduled retention reports bounded backlog without failing the run", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { runScheduledSlackToolExecutionRetention } =
    await import("../../trigger/slack-tool-execution-retention");
  const warnings: Array<{ message: string; data: unknown }> = [];
  const backlogSummary = {
    cutoff: "2026-07-26T12:00:00.000Z",
    deleted: 50_000,
    batches: 100,
    hasMore: true,
  };

  const summary = await runScheduledSlackToolExecutionRetention({
    deleteExpiredSlackToolExecutions: async () => backlogSummary,
    metadata: { set: () => undefined } as never,
    logger: {
      log: () => undefined,
      warn(message, data) {
        warnings.push({ message, data });
      },
    },
  });

  assert.deepEqual(summary, backlogSummary);
  assert.deepEqual(warnings, [
    {
      message:
        "Slack tool execution retention reached its batch limit; the next hourly run will continue cleanup",
      data: backlogSummary,
    },
  ]);
});
