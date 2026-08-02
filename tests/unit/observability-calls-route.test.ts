import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

async function loadObservabilityCallsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/calls/route");
}

class FakeQuery {
  readonly eqCalls: unknown[][] = [];
  readonly filterCalls: unknown[][] = [];
  readonly isCalls: unknown[][] = [];
  readonly notCalls: unknown[][] = [];
  readonly orCalls: unknown[][] = [];

  constructor(
    private readonly result: {
      data: Record<string, unknown>[] | null;
      count?: number | null;
      error: { message: string } | null;
    }
  ) {}

  eq(...args: unknown[]) {
    this.eqCalls.push(args);
    return this;
  }
  order() {
    return this;
  }
  range() {
    return this;
  }
  in() {
    return this;
  }
  is(...args: unknown[]) {
    this.isCalls.push(args);
    return this;
  }
  not(...args: unknown[]) {
    this.notCalls.push(args);
    return this;
  }
  or(...args: unknown[]) {
    this.orCalls.push(args);
    return this;
  }
  filter(...args: unknown[]) {
    this.filterCalls.push(args);
    return this;
  }
  gte() {
    return this;
  }
  lte() {
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((
          value:
            | {
                data: Record<string, unknown>[] | null;
                count?: number | null;
                error: { message: string } | null;
              }
            | TResult2
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result).catch(onrejected).then(onfulfilled);
  }
}

test("GET /api/observability/calls paginates after stale live rows are filtered", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () =>
      new FakeQuery({
        data: [
          { id: "stale-1", started_at: "2026-03-20T10:00:00.000Z" },
          { id: "live-1", started_at: "2026-03-30T10:05:00.000Z" },
          { id: "live-2", started_at: "2026-03-30T10:04:00.000Z" },
        ],
        count: 3,
        error: null,
      }) as never,
    isStaleLiveInteractiveCall: (call) =>
      (call as { id?: string }).id === "stale-1",
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?live_only=true&page=1&limit=1"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.calls.map((call: { id: string }) => call.id),
    ["live-1"]
  );
  assert.equal(payload.total, 2);
  assert.equal(payload.page, 1);
  assert.equal(payload.limit, 1);
});

test("GET /api/observability/calls enriches sandbox-backed calls with sandbox_context", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () =>
      new FakeQuery({
        data: [
          {
            id: "call-1",
            type: "agent",
            status: "streaming",
            model: "anthropic/claude-sonnet-4",
            metadata: {
              sandbox_record_id: "sandbox-record-123",
              ai_billing_source: "user_ai_gateway",
            },
          },
        ],
        count: 1,
        error: null,
      }) as never,
    loadSandboxRecords: async () => [
      {
        id: "sandbox-record-123",
        sandbox_id: "sandbox-runtime-123",
        billing_source: "user_vercel_project",
        billing_team_id: "team_123",
        billing_project_id: "project_123",
        preview_url: "https://preview.example.com",
      },
    ],
  });

  const response = await handler(
    new NextRequest("http://localhost/api/observability/calls?page=1&limit=10")
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.calls[0].sandbox_context, {
    sandbox_record_id: "sandbox-record-123",
    sandbox_id: "sandbox-runtime-123",
    compute_billing_source: "user_vercel_project",
    billing_project_id: "project_123",
    billing_team_id: "team_123",
    preview_url: "https://preview.example.com",
  });
});

test("GET /api/observability/calls preserves gateway cost source fields", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () =>
      new FakeQuery({
        data: [
          {
            id: "call-gateway",
            type: "chat",
            status: "success",
            model: "openai/gpt-5.4-mini",
            cost_usd: 0.0123,
            cost_source: "gateway",
            gateway_generation_id: "gen_123",
            metadata: {},
          },
        ],
        count: 1,
        error: null,
      }) as never,
  });

  const response = await handler(
    new NextRequest("http://localhost/api/observability/calls?page=1&limit=10")
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.calls[0].cost_source, "gateway");
  assert.equal(payload.calls[0].gateway_generation_id, "gen_123");
});

test("GET /api/observability/calls leaves sandbox_context null when the sandbox record is missing", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () =>
      new FakeQuery({
        data: [
          {
            id: "call-1",
            type: "agent",
            status: "streaming",
            model: "anthropic/claude-sonnet-4",
            metadata: {
              sandbox_record_id: "sandbox-record-missing",
            },
          },
        ],
        count: 1,
        error: null,
      }) as never,
    loadSandboxRecords: async () => [],
  });

  const response = await handler(
    new NextRequest("http://localhost/api/observability/calls?page=1&limit=10")
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.calls[0].sandbox_context, null);
});

test("GET /api/observability/calls cloud surface excludes pending and streaming rows", async () => {
  const {
    createObservabilityCallsGetHandler,
    OBSERVABILITY_SURFACE_OR_FILTERS,
  } = await loadObservabilityCallsRoute();
  const query = new FakeQuery({ data: [], count: 0, error: null });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&surface=cloud"
    )
  );

  // Must filter to rows with no job_run_id and no runtime_command_id
  assert.ok(
    query.isCalls.some(([col, val]) => col === "job_run_id" && val === null)
  );
  assert.ok(
    query.isCalls.some(
      ([col, val]) => col === "runtime_command_id" && val === null
    )
  );
  // Must exclude live (pending/streaming) rows so deriveSurface agrees with the filter
  assert.ok(
    query.notCalls.some(
      ([col, op, val]) =>
        col === "status" && op === "in" && val === "(pending,streaming)"
    )
  );
  // Must exclude rows the deriveSurface helper classifies as CLI via
  // metadata.source while still keeping normal cloud rows where source is
  // absent/null. PostgREST neq/not.eq predicates do not match nulls.
  // This is query-construction coverage; the MOGPLEX_RUN_DB_TESTS integration
  // smoke test below validates live PostgREST execution semantics.
  assert.ok(
    query.orCalls.some(
      ([expr]) => expr === OBSERVABILITY_SURFACE_OR_FILTERS.nonCliMetadataSource
    )
  );
});

test("GET /api/observability/calls cli surface includes metadata.source = 'cli' rows", async () => {
  const {
    createObservabilityCallsGetHandler,
    OBSERVABILITY_SURFACE_OR_FILTERS,
  } = await loadObservabilityCallsRoute();
  const query = new FakeQuery({ data: [], count: 0, error: null });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&surface=cli"
    )
  );

  // Must exclude automation rows so the server-side surface filter matches
  // deriveSurface's job_run_id-before-runtime_command_id precedence.
  assert.ok(
    query.isCalls.some(([col, val]) => col === "job_run_id" && val === null)
  );
  // The CLI inference shim records calls without a runtime_command_id and
  // only stamps metadata.source = "cli". Both markers must select the row.
  // This is query-construction coverage; the MOGPLEX_RUN_DB_TESTS integration
  // smoke test below validates live PostgREST execution semantics.
  assert.ok(
    query.orCalls.some(
      ([expr]) => expr === OBSERVABILITY_SURFACE_OR_FILTERS.cliSurface
    )
  );
});

test("PostgREST accepts observability surface or() filters with JSON accessors", async (t) => {
  if (process.env.MOGPLEX_RUN_DB_TESTS !== "1") {
    t.skip("Set MOGPLEX_RUN_DB_TESTS=1 to run Supabase integration coverage");
    return;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required"
    );
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ||= supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= serviceRoleKey;

  const { createClient } = await import("@supabase/supabase-js");
  const { OBSERVABILITY_SURFACE_OR_FILTERS } =
    await loadObservabilityCallsRoute();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  for (const [name, expression] of Object.entries(
    OBSERVABILITY_SURFACE_OR_FILTERS
  )) {
    const { error } = await supabase
      .from("ai_calls")
      .select("id", { count: "exact", head: true })
      .or(expression)
      .limit(1);

    if (error) {
      assert.fail(
        `${name} PostgREST or() filter should parse: ${error.message}`
      );
    }
  }
});

test("GET /api/observability/calls applies repo_id filtering", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const query = new FakeQuery({
    data: [],
    count: 0,
    error: null,
  });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&repo_id=repo-1"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  assert.ok(
    query.eqCalls.some(
      ([column, value]) => column === "repo_id" && value === "repo-1"
    )
  );
});

test("GET /api/observability/calls applies sandbox_record_id filtering", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const query = new FakeQuery({
    data: [],
    count: 0,
    error: null,
  });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&sandbox_record_id=sandbox-record-123"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  assert.ok(
    query.filterCalls.some(
      ([column, operator, value]) =>
        column === "metadata->>sandbox_record_id" &&
        operator === "eq" &&
        value === "sandbox-record-123"
    )
  );
});

test("GET /api/observability/calls applies Slack attribution filtering", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const query = new FakeQuery({
    data: [],
    count: 0,
    error: null,
  });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&slack_attribution_mode=installer_fallback"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  assert.ok(
    query.filterCalls.some(
      ([column, operator, value]) =>
        column === "metadata->>slack_attribution_mode" &&
        operator === "eq" &&
        value === "installer_fallback"
    )
  );
});

test("GET /api/observability/calls can combine repo_id and sandbox_record_id filters", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const query = new FakeQuery({
    data: [],
    count: 0,
    error: null,
  });

  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () => "user-123",
    buildQuery: () => query as never,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?page=1&limit=10&repo_id=repo-1&sandbox_record_id=sandbox-record-123"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  assert.ok(
    query.eqCalls.some(
      ([column, value]) => column === "repo_id" && value === "repo-1"
    )
  );
  assert.ok(
    query.filterCalls.some(
      ([column, operator, value]) =>
        column === "metadata->>sandbox_record_id" &&
        operator === "eq" &&
        value === "sandbox-record-123"
    )
  );
});
