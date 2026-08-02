import assert from "node:assert/strict";
import test from "node:test";

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => T | Promise<T>
) {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function loadJobsProcessRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/jobs/process/route");
}

test("POST /api/jobs/process returns 503 when CRON_SECRET is missing", async () => {
  const { createJobsProcessPostHandler } = await loadJobsProcessRoute();

  const handler = createJobsProcessPostHandler({
    startAutomationJobRun: async () => {
      throw new Error("startAutomationJobRun should not be called");
    },
  });

  const response = await withEnv({ CRON_SECRET: undefined }, () =>
    handler(
      new Request("http://localhost/api/jobs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-123" }),
      })
    )
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "CRON_SECRET_NOT_CONFIGURED",
  });
});

test("POST /api/jobs/process returns 401 when bearer auth is missing or invalid", async () => {
  const { createJobsProcessPostHandler } = await loadJobsProcessRoute();

  const handler = createJobsProcessPostHandler({
    startAutomationJobRun: async () => {
      throw new Error("startAutomationJobRun should not be called");
    },
  });

  await withEnv({ CRON_SECRET: "cron-secret" }, async () => {
    const missingHeader = await handler(
      new Request("http://localhost/api/jobs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-123" }),
      })
    );

    assert.equal(missingHeader.status, 401);
    assert.deepEqual(await missingHeader.json(), { error: "Unauthorized" });

    const invalidHeader = await handler(
      new Request("http://localhost/api/jobs/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-secret",
        },
        body: JSON.stringify({ jobId: "job-123" }),
      })
    );

    assert.equal(invalidHeader.status, 401);
    assert.deepEqual(await invalidHeader.json(), { error: "Unauthorized" });
  });
});

test("POST /api/jobs/process returns provider-neutral runtime identifiers when bearer auth is valid", async () => {
  const { createJobsProcessPostHandler } = await loadJobsProcessRoute();
  const calls: Array<{ jobId: string; source: string | undefined }> = [];

  const handler = createJobsProcessPostHandler({
    startAutomationJobRun: async (jobId, source) => {
      calls.push({ jobId, source });
      return {
        started: true,
        deferred: false,
        reason: null,
        status: "pending",
        runtimeProvider: "trigger",
        runtimeRunId: "run-process-123",
      };
    },
  });

  const response = await withEnv({ CRON_SECRET: "cron-secret" }, () =>
    handler(
      new Request("http://localhost/api/jobs/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer cron-secret",
        },
        body: JSON.stringify({ jobId: "job-123" }),
      })
    )
  );

  assert.deepEqual(calls, [{ jobId: "job-123", source: "repair" }]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    started: true,
    deferred: false,
    reason: null,
    status: "pending",
    runtimeProvider: "trigger",
    runtimeRunId: "run-process-123",
    workflowRunId: null,
  });
});
