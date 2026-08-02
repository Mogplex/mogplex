import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { consumeSandboxLaunchResponse } from "../../lib/mogplex-api/sandbox-launch";

const VALID_AUTH = {
  ok: true as const,
  auth: {
    userId: "user-123",
    keyId: "key-1",
    scopes: ["read", "write"],
  },
};

const VALID_GRAPH = {
  nodes: [
    {
      id: "start",
      type: "start",
      position: { x: 80, y: 140 },
      data: { label: "Mention", event: "mention" },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const AUTOMATION_SUMMARY = {
  id: "11111111-1111-4111-8111-111111111111",
  installationId: 123,
  name: "Review PRs",
  description: "Review incoming pull requests",
  status: "active" as const,
  publishedVersionId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T01:00:00.000Z",
};

const AUTOMATION_CURSOR_MIGRATION_URL = new URL(
  "../../supabase/migrations/20260720170000_mogplex_automation_list_cursor.sql",
  import.meta.url
);

function configureEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

test("automation list API returns bounded summary pages with an opaque cursor", async () => {
  configureEnv();
  const { createMogplexApiAutomationsGetHandler } =
    await import("../../app/api/v1/mogplex/automations/route");
  const cursor = Buffer.from(
    JSON.stringify({
      createdAt: "2026-07-19T00:00:00.000Z",
      id: "33333333-3333-4333-8333-333333333333",
    }),
    "utf8"
  ).toString("base64url");
  const calls: unknown[] = [];
  const handler = createMogplexApiAutomationsGetHandler({
    resolveApiKey: async () => VALID_AUTH,
    listAutomations: async (userId, options) => {
      calls.push({ userId, options });
      return {
        automations: [AUTOMATION_SUMMARY],
        nextCursor: "next-page",
      };
    },
  });

  const response = await handler(
    new NextRequest(
      `https://mogplex.example/api/v1/mogplex/automations?limit=25&cursor=${encodeURIComponent(cursor)}`,
      { headers: { authorization: "Bearer mog_valid" } }
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      automations: [AUTOMATION_SUMMARY],
      nextCursor: "next-page",
    },
  });
  assert.deepEqual(calls, [
    {
      userId: "user-123",
      options: {
        limit: 25,
        cursor: {
          createdAt: "2026-07-19T00:00:00.000Z",
          id: "33333333-3333-4333-8333-333333333333",
        },
      },
    },
  ]);
  assert.equal("draftGraph" in AUTOMATION_SUMMARY, false);
  assert.equal("publishedVersion" in AUTOMATION_SUMMARY, false);
});

test("automation list API rejects malformed cursors before querying", async () => {
  configureEnv();
  const { createMogplexApiAutomationsGetHandler } =
    await import("../../app/api/v1/mogplex/automations/route");
  let listCalls = 0;
  const handler = createMogplexApiAutomationsGetHandler({
    resolveApiKey: async () => VALID_AUTH,
    listAutomations: async () => {
      listCalls += 1;
      return { automations: [], nextCursor: null };
    },
  });

  const response = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations?cursor=not-a-cursor",
      { headers: { authorization: "Bearer mog_valid" } }
    )
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "BAD_REQUEST", message: "Invalid cursor" },
  });
  assert.equal(listCalls, 0);
});

test("automation list API applies bounded default and maximum page sizes", async () => {
  configureEnv();
  const { createMogplexApiAutomationsGetHandler } =
    await import("../../app/api/v1/mogplex/automations/route");
  const limits: number[] = [];
  const handler = createMogplexApiAutomationsGetHandler({
    resolveApiKey: async () => VALID_AUTH,
    listAutomations: async (_userId, options) => {
      limits.push(options?.limit ?? 0);
      return { automations: [], nextCursor: null };
    },
  });

  const defaultResponse = await handler(
    new NextRequest("https://mogplex.example/api/v1/mogplex/automations", {
      headers: { authorization: "Bearer mog_valid" },
    })
  );
  const cappedResponse = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations?limit=500",
      { headers: { authorization: "Bearer mog_valid" } }
    )
  );

  assert.equal(defaultResponse.status, 200);
  assert.equal(cappedResponse.status, 200);
  assert.deepEqual(limits, [50, 100]);
});

test("automation list cursor migration supports the composite owner sort", async () => {
  const sql = await readFile(AUTOMATION_CURSOR_MIGRATION_URL, "utf8");

  assert.match(
    sql,
    /create index if not exists idx_flows_user_created_id\s+on public\.flows \(user_id, created_at desc, id desc\)/i
  );
});

test("automation trigger API enforces idempotency and forwards owned user input", async () => {
  configureEnv();
  const { createMogplexApiAutomationTriggerPostHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/trigger/route");
  const calls: unknown[] = [];
  const handler = createMogplexApiAutomationTriggerPostHandler({
    resolveApiKey: async () => VALID_AUTH,
    triggerAutomation: async (input) => {
      calls.push(input);
      return {
        automationId: input.automationId,
        jobRunId: "job-1",
        outcome: "queued",
        reason: null,
        started: true,
        status: "running",
        runtime: { provider: "trigger", runId: "runtime-1" },
      };
    },
  });

  const missingKey = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations/flow-1/trigger",
      {
        method: "POST",
        headers: { authorization: "Bearer mog_valid" },
        body: JSON.stringify({ repoId: "repo-1" }),
      }
    ),
    { params: Promise.resolve({ automationId: "flow-1" }) }
  );
  assert.equal(missingKey.status, 400);

  const response = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations/flow-1/trigger",
      {
        method: "POST",
        headers: {
          authorization: "Bearer mog_valid",
          "idempotency-key": "tool-call-1",
        },
        body: JSON.stringify({
          repoId: "repo-1",
          input: { pull_request: { number: 42 } },
        }),
      }
    ),
    { params: Promise.resolve({ automationId: "flow-1" }) }
  );

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [
    {
      userId: "user-123",
      automationId: "flow-1",
      repoId: "repo-1",
      idempotencyKey: "tool-call-1",
      input: { pull_request: { number: 42 } },
    },
  ]);
});

test("automation update API rejects malformed graph payloads before persistence", async () => {
  configureEnv();
  const { createMogplexApiAutomationPutHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/route");
  let updateCalls = 0;
  const handler = createMogplexApiAutomationPutHandler({
    resolveApiKey: async () => VALID_AUTH,
    updateAutomation: async () => {
      updateCalls += 1;
      return {} as never;
    },
  });

  const invalidGraphs: unknown[] = [
    null,
    "not-a-graph",
    {},
    { nodes: [], edges: "not-an-array" },
    { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0 } },
  ];

  for (const graph of invalidGraphs) {
    const response = await handler(
      new NextRequest(
        "https://mogplex.example/api/v1/mogplex/automations/flow-1",
        {
          method: "PUT",
          headers: { authorization: "Bearer mog_valid" },
          body: JSON.stringify({ graph }),
        }
      ),
      { params: Promise.resolve({ automationId: "flow-1" }) }
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "BAD_REQUEST");
  }

  assert.equal(updateCalls, 0);
});

test("automation update API rejects invalid installation ids before persistence", async () => {
  configureEnv();
  const { createMogplexApiAutomationPutHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/route");
  let updateCalls = 0;
  const handler = createMogplexApiAutomationPutHandler({
    resolveApiKey: async () => VALID_AUTH,
    updateAutomation: async () => {
      updateCalls += 1;
      return {} as never;
    },
  });

  const invalidInstallationIds: unknown[] = [
    -1,
    0,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "123",
    null,
  ];

  for (const installationId of invalidInstallationIds) {
    const response = await handler(
      new NextRequest(
        "https://mogplex.example/api/v1/mogplex/automations/flow-1",
        {
          method: "PUT",
          headers: { authorization: "Bearer mog_valid" },
          body: JSON.stringify({ installationId }),
        }
      ),
      { params: Promise.resolve({ automationId: "flow-1" }) }
    );
    assert.equal(response.status, 400);
    assert.deepEqual((await response.json()).error, {
      code: "BAD_REQUEST",
      message: "installationId must be a positive integer",
    });
  }

  assert.equal(updateCalls, 0);
});

test("automation create and update APIs accept the same valid graph shape", async () => {
  configureEnv();
  const [
    { createMogplexApiAutomationsPostHandler },
    { createMogplexApiAutomationPutHandler },
  ] = await Promise.all([
    import("../../app/api/v1/mogplex/automations/route"),
    import("../../app/api/v1/mogplex/automations/[automationId]/route"),
  ]);
  const graphs: unknown[] = [];
  const createHandler = createMogplexApiAutomationsPostHandler({
    resolveApiKey: async () => VALID_AUTH,
    createAutomation: async (_userId, input) => {
      graphs.push(input.graph);
      return {} as never;
    },
  });
  const updateHandler = createMogplexApiAutomationPutHandler({
    resolveApiKey: async () => VALID_AUTH,
    updateAutomation: async (_userId, _automationId, input) => {
      graphs.push(input.graph);
      return {} as never;
    },
  });

  const createResponse = await createHandler(
    new NextRequest("https://mogplex.example/api/v1/mogplex/automations", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({ installationId: 123, graph: VALID_GRAPH }),
    })
  );
  const updateResponse = await updateHandler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations/flow-1",
      {
        method: "PUT",
        headers: { authorization: "Bearer mog_valid" },
        body: JSON.stringify({ graph: VALID_GRAPH }),
      }
    ),
    { params: Promise.resolve({ automationId: "flow-1" }) }
  );

  assert.equal(createResponse.status, 201);
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(graphs, [VALID_GRAPH, VALID_GRAPH]);
});

test("automation create API rejects malformed graphs before creating a flow", async () => {
  configureEnv();
  const { createMogplexApiAutomationsPostHandler } =
    await import("../../app/api/v1/mogplex/automations/route");
  let createCalls = 0;
  const handler = createMogplexApiAutomationsPostHandler({
    resolveApiKey: async () => VALID_AUTH,
    createAutomation: async () => {
      createCalls += 1;
      return {} as never;
    },
  });

  const response = await handler(
    new NextRequest("https://mogplex.example/api/v1/mogplex/automations", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({ installationId: 123, graph: { nodes: [] } }),
    })
  );

  assert.equal(response.status, 400);
  assert.equal(createCalls, 0);
});

test("sandbox creation API delegates to the event-driven launcher", async () => {
  configureEnv();
  const { createMogplexApiSandboxesPostHandler } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  const handler = createMogplexApiSandboxesPostHandler({
    resolveApiKey: async () => VALID_AUTH,
    launchSandbox: async (userId, body) => {
      assert.equal(userId, "user-123");
      assert.equal(body.repoId, "repo-1");
      return {
        ok: true,
        sandbox: {
          id: "sandbox-record-1",
          sandbox_id: "sbx_1",
          repo_id: "repo-1",
          status: "running",
          base_branch: "main",
          working_branch: "agent/work",
          root_directory: null,
          preview_url: "https://preview.example",
          created_at: "2026-07-20T00:00:00.000Z",
          last_active_at: "2026-07-20T00:01:00.000Z",
          error: null,
        },
      };
    },
  });

  const response = await handler(
    new NextRequest("https://mogplex.example/api/v1/mogplex/sandboxes", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
      body: JSON.stringify({
        repoId: "repo-1",
        workingBranch: "agent/work",
      }),
    })
  );

  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.sandbox.status, "running");
});

test("sandbox launch response consumes SSE events without status polling", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "status",
            status: "installing",
            sandbox: {
              id: "sandbox-record-1",
              repo_id: "repo-1",
              base_branch: "main",
              working_branch: "main",
              root_directory: null,
              created_at: "2026-07-20T00:00:00.000Z",
              last_active_at: "2026-07-20T00:00:00.000Z",
              runtime_summary: {
                sandbox_id: "sbx_1",
                status: "installing",
                preview_url: null,
              },
              error_summary: { display_error: null },
            },
          })}\n\n`
        )
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "ready",
            sandbox: {
              id: "sandbox-record-1",
              repo_id: "repo-1",
              base_branch: "main",
              working_branch: "main",
              root_directory: null,
              created_at: "2026-07-20T00:00:00.000Z",
              last_active_at: "2026-07-20T00:01:00.000Z",
              runtime_summary: {
                sandbox_id: "sbx_1",
                status: "running",
                preview_url: "https://preview.example",
              },
              error_summary: { display_error: null },
            },
          })}\n\n`
        )
      );
      controller.close();
    },
  });

  const result = await consumeSandboxLaunchResponse(
    new Response(body, { headers: { "content-type": "text/event-stream" } })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sandbox.status, "running");
    assert.equal(result.sandbox.preview_url, "https://preview.example");
  }
});
