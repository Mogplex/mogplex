import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildRunRow,
  loadRunsRoute,
} from "./helpers/mogplex-api-runs-fixtures";

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
