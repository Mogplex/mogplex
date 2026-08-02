import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  MogplexApiRunControlError,
  cancelMogplexApiRun,
  listMogplexApiRunEvents,
} from "../../lib/mogplex-api/run-control";
import {
  buildExternalAgentHarnessRequestBody,
  executeExternalAgentRun,
} from "../../lib/mogplex-api/run-execution";
import {
  MogplexApiRunError,
  loadMogplexApiRun,
  presentMogplexApiRun,
  startMogplexApiRun,
  type ExternalAgentRunRow,
  type StartMogplexApiRunDeps,
} from "../../lib/mogplex-api/runs";
import type { AiCall, AiCallEvent } from "../../lib/types";

async function loadRunsRoute() {
  // Keep these defaults stable across same-process node:test imports; route
  // modules only need syntactically valid Supabase env for dependency injection.
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/runs/route");
}

async function loadRunDetailRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/runs/[runId]/route");
}

async function loadRunEventsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/runs/[runId]/events/route");
}

async function loadRunCancelRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/runs/[runId]/cancel/route");
}

function buildRunRow(
  overrides: Partial<ExternalAgentRunRow> = {}
): ExternalAgentRunRow {
  return {
    id: "run-1",
    user_id: "user-123",
    repo_id: "repo-1",
    ai_call_id: "call-1",
    sandbox_record_id: "sandbox-record-1",
    sandbox_id: "sbx_123",
    idempotency_key: "idem-1",
    request_hash: "hash-1",
    harness: "codex",
    status: "pending",
    prompt: "Fix the tests",
    base_branch: "main",
    working_branch: "mogplex/external/run",
    create_branch: false,
    root_directory: null,
    conversation_id: null,
    workspace_session_id: null,
    mode: null,
    runtime_provider: null,
    runtime_run_id: null,
    error: null,
    metadata: {},
    created_at: "2026-04-28T00:00:00.000Z",
    updated_at: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildUser() {
  return {
    userId: "user-123",
    keyId: "key-1",
    scopes: ["read", "write"],
  };
}

function buildAiCall(overrides: Partial<AiCall> = {}): AiCall {
  return {
    id: "call-1",
    user_id: "user-123",
    type: "agent",
    model: "harness:codex",
    status: "pending",
    started_at: "2026-04-28T00:00:00.000Z",
    completed_at: null,
    error: null,
    conversation_id: null,
    repo_id: "repo-1",
    metadata: {},
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    reasoning_tokens: null,
    gateway_generation_id: null,
    cost_source: null,
    total_tokens: null,
    cost_usd: null,
    duration_ms: null,
    job_run_id: null,
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: null,
    tool_calls_count: 0,
    tool_calls: [],
    ...overrides,
  };
}

function buildAiCallEvent(overrides: Partial<AiCallEvent> = {}): AiCallEvent {
  return {
    id: "event-1",
    ai_call_id: "call-1",
    user_id: "user-123",
    conversation_id: null,
    repo_id: "repo-1",
    event_type: "started",
    tool_name: null,
    message: "Run started",
    payload: {},
    created_at: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildStartDeps(
  overrides: Partial<StartMogplexApiRunDeps> = {}
): StartMogplexApiRunDeps {
  return {
    loadOwnedRepo: async () => ({
      id: "repo-1",
      full_name: "webrenew/mogplex",
      default_branch: "main",
      root_directory: null,
    }),
    loadRunByIdempotencyKey: async () => null,
    loadRunById: async () => null,
    findActiveSandbox: async () => null,
    createAiCall: async () => buildAiCall(),
    markAiCallFailed: async () => {},
    insertRun: async (input) =>
      buildRunRow({
        request_hash: input.requestHash,
        create_branch: input.normalized.createBranch,
        root_directory: input.normalized.rootDirectory,
        working_branch: input.normalized.workingBranch,
      }),
    queueRun: async () => ({
      runtimeProvider: "trigger",
      runtimeRunId: "trigger-run-1",
    }),
    markRunQueued: async (input) =>
      buildRunRow({
        runtime_provider: input.runtimeProvider,
        runtime_run_id: input.runtimeRunId,
      }),
    markRunFailed: async (input) =>
      buildRunRow({
        status: "failed",
        error: input.error,
      }),
    appendAcceptedEvent: async () => {},
    ...overrides,
  };
}

test("startMogplexApiRun creates a pending external run with ai_call metadata", async () => {
  const inserted: Array<unknown> = [];
  const acceptedEvents: Array<unknown> = [];

  const result = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      harness: "codex",
      baseBranch: "main",
      workingBranch: "mogplex/external/run",
      createBranch: true,
      rootDirectory: "apps/web",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => null,
      loadRunById: async () => null,
      findActiveSandbox: async () => ({
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
      }),
      createAiCall: async (input) =>
        buildAiCall({
          user_id: input.userId,
          type: input.type,
          model: input.model,
          status: input.status ?? "pending",
          conversation_id: input.conversationId ?? null,
          repo_id: input.repoId ?? null,
          metadata: input.metadata ?? {},
        }),
      insertRun: async (input) => {
        inserted.push(input);
        return buildRunRow({
          request_hash: input.requestHash,
          create_branch: input.normalized.createBranch,
          root_directory: input.normalized.rootDirectory,
        });
      },
      markRunQueued: async (input) =>
        buildRunRow({
          create_branch: true,
          root_directory: "apps/web",
          runtime_provider: input.runtimeProvider,
          runtime_run_id: input.runtimeRunId,
        }),
      appendAcceptedEvent: async (input) => {
        acceptedEvents.push(input);
      },
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.run.runId, "run-1");
  assert.equal(result.run.aiCallId, "call-1");
  assert.equal(result.run.sandboxRecordId, "sandbox-record-1");
  assert.equal(result.run.rootDirectory, "apps/web");
  assert.equal(inserted.length, 1);
  assert.equal(acceptedEvents.length, 1);
});

test("startMogplexApiRun merges extraMetadata without clobbering core fields", async () => {
  let aiCallMetadata: Record<string, unknown> | undefined;
  let runMetadata: Record<string, unknown> | undefined;

  await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: { repoId: "repo-1", prompt: "Fix the tests", harness: "codex" },
    extraMetadata: {
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.1" },
      // A caller can't override a core metadata field.
      source: "evil",
    },
    deps: buildStartDeps({
      createAiCall: async (input) => {
        aiCallMetadata = input.metadata!;
        return buildAiCall({ metadata: input.metadata ?? {} });
      },
      insertRun: async (input) => {
        runMetadata = input.metadata as Record<string, unknown>;
        return buildRunRow({ request_hash: input.requestHash });
      },
    }),
  });

  assert.deepEqual(runMetadata?.slackRunControls, {
    teamId: "T1",
    channelId: "C1",
    messageTs: "1.1",
  });
  assert.equal(runMetadata?.source, "external-api");
  assert.deepEqual(aiCallMetadata, runMetadata);
});

test("startMogplexApiRun replays an existing idempotent request", async () => {
  let createdCalls = 0;
  const existing = buildRunRow({ request_hash: "" });

  const first = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      baseBranch: "main",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => null,
      loadRunById: async () => null,
      findActiveSandbox: async () => null,
      createAiCall: async () => {
        createdCalls += 1;
        return buildAiCall();
      },
      insertRun: async (input) => {
        existing.request_hash = input.requestHash;
        return {
          ...buildRunRow(),
          request_hash: input.requestHash,
          create_branch: input.normalized.createBranch,
          working_branch: "main",
        };
      },
      appendAcceptedEvent: async () => {},
    }),
  });

  const replay = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      baseBranch: "main",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => existing,
      loadRunById: async () => null,
      findActiveSandbox: async () => null,
      createAiCall: async () => {
        createdCalls += 1;
        return buildAiCall();
      },
      insertRun: async () => {
        throw new Error("insertRun should not run on replay");
      },
      appendAcceptedEvent: async () => {},
    }),
  });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.runId, "run-1");
  assert.equal(createdCalls, 1);
});

test("startMogplexApiRun rejects idempotency conflicts", async () => {
  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: {
          repoId: "repo-1",
          prompt: "Different request",
          baseBranch: "main",
        },
        deps: buildStartDeps({
          loadOwnedRepo: async () => ({
            id: "repo-1",
            full_name: "webrenew/mogplex",
            default_branch: "main",
            root_directory: null,
          }),
          loadRunByIdempotencyKey: async () =>
            buildRunRow({ request_hash: "not-this-request" }),
          loadRunById: async () => null,
          findActiveSandbox: async () => null,
          createAiCall: async () => buildAiCall(),
          insertRun: async () => buildRunRow(),
          appendAcceptedEvent: async () => {},
        }),
      }),
    (error) =>
      error instanceof MogplexApiRunError &&
      error.code === "IDEMPOTENCY_CONFLICT" &&
      error.status === 409
  );
});

test("startMogplexApiRun rejects invalid start requests before creating ai_calls", async () => {
  const cases: Array<{
    body: Record<string, unknown>;
    message: string;
  }> = [
    {
      body: { repoId: "repo-1", prompt: "Fix it", harness: "bogus" },
      message: "Invalid harness",
    },
    {
      body: { repoId: "repo-1", prompt: "Fix it", baseBranch: "../main" },
      message: "Invalid base branch",
    },
    {
      body: { repoId: "repo-1", prompt: "Fix it", rootDirectory: "../app" },
      message: "Invalid root directory",
    },
    {
      body: {
        repoId: "repo-1",
        prompt: "Fix it",
        createBranch: true,
        workingBranch: "main",
      },
      message:
        "Working branch must differ from base branch when createBranch is true",
    },
  ];

  for (const { body, message } of cases) {
    let createdCalls = 0;
    await assert.rejects(
      () =>
        startMogplexApiRun({
          user: buildUser(),
          idempotencyKey: "idem-1",
          body,
          deps: buildStartDeps({
            createAiCall: async () => {
              createdCalls += 1;
              return buildAiCall();
            },
          }),
        }),
      (error) =>
        error instanceof MogplexApiRunError &&
        error.code === "BAD_REQUEST" &&
        error.message === message
    );
    assert.equal(createdCalls, 0);
  }
});

test("startMogplexApiRun rejects repos outside the PAT user", async () => {
  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-404", prompt: "Fix it" },
        deps: buildStartDeps({
          loadOwnedRepo: async () => null,
          createAiCall: async () => {
            throw new Error("createAiCall should not run");
          },
        }),
      }),
    (error) =>
      error instanceof MogplexApiRunError &&
      error.code === "NOT_FOUND" &&
      error.status === 404
  );
});

test("startMogplexApiRun marks the run failed when queueing fails", async () => {
  const failedRows: Array<unknown> = [];

  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-1", prompt: "Fix it" },
        deps: buildStartDeps({
          queueRun: async () => {
            throw new Error("Trigger.dev runtime is not configured");
          },
          markRunFailed: async (input) => {
            failedRows.push(input);
            return buildRunRow({
              status: "failed",
              error: input.error,
            });
          },
        }),
      }),
    /Trigger\.dev runtime is not configured/
  );

  assert.deepEqual(failedRows, [
    {
      userId: "user-123",
      runId: "run-1",
      error: "Trigger.dev runtime is not configured",
    },
  ]);
});

test("startMogplexApiRun marks ai_call failed when external run insert fails", async () => {
  const failedCalls: Array<unknown> = [];

  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-1", prompt: "Fix it" },
        deps: buildStartDeps({
          insertRun: async () => {
            throw new Error("duplicate idempotency key");
          },
          markAiCallFailed: async (input) => {
            failedCalls.push(input);
          },
          appendAcceptedEvent: async () => {
            throw new Error("appendAcceptedEvent should not run");
          },
          queueRun: async () => {
            throw new Error("queueRun should not run");
          },
        }),
      }),
    /duplicate idempotency key/
  );

  assert.equal(failedCalls.length, 1);
  assert.equal((failedCalls[0] as { aiCall: AiCall }).aiCall.id, "call-1");
});

test("POST /api/v1/mogplex/runs returns 403 for read-only PATs", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  let startCalled = false;
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"], // intentionally missing 'write'
      },
    }),
    startRun: async () => {
      startCalled = true;
      throw new Error("startRun should not run when scope check fails");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
        "idempotency-key": "k1",
      },
      body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
    })
  );

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "FORBIDDEN");
  assert.ok(payload.error.message.includes("write"));
  // Critically: the scope check fires before any side effects.
  assert.equal(startCalled, false);
});

test("POST /api/v1/mogplex/runs requires an idempotency key", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    startRun: async () => {
      throw new Error("startRun should not run");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "BAD_REQUEST",
      message: "Idempotency-Key is required",
    },
  });
});

test("POST /api/v1/mogplex/runs rejects overlong idempotency keys clearly", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    startRun: async () => {
      throw new Error("startRun should not run");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
        "idempotency-key": "x".repeat(201),
      },
      body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "BAD_REQUEST",
      message: "Idempotency-Key exceeds maximum length of 200 characters",
    },
  });
});

test("POST /api/v1/mogplex/runs returns accepted run details", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    enforceRunStartLimits: async (input) => {
      assert.equal(input.apiKeyId, "key-1");
      return { allowed: true };
    },
    startRun: async () => ({
      run: presentMogplexApiRun(buildRunRow()),
      replayed: false,
    }),
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
    })
  );

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.runId, "run-1");
  assert.equal(payload.data.replayed, false);
});

test("POST /api/v1/mogplex/runs rate-limits expensive external run starts by API key", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    enforceRunStartLimits: async (input) => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.apiKeyId, "key-1");
      assert.equal(input.repoId, "repo-1");
      return {
        allowed: false,
        status: 429,
        code: "external_agent_run_rate_limited",
        error: "External Mogplex run rate limit exceeded",
        reason: "external_agent_run_minutely_rate_exceeded",
        retryAfterSeconds: 42,
        limit: {
          name: "external_agent_runs_per_minute",
          value: 10,
          windowSeconds: 60,
        },
      };
    },
    startRun: async () => {
      throw new Error("startRun should not run when rate-limited");
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
    })
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "42");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "External Mogplex run rate limit exceeded",
    },
  });
});

test("POST /api/v1/mogplex/runs fails closed when rate-limit admission fails", async () => {
  const { createMogplexApiRunsPostHandler } = await loadRunsRoute();
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    enforceRunStartLimits: async () => {
      throw new Error("limit table unavailable");
    },
    startRun: async () => {
      throw new Error("startRun should not run when rate-limit check fails");
    },
  });

  try {
    const response = await handler(
      new NextRequest("http://localhost/api/v1/mogplex/runs", {
        method: "POST",
        headers: {
          authorization: "Bearer mog_valid",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
        body: JSON.stringify({ repoId: "repo-1", prompt: "Fix it" }),
      })
    );

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "External Mogplex run rate limit unavailable",
      },
    });
    assert.equal(errors[0]?.[0], "[mogplex-api/runs] rate limit check failed");
  } finally {
    console.error = originalConsoleError;
  }
});

test("GET /api/v1/mogplex/runs/:runId returns owned run details", async () => {
  const { createMogplexApiRunDetailGetHandler } = await loadRunDetailRoute();
  const handler = createMogplexApiRunDetailGetHandler({
    // Read-only PAT: locks in that GET endpoints stay reachable without
    // 'write'. If a future change accidentally adds requireScope(user, 'write')
    // to a GET handler, this test starts returning 403 instead of 200.
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"],
      },
    }),
    loadRun: async () =>
      loadMogplexApiRun({
        userId: "user-123",
        runId: "run-1",
        deps: { loadRunById: async () => buildRunRow() },
      }),
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs/run-1", {
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ runId: "run-1" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.run.runId, "run-1");
  assert.equal(payload.data.run.eventsUrl, "/api/v1/mogplex/runs/run-1/events");
});

test("GET /api/v1/mogplex/runs/:runId returns not found for missing owned run", async () => {
  const { createMogplexApiRunDetailGetHandler } = await loadRunDetailRoute();
  const handler = createMogplexApiRunDetailGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    loadRun: async () => null,
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs/missing", {
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ runId: "missing" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Run not found",
    },
  });
});

test("listMogplexApiRunEvents returns presented ai_call events for an owned run", async () => {
  const result = await listMogplexApiRunEvents({
    userId: "user-123",
    runId: "run-1",
    limit: 10,
    deps: {
      loadRun: async () => buildRunRow(),
      listEvents: async (aiCallId, limit) => {
        assert.equal(aiCallId, "call-1");
        assert.equal(limit, 10);
        return [
          buildAiCallEvent({
            event_type: "status_changed",
            message: "Harness run streaming",
          }),
        ];
      },
    },
  });

  assert.ok(result);
  assert.equal(result.run.runId, "run-1");
  assert.deepEqual(result.events, [
    {
      id: "event-1",
      type: "status_changed",
      toolName: null,
      message: "Harness run streaming",
      payload: {},
      createdAt: "2026-04-28T00:00:00.000Z",
    },
  ]);
});

test("listMogplexApiRunEvents sanitizes event payloads for external callers", async () => {
  const result = await listMogplexApiRunEvents({
    userId: "user-123",
    runId: "run-1",
    limit: 10,
    deps: {
      loadRun: async () => buildRunRow(),
      listEvents: async () => [
        buildAiCallEvent({
          payload: {
            env: {
              GITHUB_TOKEN: "ghp_should_not_escape",
              SAFE_VALUE: "visible",
            },
            runtimeEnv: {
              GH_TOKEN: "ghp_also_secret",
            },
            nested: {
              authorization: "Bearer secret-token",
              output: "visible output",
            },
            ai_billing_source: "internal-billing-source",
            text: "sk-secret-key should redact",
          },
        }),
      ],
    },
  });

  assert.ok(result);
  const payload = result.events[0].payload;
  const serialized = JSON.stringify(payload);
  assert.equal(payload.env, "[redacted]");
  assert.equal(payload.runtimeEnv, "[redacted]");
  assert.equal(payload.ai_billing_source, "[redacted]");
  assert.doesNotMatch(
    serialized,
    /ghp_should_not_escape|ghp_also_secret|secret-token|internal-billing-source|sk-secret-key/
  );
  assert.match(serialized, /visible output/);
});

test("cancelMogplexApiRun finalizes pending runs without a runtime command", async () => {
  let currentRun = buildRunRow({ status: "pending" });
  const events: Array<unknown> = [];

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () => buildAiCall({ status: currentRun.status }),
      requestCancellation: async () =>
        buildAiCall({
          status: "pending",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async (event) => {
        events.push(event);
        return null;
      },
      killRuntimeCommand: async () => {
        throw new Error("killRuntimeCommand should not run");
      },
    },
  });

  assert.ok(result);
  assert.equal(result.status, "cancelled");
  assert.equal(result.run.status, "cancelled");
  assert.equal(currentRun.status, "cancelled");
  assert.equal(events.length, 2);
});

test("cancelMogplexApiRun strips the Slack run-controls button on terminal transitions", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const notifyTerminal = async (
    run: { id: string; metadata: unknown },
    status: string
  ) => {
    notified.push({ runId: run.id, status });
  };

  // Active run → cancelled: hook fires once.
  let currentRun = buildRunRow({ status: "pending" });
  await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () => buildAiCall({ status: currentRun.status }),
      requestCancellation: async () =>
        buildAiCall({
          status: "pending",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
      notifyTerminal,
    },
  });

  // Already-terminal run: hook still fires (defensive re-strip).
  await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => buildRunRow({ status: "success" }),
      updateRun: async () => {
        throw new Error("updateRun should not run");
      },
      loadAiCall: async () => buildAiCall(),
      requestCancellation: async () => {
        throw new Error("requestCancellation should not run");
      },
      finalizeCancelled: async () => {
        throw new Error("finalizeCancelled should not run");
      },
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
      notifyTerminal,
    },
  });

  assert.deepEqual(notified, [
    { runId: "run-1", status: "cancelled" },
    { runId: "run-1", status: "success" },
  ]);
});

test("cancelMogplexApiRun does not overwrite a run completed during cancellation", async () => {
  const initialRun = buildRunRow({ status: "streaming" });
  const completedRun = buildRunRow({ status: "success" });
  const updates: Array<unknown> = [];
  const events: Array<unknown> = [];
  let loadCount = 0;

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => {
        loadCount += 1;
        return loadCount === 1 ? initialRun : completedRun;
      },
      updateRun: async (_userId, _runId, update) => {
        updates.push(update);
        return null;
      },
      loadAiCall: async () => buildAiCall({ status: "streaming" }),
      requestCancellation: async () =>
        buildAiCall({
          status: "streaming",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async (event) => {
        events.push(event);
        return null;
      },
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "success");
  assert.equal(result.run.status, "success");
  assert.deepEqual(updates, [{ status: "cancelled", error: null }]);
  assert.equal(events.length, 1);
});

test("cancelMogplexApiRun returns current state for terminal runs", async () => {
  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => buildRunRow({ status: "cancelled" }),
      updateRun: async () => {
        throw new Error("updateRun should not run for terminal runs");
      },
      loadAiCall: async () => {
        throw new Error("loadAiCall should not run for terminal runs");
      },
      requestCancellation: async () => null,
      finalizeCancelled: async () => null,
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "cancelled");
  assert.equal(result.run.status, "cancelled");
});

test("cancelMogplexApiRun syncs terminal ai_call state instead of returning a conflict", async () => {
  let currentRun = buildRunRow({ status: "streaming" });

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () =>
        buildAiCall({ status: "failed", error: "Harness failed" }),
      requestCancellation: async () => null,
      finalizeCancelled: async () => null,
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.error, "Harness failed");
});

test("cancelMogplexApiRun reports inconsistent state when ai_call is missing", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () =>
        cancelMogplexApiRun({
          userId: "user-123",
          runId: "run-1",
          deps: {
            loadRun: async () => buildRunRow({ status: "pending" }),
            updateRun: async () => {
              throw new Error("updateRun should not run");
            },
            loadAiCall: async () => null,
            requestCancellation: async () => null,
            finalizeCancelled: async () => null,
            appendEvent: async () => null,
            killRuntimeCommand: async () => {},
          },
        }),
      (error) =>
        error instanceof MogplexApiRunControlError &&
        error.code === "CONFLICT" &&
        error.status === 409 &&
        error.message === "Run state is inconsistent"
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("GET /api/v1/mogplex/runs/:runId/events returns events in the external envelope", async () => {
  const { createMogplexApiRunEventsGetHandler } = await loadRunEventsRoute();
  const handler = createMogplexApiRunEventsGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    listEvents: async (input) => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.runId, "run-1");
      assert.equal(input.limit, 12);
      return {
        run: presentMogplexApiRun(buildRunRow()),
        events: [
          {
            id: "event-1",
            type: "started",
            toolName: null,
            message: "Run started",
            payload: {},
            createdAt: "2026-04-28T00:00:00.000Z",
          },
        ],
      };
    },
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/runs/run-1/events?limit=12",
      {
        headers: { authorization: "Bearer mog_valid" },
      }
    ),
    { params: Promise.resolve({ runId: "run-1" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.events.length, 1);
});

test("POST /api/v1/mogplex/runs/:runId/cancel returns cancellation status", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadRunCancelRoute();
  const handler = createMogplexApiRunCancelPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    cancelRun: async (input) => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.runId, "run-1");
      return {
        run: presentMogplexApiRun(buildRunRow({ status: "cancelled" })),
        status: "cancelled",
        alreadyTerminal: false,
      };
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs/run-1/cancel", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ runId: "run-1" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, "cancelled");
  assert.equal(payload.data.run.status, "cancelled");
});

test("buildExternalAgentHarnessRequestBody carries Slack image attachment metadata", () => {
  const body = buildExternalAgentHarnessRequestBody(
    buildRunRow({
      metadata: {
        slack_image_attachments: {
          teamId: "T1",
          droppedCount: 1,
          files: [
            {
              id: "F1",
              mimetype: "image/png",
              urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
              name: "screenshot.png",
              sizeBytes: 123,
            },
            {
              id: "bad",
              mimetype: "application/pdf",
              urlPrivateDownload: "https://files.slack.com/files-pri/T-bad/pdf",
            },
          ],
        },
      },
    })
  );

  assert.deepEqual(body.slackImageAttachments, {
    teamId: "T1",
    droppedCount: 1,
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
        name: "screenshot.png",
        sizeBytes: 123,
      },
    ],
  });
});

test("executeExternalAgentRun launches the sandbox, runs the harness, and mirrors ai_call status", async () => {
  let currentRun = buildRunRow({
    sandbox_record_id: null,
    sandbox_id: null,
    create_branch: true,
  });
  const updates: Array<Partial<ExternalAgentRunRow>> = [];
  let harnessRan = false;

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (userId, _runId, update) => {
        assert.equal(userId, "user-123");
        updates.push(update);
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async (run) => {
        assert.equal(run.create_branch, true);
        return { recordId: "sandbox-record-1", sandboxId: "sbx_123" };
      },
      runHarness: async (run, sandbox) => {
        assert.equal(run.status, "streaming");
        assert.equal(sandbox.recordId, "sandbox-record-1");
        harnessRan = true;
      },
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => {
        throw new Error("appendEvent should not run on success");
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "success");
  assert.equal(harnessRan, true);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["streaming", "success"]
  );
  assert.equal(currentRun.sandbox_record_id, "sandbox-record-1");
  assert.equal(currentRun.sandbox_id, "sbx_123");
});

test("executeExternalAgentRun records failed launches on the run and ai_call events", async () => {
  let currentRun = buildRunRow();
  const failedEvents: Array<unknown> = [];

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (userId, _runId, update) => {
        assert.equal(userId, "user-123");
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async () => {
        throw new Error("Sandbox launch failed");
      },
      runHarness: async () => {
        throw new Error("runHarness should not run");
      },
      loadAiCall: async () => buildAiCall(),
      appendEvent: async (event) => {
        failedEvents.push(event);
        return null;
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Sandbox launch failed");
  assert.equal(currentRun.status, "failed");
  assert.equal(currentRun.error, "Sandbox launch failed");
  assert.equal(failedEvents.length, 1);
});

test("executeExternalAgentRun notifies the terminal-state hook on success and failure", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const notify = async (
    run: { id: string; metadata: unknown },
    status: string
  ) => {
    notified.push({ runId: run.id, status });
  };

  await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "pending" }),
      updateRun: async (_userId, _runId, update) => buildRunRow({ ...update }),
      launchSandbox: async () => ({
        recordId: "sandbox-record-1",
        sandboxId: "sbx_123",
      }),
      runHarness: async () => {},
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: notify,
    }
  );

  await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "pending" }),
      updateRun: async (_userId, _runId, update) => buildRunRow({ ...update }),
      launchSandbox: async () => {
        throw new Error("boom");
      },
      runHarness: async () => {},
      loadAiCall: async () => buildAiCall(),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: notify,
    }
  );

  assert.deepEqual(notified, [
    { runId: "run-1", status: "success" },
    { runId: "run-1", status: "failed" },
  ]);
});

test("executeExternalAgentRun swallows a throwing terminal-state hook", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await executeExternalAgentRun(
      { runId: "run-1", userId: "user-123" },
      {
        loadRun: async () => buildRunRow({ status: "pending" }),
        updateRun: async (_userId, _runId, update) =>
          buildRunRow({ ...update }),
        launchSandbox: async () => ({
          recordId: "sandbox-record-1",
          sandboxId: "sbx_123",
        }),
        runHarness: async () => {},
        loadAiCall: async () => buildAiCall({ status: "success" }),
        appendEvent: async () => null,
        notifyRunReachedTerminalState: async () => {
          throw new Error("slack down");
        },
      }
    );
    assert.equal(result.success, true);
    assert.equal(result.status, "success");
  } finally {
    console.warn = originalWarn;
  }
});

test("executeExternalAgentRun re-notifies when the run was already terminal", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "success" }),
      updateRun: async () => {
        throw new Error("updateRun should not run for an already-terminal run");
      },
      launchSandbox: async () => {
        throw new Error("launchSandbox should not run");
      },
      runHarness: async () => {},
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async (run, status) => {
        notified.push({ runId: run.id, status });
      },
    }
  );
  assert.equal(result.status, "success");
  assert.deepEqual(notified, [{ runId: "run-1", status: "success" }]);
});
