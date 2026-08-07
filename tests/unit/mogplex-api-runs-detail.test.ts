import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { listMogplexApiRunEvents } from "../../lib/mogplex-api/run-control";
import {
  loadMogplexApiRun,
  presentMogplexApiRun,
} from "../../lib/mogplex-api/runs";
import {
  buildAiCallEvent,
  buildRunRow,
  loadRunDetailRoute,
  loadRunEventsRoute,
} from "./helpers/mogplex-api-runs-fixtures";

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
