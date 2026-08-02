import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTaskModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const [triggerModule, workflowModule] = await Promise.all([
    import("../../trigger/automation-job"),
    import("../../lib/workflows/automation-job-workflow"),
  ]);
  return {
    ...triggerModule,
    JOB_RUN_CANCELLED: workflowModule.JOB_RUN_CANCELLED,
  };
}

function createTestPayload() {
  return {
    jobRunId: "job-run-123",
    startedAt: "2026-04-13T21:46:37.284Z",
    releasedScope: {
      sourceKind: "flow" as const,
      sourceType: "pr_opened",
      sourceId: "flow-source-123",
      repoId: "repo-123",
      installationId: 123,
    },
  };
}

function createMetadataStub(entries: Array<[string, unknown]>) {
  const metadataStub = {
    set(key: string, value: unknown) {
      entries.push([key, value]);
      return metadataStub;
    },
  };

  return metadataStub;
}

test("runTriggerAutomationJob returns successful workflow results as-is", async () => {
  const { runTriggerAutomationJob } = await loadTriggerTaskModule();
  const metadataEntries: Array<[string, unknown]> = [];

  const result = await runTriggerAutomationJob(createTestPayload(), {
    executeAutomationJobRun: async () => ({
      success: true as const,
      output: "done",
      observabilityError: null,
    }),
    metadata: createMetadataStub(metadataEntries) as never,
  });

  assert.deepEqual(result, {
    success: true,
    output: "done",
    observabilityError: null,
  });
  assert.deepEqual(metadataEntries, [
    ["jobRunId", "job-run-123"],
    ["repoId", "repo-123"],
    ["installationId", 123],
    ["sourceType", "pr_opened"],
  ]);
});

test("executeAutomationJobTask keeps the Trigger.dev timeout at 30 minutes", async () => {
  const { AUTOMATION_JOB_TRIGGER_MAX_DURATION_SECONDS } =
    await loadTriggerTaskModule();

  assert.equal(AUTOMATION_JOB_TRIGGER_MAX_DURATION_SECONDS, 60 * 30);
});

test("runTriggerAutomationJob aborts failed workflow results so Trigger marks the run failed", async () => {
  const { runTriggerAutomationJob } = await loadTriggerTaskModule();
  const metadataEntries: Array<[string, unknown]> = [];

  await assert.rejects(
    () =>
      runTriggerAutomationJob(createTestPayload(), {
        executeAutomationJobRun: async () => ({
          success: false as const,
          error:
            "Automation model request timed out: Gateway request timed out: The operation was aborted due to timeout",
          observabilityError: "observability sink unavailable",
          modelFailure: {
            phase: "pr_review",
            failureClass: "provider_unavailable" as const,
            statusCode: 503,
            attempts: 2,
            retryCount: 1,
          },
        }),
        metadata: createMetadataStub(metadataEntries) as never,
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortTaskRunError");
      assert.equal(
        error.message,
        "Automation model request timed out: Gateway request timed out: The operation was aborted due to timeout"
      );
      return true;
    }
  );

  assert.deepEqual(metadataEntries, [
    ["jobRunId", "job-run-123"],
    ["repoId", "repo-123"],
    ["installationId", 123],
    ["sourceType", "pr_opened"],
    ["observabilityError", "observability sink unavailable"],
    ["modelPhase", "pr_review"],
    ["modelFailureClass", "provider_unavailable"],
    ["modelFailureStatusCode", 503],
    ["modelAttempts", 2],
    ["modelRetryCount", 1],
  ]);
});

test("runTriggerAutomationJob aborts even a retryable dependency_unavailable failure", async () => {
  // Retryable describes the failure, not the job. By the time a modelFailure
  // comes back, executeAutomationJobRun has already published a GitHub check run
  // and PR comment, persisted the failure, recorded a dispatch event, written an
  // ai_calls row and released queued jobs — a task-level re-run duplicates all
  // of it. Recovery for this class lives in loadTeamAllowlistState's read retry,
  // which runs before any of that bookkeeping.
  const { runTriggerAutomationJob } = await loadTriggerTaskModule();
  const metadataEntries: Array<[string, unknown]> = [];

  await assert.rejects(
    () =>
      runTriggerAutomationJob(createTestPayload(), {
        executeAutomationJobRun: async () => ({
          success: false as const,
          error:
            "Automation could not verify run policy: Couldn't verify the team's model allowlist. Please try again.",
          observabilityError: null,
          modelFailure: {
            phase: "pr_review:model_resolution",
            failureClass: "dependency_unavailable" as const,
            statusCode: null,
            attempts: 0,
            retryCount: 0,
          },
        }),
        metadata: createMetadataStub(metadataEntries) as never,
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortTaskRunError");
      return true;
    }
  );

  // Diagnostics still recorded, so the class remains visible in observability
  // even though it does not drive a re-run.
  assert.deepEqual(metadataEntries.slice(-4), [
    ["modelFailureClass", "dependency_unavailable"],
    ["modelFailureStatusCode", null],
    ["modelAttempts", 0],
    ["modelRetryCount", 0],
  ]);
});

test("runTriggerAutomationJob aborts non-retryable failures so Trigger marks the run failed without retrying", async () => {
  const { runTriggerAutomationJob } = await loadTriggerTaskModule();

  await assert.rejects(
    () =>
      runTriggerAutomationJob(createTestPayload(), {
        executeAutomationJobRun: async () => ({
          success: false as const,
          error: "NO_GITHUB_CONNECTION",
          observabilityError: null,
        }),
        metadata: createMetadataStub([]) as never,
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortTaskRunError");
      assert.equal(error.message, "NO_GITHUB_CONNECTION");
      return true;
    }
  );
});

test("runTriggerAutomationJob preserves cancelled workflow results", async () => {
  const { runTriggerAutomationJob, JOB_RUN_CANCELLED } =
    await loadTriggerTaskModule();

  const result = await runTriggerAutomationJob(createTestPayload(), {
    executeAutomationJobRun: async () => ({
      success: false as const,
      error: JOB_RUN_CANCELLED,
    }),
    metadata: createMetadataStub([]) as never,
  });

  assert.deepEqual(result, {
    success: false,
    error: JOB_RUN_CANCELLED,
  });
});
