import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

async function loadCancelRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/v1/mogplex/runs/[runId]/cancel/route");
}

function paramsOf(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/mogplex/runs/run-1/cancel", {
    method: "POST",
    headers: {
      authorization: "Bearer mog_valid",
      ...headers,
    },
  });
}

test("POST /runs/{id}/cancel returns 401 without a Bearer token", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadCancelRoute();
  const handler = createMogplexApiRunCancelPostHandler({
    resolveApiKey: async () => ({ ok: false, reason: "invalid" }),
    cancelRun: async () => {
      throw new Error("cancelRun should not run for unauthenticated requests");
    },
  });
  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs/run-1/cancel", {
      method: "POST",
    }),
    paramsOf("run-1")
  );
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("POST /runs/{id}/cancel returns 403 for read-only PATs", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadCancelRoute();
  let cancelCalled = false;
  const handler = createMogplexApiRunCancelPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read"],
      },
    }),
    cancelRun: async () => {
      cancelCalled = true;
      throw new Error("cancelRun should not run when scope check fails");
    },
  });
  const response = await handler(request(), paramsOf("run-1"));
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error.code, "FORBIDDEN");
  assert.ok(payload.error.message.includes("write"));
  assert.equal(cancelCalled, false);
});

test("POST /runs/{id}/cancel returns 404 when the run does not exist", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadCancelRoute();
  const handler = createMogplexApiRunCancelPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    cancelRun: async () => null,
  });
  const response = await handler(request(), paramsOf("run-missing"));
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("POST /runs/{id}/cancel returns the cancel result on success", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadCancelRoute();
  const cancelCalls: Array<{ userId: string; runId: string }> = [];
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
      cancelCalls.push(input);
      return {
        run: { runId: input.runId } as never,
        status: "cancellation_requested",
      } as never;
    },
  });
  const response = await handler(request(), paramsOf("run-1"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, "cancellation_requested");
  assert.deepEqual(cancelCalls, [{ userId: "user-123", runId: "run-1" }]);
});
