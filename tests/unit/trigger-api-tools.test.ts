import assert from "node:assert/strict";
import test from "node:test";
import { createTriggerApiTools } from "../../lib/connections/trigger-api/tools";

type RecordedCall = {
  method: string;
  url: string;
  authorization: string | null;
  branch: string | null;
  body: unknown;
};

type Route = { status?: number; body: unknown; contentType?: string };

const PAT = "tr_pat_test";
const JWT = "jwt_scoped";
const TARGET = { projectRef: "proj_abc", environment: "prod" } as const;

/** Fake Trigger.dev API: answers by `METHOD path`, records what was sent. */
function fakeApi(routes: Record<string, Route>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: url.toString(),
      authorization: headers.get("Authorization"),
      branch: headers.get("x-trigger-branch"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return Response.json({ error: "no route" }, { status: 404 });
    const payload =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(payload, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
    });
  };
  return { calls, fetchImpl };
}

const JWT_ROUTE = {
  "POST /api/v1/projects/proj_abc/prod/jwt": { body: { token: JWT } },
};

async function execute(
  fetchImpl: typeof fetch,
  name: string,
  input: Record<string, unknown>
) {
  const tools = createTriggerApiTools(PAT, fetchImpl);
  const selected = tools[name] as unknown as {
    inputSchema: { parse: (value: unknown) => unknown };
    execute: (input: unknown, options: unknown) => Promise<unknown>;
  };
  return (await selected.execute(
    selected.inputSchema.parse(input),
    {}
  )) as Record<string, unknown>;
}

test("should expose the eight Trigger.dev API tools", () => {
  assert.deepEqual(Object.keys(createTriggerApiTools(PAT)), [
    "list_projects",
    "get_current_worker",
    "trigger_task",
    "list_runs",
    "get_run_details",
    "cancel_run",
    "list_deploys",
    "search_docs",
  ]);
});

test("should list projects with the saved token and name the ref projectRef", async () => {
  const { calls, fetchImpl } = fakeApi({
    "GET /api/v1/projects": {
      body: [
        {
          id: "internal",
          externalRef: "proj_abc",
          name: "Mogplex",
          slug: "mogplex",
          organization: { id: "org", title: "Acme", slug: "acme" },
        },
      ],
    },
  });

  const result = await execute(fetchImpl, "list_projects", {});

  assert.equal(calls[0].authorization, `Bearer ${PAT}`);
  assert.deepEqual(result, {
    projects: [
      {
        projectRef: "proj_abc",
        name: "Mogplex",
        slug: "mogplex",
        organization: { title: "Acme", slug: "acme" },
      },
    ],
  });
});

test("should list runs with a read-only scoped token, never the saved one", async () => {
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "GET /api/v1/runs": {
      body: {
        data: [
          {
            id: "run_1",
            status: "FAILED",
            taskIdentifier: "sync",
            env: { id: "env" },
            metadata: { big: "blob" },
          },
        ],
        pagination: { next: "cursor_2" },
      },
    },
  });

  const result = await execute(fetchImpl, "list_runs", {
    projectRef: "proj_abc",
    status: ["FAILED"],
    taskIdentifier: ["sync"],
    period: "1d",
    limit: 5,
  });

  const [mint, list] = calls;
  assert.equal(mint.authorization, `Bearer ${PAT}`);
  assert.deepEqual(mint.body, { claims: { scopes: ["read:runs"] } });
  assert.equal(list.authorization, `Bearer ${JWT}`);
  const query = new URL(list.url).searchParams;
  assert.equal(query.get("filter[status]"), "FAILED");
  assert.equal(query.get("filter[taskIdentifier]"), "sync");
  assert.equal(query.get("filter[createdAt][period]"), "1d");
  assert.equal(query.get("page[size]"), "5");
  assert.deepEqual(result, {
    runs: [{ id: "run_1", status: "FAILED", taskIdentifier: "sync" }],
    nextCursor: "cursor_2",
  });
});

test("should default reads to the prod environment", async () => {
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "GET /api/v1/runs": { body: { data: [] } },
  });

  await execute(fetchImpl, "list_runs", { projectRef: "proj_abc" });

  assert.match(calls[0].url, /\/projects\/proj_abc\/prod\/jwt$/);
});

test("should refuse to trigger a task when no environment is named", () => {
  const tools = createTriggerApiTools(PAT) as unknown as Record<
    string,
    { inputSchema: { safeParse: (value: unknown) => { success: boolean } } }
  >;

  const parsed = tools.trigger_task.inputSchema.safeParse({
    projectRef: "proj_abc",
    taskId: "sync",
  });

  assert.equal(parsed.success, false);
});

test("should trigger a task with a write:tasks token and the parsed payload", async () => {
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "POST /api/v1/tasks/sync%2Fusers/trigger": { body: { id: "run_new" } },
  });

  const result = await execute(fetchImpl, "trigger_task", {
    ...TARGET,
    taskId: "sync/users",
    payload: '{"userId":42}',
    tags: ["from-agent"],
  });

  const [mint, trigger] = calls;
  assert.deepEqual(mint.body, { claims: { scopes: ["write:tasks"] } });
  assert.equal(trigger.authorization, `Bearer ${JWT}`);
  assert.deepEqual(trigger.body, {
    payload: { userId: 42 },
    options: { tags: ["from-agent"] },
  });
  assert.deepEqual(result, { runId: "run_new", taskId: "sync/users" });
});

test("should reject a payload that is not JSON without calling the API", async () => {
  const { calls, fetchImpl } = fakeApi({});

  const result = await execute(fetchImpl, "trigger_task", {
    ...TARGET,
    taskId: "sync",
    payload: "{nope",
  });

  assert.deepEqual(result, { error: "payload must be a valid JSON string" });
  assert.deepEqual(calls, []);
});

test("should cancel a run with a token scoped to that run only", async () => {
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "POST /api/v2/runs/run_9/cancel": { body: { id: "run_9" } },
    "GET /api/v3/runs/run_9": {
      body: { id: "run_9", status: "CANCELED", payload: { secret: "x" } },
    },
  });

  const result = await execute(fetchImpl, "cancel_run", {
    ...TARGET,
    runId: "run_9",
  });

  assert.deepEqual(calls[0].body, {
    claims: { scopes: ["write:runs:run_9", "read:runs:run_9"] },
  });
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(result, { run: { id: "run_9", status: "CANCELED" } });
});

test("should return run details with a flattened, capped trace", async () => {
  const span = (
    message: string,
    children: unknown[] = [],
    isError = false
  ) => ({
    id: message,
    data: { message, duration: 2_000_000, level: "TRACE", isError, events: [] },
    children,
  });
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "GET /api/v3/runs/run_1": { body: { id: "run_1", status: "FAILED" } },
    "GET /api/v1/runs/run_1/trace": {
      body: {
        trace: {
          rootSpan: span("root", [
            span("child-a", [span("grandchild", [], true)]),
            span("child-b"),
          ]),
        },
      },
    },
  });

  const result = await execute(fetchImpl, "get_run_details", {
    projectRef: "proj_abc",
    runId: "run_1",
    maxTraceLines: 3,
  });

  assert.deepEqual(calls[0].body, { claims: { scopes: ["read:runs:run_1"] } });
  assert.deepEqual(result.run, { id: "run_1", status: "FAILED" });
  assert.deepEqual(result.trace, {
    lines: [
      { depth: 0, message: "root", level: "TRACE", durationMs: 2 },
      { depth: 1, message: "child-a", level: "TRACE", durationMs: 2 },
      {
        depth: 2,
        message: "grandchild",
        level: "TRACE",
        durationMs: 2,
        isError: true,
      },
    ],
    truncated: true,
  });
});

test("should mark an oversized run payload as truncated instead of returning it whole", async () => {
  const { fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "GET /api/v3/runs/run_1": {
      body: { id: "run_1", output: "x".repeat(20_000) },
    },
    "GET /api/v1/runs/run_1/trace": { body: { trace: {} } },
  });

  const result = await execute(fetchImpl, "get_run_details", {
    projectRef: "proj_abc",
    runId: "run_1",
  });

  const run = result.run as { truncated?: boolean; preview?: string };
  assert.equal(run.truncated, true);
  assert.equal(run.preview?.length, 6000);
});

test("should send the preview branch header when a branch is named", async () => {
  const { calls, fetchImpl } = fakeApi({
    "GET /api/v1/projects/proj_abc/preview/workers/current": {
      body: {
        worker: {
          version: "20260921.1",
          tasks: [
            {
              id: "internal",
              slug: "sync",
              filePath: "trigger/sync.ts",
              triggerSource: "STANDARD",
              payloadSchema: { type: "object" },
              queueConfig: { concurrencyLimit: 1 },
            },
          ],
        },
      },
    },
  });

  const result = await execute(fetchImpl, "get_current_worker", {
    projectRef: "proj_abc",
    environment: "preview",
    branch: "feat/x",
  });

  assert.equal(calls[0].branch, "feat/x");
  assert.deepEqual(result, {
    worker: { version: "20260921.1" },
    tasks: [
      {
        slug: "sync",
        filePath: "trigger/sync.ts",
        triggerSource: "STANDARD",
        payloadSchema: { type: "object" },
      },
    ],
  });
});

test("should list deployments with a read:deployments token and one-line commit messages", async () => {
  const { calls, fetchImpl } = fakeApi({
    ...JWT_ROUTE,
    "GET /api/v1/deployments": {
      body: {
        data: [
          {
            id: "deployment_1",
            version: "20260921.1",
            status: "DEPLOYED",
            git: { commitSha: "abc", commitMessage: "fix: thing\n\nlong body" },
            externalId: "drop-me",
          },
        ],
      },
    },
  });

  const result = await execute(fetchImpl, "list_deploys", {
    projectRef: "proj_abc",
    status: "DEPLOYED",
  });

  assert.deepEqual(calls[0].body, { claims: { scopes: ["read:deployments"] } });
  assert.equal(new URL(calls[1].url).searchParams.get("status"), "DEPLOYED");
  assert.deepEqual(result, {
    deployments: [
      {
        id: "deployment_1",
        version: "20260921.1",
        status: "DEPLOYED",
        git: { commitSha: "abc", commitMessage: "fix: thing" },
      },
    ],
    nextCursor: null,
  });
});

test("should search the docs without sending the saved token", async () => {
  const { calls, fetchImpl } = fakeApi({
    "POST /docs/mcp": {
      contentType: "text/event-stream",
      body: `event: message\ndata: ${JSON.stringify({
        result: { content: [{ type: "text", text: "Title: Idempotency" }] },
      })}\n\n`,
    },
  });

  const result = await execute(fetchImpl, "search_docs", {
    query: "idempotency",
  });

  assert.equal(calls[0].url, "https://trigger.dev/docs/mcp");
  assert.equal(calls[0].authorization, null);
  assert.deepEqual(result, { results: "Title: Idempotency" });
});

test("should hand the model the API's error instead of throwing when the token is rejected", async () => {
  const { fetchImpl } = fakeApi({
    "GET /api/v1/projects": { status: 401, body: { error: "Invalid PAT" } },
  });

  const result = await execute(fetchImpl, "list_projects", {});

  assert.deepEqual(result, {
    error: "Trigger.dev API returned HTTP 401: Invalid PAT",
    status: 401,
  });
});
