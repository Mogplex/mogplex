import assert from "node:assert/strict";
import test from "node:test";

async function loadObservabilityJobCancelRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/jobs/[id]/cancel/route");
}

test("POST /api/observability/jobs/[id]/cancel returns 404 for missing owned runs", async () => {
  const { createObservabilityJobCancelPostHandler } =
    await loadObservabilityJobCancelRoute();

  const handler = createObservabilityJobCancelPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: null }),
    cancelAutomationJobRun: async () => {
      throw new Error("cancelAutomationJobRun should not be called");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/cancel", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Job run not found" });
});

test("POST /api/observability/jobs/[id]/cancel returns 409 for terminal runs", async () => {
  const { createObservabilityJobCancelPostHandler } =
    await loadObservabilityJobCancelRoute();

  const handler = createObservabilityJobCancelPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({
      scope: {} as never,
      run: {
        id: "job-1",
        status: "success",
      } as never,
    }),
    cancelAutomationJobRun: async () => ({
      ok: false,
      notFound: false,
      status: "success",
      cancelable: false,
      cancelRequestedAt: null,
      cancelledAt: null,
      cancelReason: null,
      cancelError: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/cancel", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Job run is not cancelable",
    status: "success",
    cancelRequestedAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelError: null,
  });
});

test("POST /api/observability/jobs/[id]/cancel returns durable cancellation details", async () => {
  const { createObservabilityJobCancelPostHandler } =
    await loadObservabilityJobCancelRoute();

  const handler = createObservabilityJobCancelPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({
      scope: {} as never,
      run: {
        id: "job-1",
        status: "running",
      } as never,
    }),
    cancelAutomationJobRun: async () => ({
      ok: true,
      status: "cancelled",
      cancelRequestedAt: "2026-03-29T15:00:00.000Z",
      cancelledAt: "2026-03-29T15:00:02.000Z",
      cancelReason: "USER_REQUESTED",
      cancelError: null,
      runtimeProvider: "trigger",
      runtimeRunId: "run_123",
      aiCallsCancellationRequested: 1,
      releasedJobs: [{ jobRunId: "job-2", started: true, reason: null }],
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/cancel", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "cancelled",
    cancelRequestedAt: "2026-03-29T15:00:00.000Z",
    cancelledAt: "2026-03-29T15:00:02.000Z",
    cancelReason: "USER_REQUESTED",
    cancelError: null,
    runtimeProvider: "trigger",
    runtimeRunId: "run_123",
    aiCallsCancellationRequested: 1,
    releasedJobs: [{ jobRunId: "job-2", started: true, reason: null }],
  });
});
