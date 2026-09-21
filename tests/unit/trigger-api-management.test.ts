import assert from "node:assert/strict";
import test from "node:test";
import {
  TRIGGER_AUTH_ROUTES,
  TRIGGER_TEST_ENV_KEY,
  TRIGGER_TEST_PAT,
  executeTriggerTool,
  fakeTriggerApi,
} from "../support/trigger-api-fake";
import { createTriggerApiTools } from "../../lib/connections/trigger-api/tools";

const TARGET = { projectRef: "proj_abc", environment: "prod" } as const;
const ENV_KEY_LOOKUP = "GET /api/v1/projects/proj_abc/prod";

/** The calls that reached a management route, without the token exchange. */
function managementCalls(calls: ReturnType<typeof fakeTriggerApi>["calls"]) {
  return calls.filter((call) => !call.path.startsWith("/api/v1/projects/"));
}

test("should reach a key-only route with the environment key and keep that key out of the result", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/runs/run_1/replay": { body: { id: "run_2" } },
  });

  const result = await executeTriggerTool(fetchImpl, "replay_run", {
    ...TARGET,
    runId: "run_1",
  });

  const [lookup, replay] = calls;
  assert.equal(`${lookup.method} ${lookup.path}`, ENV_KEY_LOOKUP);
  assert.equal(lookup.authorization, `Bearer ${TRIGGER_TEST_PAT}`);
  assert.equal(replay.authorization, `Bearer ${TRIGGER_TEST_ENV_KEY}`);
  assert.deepEqual(result, { runId: "run_2", replayedFrom: "run_1" });
  assert.equal(JSON.stringify(result).includes(TRIGGER_TEST_ENV_KEY), false);
});

test("should fetch the environment key once for several calls in a turn", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "GET /api/v1/schedules": { body: { data: [], pagination: {} } },
    "GET /api/v1/queues": { body: { data: [], pagination: {} } },
  });
  const tools = createTriggerApiTools(
    TRIGGER_TEST_PAT,
    fetchImpl
  ) as unknown as Record<
    string,
    {
      inputSchema: { parse: (value: unknown) => unknown };
      execute: (input: unknown, options: unknown) => Promise<unknown>;
    }
  >;

  for (const name of ["list_schedules", "list_queues", "list_schedules"]) {
    await tools[name].execute(tools[name].inputSchema.parse(TARGET), {});
  }

  const lookups = calls.filter(
    (call) => `${call.method} ${call.path}` === ENV_KEY_LOOKUP
  );
  assert.equal(lookups.length, 1);
  assert.equal(managementCalls(calls).length, 3);
});

test("should look the environment key up again after a failed lookup", async () => {
  let failLookup = true;
  const inner = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "GET /api/v1/timezones": { body: { timezones: ["UTC"] } },
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    if (failLookup && String(input).endsWith("/projects/proj_abc/prod")) {
      failLookup = false;
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return inner.fetchImpl(input, init);
  };
  const tools = createTriggerApiTools(
    TRIGGER_TEST_PAT,
    fetchImpl
  ) as unknown as Record<
    string,
    {
      inputSchema: { parse: (value: unknown) => unknown };
      execute: (input: unknown, options: unknown) => Promise<unknown>;
    }
  >;
  const run = () =>
    tools.list_timezones.execute(
      tools.list_timezones.inputSchema.parse(TARGET),
      {}
    );

  const first = await run();
  const second = await run();

  assert.deepEqual(first, {
    error: "Trigger.dev API returned HTTP 401: Unauthorized",
    status: 401,
  });
  assert.deepEqual(second, { timezones: ["UTC"] });
});

test("should never return environment variable values", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    "GET /api/v1/projects/proj_abc/envvars/prod": {
      body: [
        { name: "STRIPE_KEY", value: "sk_live_secret", isSecret: true },
        { name: "REGION", value: "us-east-1", isSecret: false },
      ],
    },
  });

  const result = await executeTriggerTool(fetchImpl, "list_env_vars", TARGET);

  assert.equal(calls[0].authorization, `Bearer ${TRIGGER_TEST_PAT}`);
  assert.deepEqual(result, {
    variables: [
      { name: "STRIPE_KEY", isSecret: true },
      { name: "REGION", isSecret: false },
    ],
  });
});

test("should write an environment variable with the saved token against the named environment", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    "PUT /api/v1/projects/proj_abc/envvars/staging/API%20URL": {
      body: { success: true },
    },
  });

  await executeTriggerTool(fetchImpl, "update_env_var", {
    projectRef: "proj_abc",
    environment: "staging",
    name: "API URL",
    value: "https://example.com",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(calls[0].body, { value: "https://example.com" });
});

test("should create a schedule with its deduplication key", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/schedules": { body: { id: "sched_1", active: true } },
  });

  const result = await executeTriggerTool(fetchImpl, "create_schedule", {
    ...TARGET,
    task: "nightly-sync",
    cron: "0 3 * * *",
    timezone: "America/New_York",
    deduplicationKey: "nightly-sync-prod",
  });

  assert.deepEqual(managementCalls(calls)[0].body, {
    task: "nightly-sync",
    cron: "0 3 * * *",
    timezone: "America/New_York",
    deduplicationKey: "nightly-sync-prod",
  });
  assert.deepEqual(result, { schedule: { id: "sched_1", active: true } });
});

test("should delete a schedule with DELETE and tolerate an empty response body", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "DELETE /api/v1/schedules/sched_1": { body: "" },
  });

  const result = await executeTriggerTool(fetchImpl, "delete_schedule", {
    ...TARGET,
    scheduleId: "sched_1",
  });

  assert.equal(managementCalls(calls)[0].method, "DELETE");
  assert.deepEqual(result, { result: {} });
});

test("should refuse a schedule write when no environment is named", () => {
  const tools = createTriggerApiTools(TRIGGER_TEST_PAT) as unknown as Record<
    string,
    { inputSchema: { safeParse: (value: unknown) => { success: boolean } } }
  >;

  for (const name of ["delete_schedule", "pause_queue", "promote_deployment"]) {
    const parsed = tools[name].inputSchema.safeParse({
      projectRef: "proj_abc",
      scheduleId: "sched_1",
      queue: "queue_1",
      version: "20260921.1",
    });
    assert.equal(
      parsed.success,
      false,
      `${name} accepted a missing environment`
    );
  }
});

test("should pause and resume a queue named by task through the same route", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/queues/sync%252Fusers/pause": { body: { paused: true } },
  });

  await executeTriggerTool(fetchImpl, "pause_queue", {
    ...TARGET,
    queue: "sync/users",
    queueType: "task",
  });
  await executeTriggerTool(fetchImpl, "resume_queue", {
    ...TARGET,
    queue: "sync/users",
    queueType: "task",
  });

  // Slashes are encoded before the segment is, as the Trigger.dev SDK does.
  assert.deepEqual(
    managementCalls(calls).map((call) => [call.path, call.body]),
    [
      [
        "/api/v1/queues/sync%252Fusers/pause",
        { type: "task", action: "pause" },
      ],
      [
        "/api/v1/queues/sync%252Fusers/pause",
        { type: "task", action: "resume" },
      ],
    ]
  );
});

test("should require exactly one of run ids or a filter for a bulk action", async () => {
  const { calls, fetchImpl } = fakeTriggerApi(TRIGGER_AUTH_ROUTES);

  const neither = await executeTriggerTool(fetchImpl, "create_bulk_action", {
    ...TARGET,
    action: "cancel",
  });
  const both = await executeTriggerTool(fetchImpl, "create_bulk_action", {
    ...TARGET,
    action: "cancel",
    runIds: ["run_1"],
    filter: '{"status":["QUEUED"]}',
  });

  assert.deepEqual(neither, { error: "Give exactly one of runIds or filter" });
  assert.deepEqual(both, { error: "Give exactly one of runIds or filter" });
  assert.deepEqual(calls, []);
});

test("should send a bulk replay selected by a parsed filter", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/bulk-actions": { body: { id: "bulk_1" } },
  });

  await executeTriggerTool(fetchImpl, "create_bulk_action", {
    ...TARGET,
    action: "replay",
    filter: '{"status":["FAILED"],"period":"1d"}',
  });

  assert.deepEqual(managementCalls(calls)[0].body, {
    action: "replay",
    filter: { status: ["FAILED"], period: "1d" },
  });
});

test("should reject batch items that are not a non-empty JSON array", async () => {
  const { fetchImpl } = fakeTriggerApi(TRIGGER_AUTH_ROUTES);

  const result = await executeTriggerTool(fetchImpl, "batch_trigger_tasks", {
    ...TARGET,
    items: "[]",
  });

  assert.deepEqual(result, { error: "items must be a non-empty JSON array" });
});

test("should run a query as JSON in the environment scope by default", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/query": { body: { format: "json", results: [{ n: 3 }] } },
  });

  const result = await executeTriggerTool(fetchImpl, "query", {
    projectRef: "proj_abc",
    query: "SELECT count() AS n FROM runs",
    period: "1d",
  });

  assert.deepEqual(managementCalls(calls)[0].body, {
    query: "SELECT count() AS n FROM runs",
    scope: "environment",
    period: "1d",
    format: "json",
  });
  assert.deepEqual(result, {
    result: { format: "json", results: [{ n: 3 }] },
  });
});

test("should post each error status change to its own route", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/errors/err_1/resolve": { body: { status: "resolved" } },
    "POST /api/v1/errors/err_1/ignore": { body: { status: "ignored" } },
    "POST /api/v1/errors/err_1/unresolve": { body: { status: "unresolved" } },
  });

  for (const name of ["resolve_error", "ignore_error", "unresolve_error"]) {
    await executeTriggerTool(fetchImpl, name, { ...TARGET, errorId: "err_1" });
  }

  assert.deepEqual(
    managementCalls(calls).map((call) => call.path),
    [
      "/api/v1/errors/err_1/resolve",
      "/api/v1/errors/err_1/ignore",
      "/api/v1/errors/err_1/unresolve",
    ]
  );
});

test("should complete a waitpoint token with the parsed data", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/waitpoints/tokens/waitpoint_1/complete": {
      body: { success: true },
    },
  });

  await executeTriggerTool(fetchImpl, "complete_waitpoint_token", {
    ...TARGET,
    tokenId: "waitpoint_1",
    data: '{"approved":true}',
  });

  assert.deepEqual(managementCalls(calls)[0].body, {
    data: { approved: true },
  });
});

test("should filter sessions and page with the cursor", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "GET /api/v1/sessions": {
      body: { data: [{ id: "session_1" }], pagination: { next: "c2" } },
    },
  });

  const result = await executeTriggerTool(fetchImpl, "list_sessions", {
    projectRef: "proj_abc",
    taskIdentifier: ["chat"],
    cursor: "c1",
    limit: 5,
  });

  const query = new URL(managementCalls(calls)[0].url).searchParams;
  assert.equal(query.get("filter[taskIdentifier]"), "chat");
  assert.equal(query.get("page[after]"), "c1");
  assert.equal(query.get("page[size]"), "5");
  assert.deepEqual(result, {
    sessions: [{ id: "session_1" }],
    nextCursor: "c2",
  });
});

test("should promote a deployment version in the named environment", async () => {
  const { calls, fetchImpl } = fakeTriggerApi({
    ...TRIGGER_AUTH_ROUTES,
    "POST /api/v1/deployments/20260921.1/promote": { body: { id: "dep_1" } },
  });

  const result = await executeTriggerTool(fetchImpl, "promote_deployment", {
    ...TARGET,
    version: "20260921.1",
  });

  assert.equal(managementCalls(calls).length, 1);
  assert.deepEqual(result, { result: { id: "dep_1" } });
});
