import assert from "node:assert/strict";
import test from "node:test";
import type { JobRunRow } from "../../lib/job-run-service";
import type { JobRunRetryContext } from "../../lib/job-run-retry";

async function loadObservabilityJobRequeueRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/jobs/[id]/requeue/route");
}

function buildRun(flowId: string | null = "flow-1", id = "job-1"): JobRunRow {
  return {
    id,
    assignment_id: null,
    trigger_id: null,
    flow_id: flowId,
    flow_version_id: flowId ? "version-1" : null,
    runtime_provider: null,
    runtime_run_id: null,
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "failed",
    created_at: "2026-07-15T13:42:00.000Z",
    started_at: "2026-07-15T13:42:01.000Z",
    completed_at: "2026-07-15T13:42:07.000Z",
    input_tokens: 10,
    output_tokens: 0,
    cost_usd: 0,
    duration_ms: 6000,
    error: "provider unavailable",
    start_attempts: 1,
    last_start_attempt_at: "2026-07-15T13:42:01.000Z",
    last_start_error: null,
    last_start_source: "webhook",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: null,
  };
}

function buildRetryContext(
  flowId: string | null = "flow-1",
  id = "job-1"
): JobRunRetryContext {
  return {
    run: buildRun(flowId, id),
    userId: "user-1",
    sourceType: "pr_opened",
    assignmentId: null,
    triggerId: null,
    flowId,
    flowVersionId: flowId ? "version-1" : null,
    repoId: "repo-1",
    installationId: 123,
    metadata: null,
  };
}

test("requeue defaults flow-backed runs to latest_published", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const enqueueInputs: unknown[] = [];
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: buildRun() }),
    loadJobRunRetryContext: async () => buildRetryContext(),
    enqueueJobRunRetry: async (input) => {
      enqueueInputs.push({
        versionMode: input.versionMode,
        ...(input.metadataPatch ? { metadataPatch: input.metadataPatch } : {}),
      });
      return { jobRunId: "job-2", outcome: "queued", reason: null };
    },
    startAutomationJobRun: async () => ({
      started: true,
      deferred: false,
      reason: null,
      status: "pending",
      runtimeProvider: "trigger",
      runtimeRunId: "run-2",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/requeue", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 200);
  assert.equal(
    (enqueueInputs[0] as { versionMode: string }).versionMode,
    "latest_published"
  );
});

test("requeue honors explicit same_version and defaults legacy runs to it", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const modes: string[] = [];
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async (_userId, id) => ({
      scope: {} as never,
      run: buildRun(id === "legacy-job" ? null : "flow-1", id),
    }),
    loadJobRunRetryContext: async (id) =>
      buildRetryContext(id === "legacy-job" ? null : "flow-1", id),
    enqueueJobRunRetry: async (input) => {
      modes.push(input.versionMode);
      return { jobRunId: null, outcome: "suppressed", reason: "TEST" };
    },
    startAutomationJobRun: async () => {
      throw new Error("start should not run");
    },
  });

  await handler(
    new Request("http://localhost/api/observability/jobs/flow-job/requeue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionMode: "same_version" }),
    }),
    { params: Promise.resolve({ id: "flow-job" }) }
  );
  await handler(
    new Request("http://localhost/api/observability/jobs/legacy-job/requeue", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "legacy-job" }) }
  );

  assert.deepEqual(modes, ["same_version", "same_version"]);
});

test("requeue reuses and starts an idempotent duplicate job", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const startedJobIds: string[] = [];
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: buildRun() }),
    loadJobRunRetryContext: async () => buildRetryContext(),
    enqueueJobRunRetry: async () => ({
      jobRunId: "job-2",
      outcome: "suppressed",
      reason: "IDEMPOTENT_DUPLICATE",
    }),
    startAutomationJobRun: async (jobRunId) => {
      startedJobIds.push(jobRunId);
      return {
        started: true,
        deferred: false,
        status: "pending",
        runtimeProvider: "trigger",
        runtimeRunId: "trigger-run-2",
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/requeue", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );
  const body = await response.json();

  assert.deepEqual(startedJobIds, ["job-2"]);
  assert.equal(body.queued, false);
  assert.equal(body.suppressed, true);
  assert.equal(body.reused, true);
  assert.equal(body.started, true);
});

test("requeue rejects unsupported version modes", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: buildRun() }),
    loadJobRunRetryContext: async () => buildRetryContext(),
    enqueueJobRunRetry: async () => {
      throw new Error("enqueue should not run");
    },
    startAutomationJobRun: async () => {
      throw new Error("start should not run");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/requeue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionMode: "draft" }),
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "versionMode must be same_version or latest_published",
  });
});

test("default requeue falls back to the original snapshot when latest is unavailable", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const { JobRunRetryVersionError } = await import("../../lib/job-run-retry");
  const enqueueInputs: Array<{
    versionMode: string;
    metadataPatch?: Record<string, unknown>;
  }> = [];
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: buildRun() }),
    loadJobRunRetryContext: async () => buildRetryContext(),
    enqueueJobRunRetry: async (input) => {
      enqueueInputs.push({
        versionMode: input.versionMode,
        ...(input.metadataPatch ? { metadataPatch: input.metadataPatch } : {}),
      });
      if (input.versionMode === "latest_published") {
        throw new JobRunRetryVersionError();
      }
      return { jobRunId: "job-2", outcome: "queued", reason: null };
    },
    startAutomationJobRun: async () => ({
      started: true,
      deferred: false,
      status: "pending",
      runtimeProvider: "trigger",
      runtimeRunId: "trigger-run-2",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/requeue", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).versionFallbackUsed, true);
  assert.deepEqual(enqueueInputs, [
    { versionMode: "latest_published" },
    {
      versionMode: "same_version",
      metadataPatch: { retry_latest_published_unavailable: true },
    },
  ]);
});

test("explicit latest_published requeue remains strict when latest is unavailable", async () => {
  const { createObservabilityJobRequeuePostHandler } =
    await loadObservabilityJobRequeueRoute();
  const { JobRunRetryVersionError } = await import("../../lib/job-run-retry");
  const handler = createObservabilityJobRequeuePostHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRun: async () => ({ scope: {} as never, run: buildRun() }),
    loadJobRunRetryContext: async () => buildRetryContext(),
    enqueueJobRunRetry: async () => {
      throw new JobRunRetryVersionError();
    },
    startAutomationJobRun: async () => {
      throw new Error("start should not run");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1/requeue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionMode: "latest_published" }),
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The flow does not have an owned published version to run",
    code: "LATEST_PUBLISHED_VERSION_UNAVAILABLE",
  });
});
