import assert from "node:assert/strict";
import test from "node:test";
import type { JobRunRow } from "../../lib/job-run-service";
import type { JobRunRetryContext } from "../../lib/job-run-retry";

async function loadJobRunRetry() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/job-run-retry");
}

function buildRun(overrides: Partial<JobRunRow> = {}): JobRunRow {
  return {
    id: "job-1",
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-1",
    flow_version_id: "version-1",
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
    metadata: {
      flow_id: "flow-1",
      flow_version_id: "version-1",
      source_type: "pr_opened",
      pr_number: 568,
    },
    ...overrides,
  };
}

function buildRetryContext(
  overrides: Partial<JobRunRetryContext> = {}
): JobRunRetryContext {
  const run = overrides.run ?? buildRun();

  return {
    run,
    userId: "user-1",
    sourceType: "pr_opened",
    assignmentId: run.assignment_id,
    triggerId: run.trigger_id,
    flowId: run.flow_id,
    flowVersionId: run.flow_version_id,
    repoId: "repo-1",
    installationId: 123,
    metadata: run.metadata,
    ...overrides,
  };
}

test("latest flow versions must keep the original trigger and installation", async () => {
  const { isPublishedFlowVersionRetryCompatible } = await loadJobRunRetry();
  const graph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { event: "pr_opened" },
      },
    ],
    edges: [],
  };

  assert.equal(
    isPublishedFlowVersionRetryCompatible({
      graph,
      installationId: 123,
      expectedInstallationId: 123,
      expectedSourceType: "pr_opened",
    }),
    true
  );
  assert.equal(
    isPublishedFlowVersionRetryCompatible({
      graph,
      installationId: 456,
      expectedInstallationId: 123,
      expectedSourceType: "pr_opened",
    }),
    false
  );
  assert.equal(
    isPublishedFlowVersionRetryCompatible({
      graph,
      installationId: 123,
      expectedInstallationId: 123,
      expectedSourceType: "issue_opened",
    }),
    false
  );
});

test("latest_published reruns use the current owned flow version in the row and metadata", async () => {
  const { createEnqueueJobRunRetry } = await loadJobRunRetry();
  const enqueued: unknown[] = [];
  const ownershipChecks: unknown[] = [];
  const enqueueJobRunRetry = createEnqueueJobRunRetry({
    enqueueAutomationJobRun: async (input) => {
      enqueued.push(input);
      return { jobRunId: "job-2", outcome: "queued", reason: null };
    },
    loadOwnedPublishedFlowVersionId: async (input) => {
      ownershipChecks.push(input);
      return "version-2";
    },
    now: () => 1_752_587_000_000,
  });

  await enqueueJobRunRetry({
    retryContext: buildRetryContext(),
    idempotencyKeyPrefix: "manual_retry",
    versionMode: "latest_published",
    metadataPatch: {
      flow_id: "untrusted-flow",
      flow_version_id: "untrusted-version",
      retry_version_mode: "untrusted-mode",
      source_type: "untrusted-source",
    },
  });

  assert.deepEqual(ownershipChecks, [
    {
      userId: "user-1",
      flowId: "flow-1",
      expectedInstallationId: 123,
      expectedSourceType: "pr_opened",
    },
  ]);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    userId: "user-1",
    assignmentId: null,
    triggerId: null,
    retryOfJobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: "version-2",
    repoId: "repo-1",
    installationId: 123,
    sourceKind: "manual_retry",
    sourceType: "pr_opened",
    idempotencyKey: "manual_retry:job-1:1752587000000",
    metadata: {
      flow_id: "flow-1",
      flow_version_id: "version-2",
      source_type: "pr_opened",
      repo_id: "repo-1",
      installation_id: 123,
      pr_number: 568,
      retry_version_mode: "latest_published",
      retry_original_flow_version_id: "version-1",
      retry_selected_flow_version_id: "version-2",
    },
  });
});

test("same_version reruns preserve the original snapshot without loading current flow state", async () => {
  const { createEnqueueJobRunRetry } = await loadJobRunRetry();
  const enqueued: unknown[] = [];
  const enqueueJobRunRetry = createEnqueueJobRunRetry({
    enqueueAutomationJobRun: async (input) => {
      enqueued.push(input);
      return { jobRunId: "job-2", outcome: "queued", reason: null };
    },
    loadOwnedPublishedFlowVersionId: async () => {
      throw new Error("latest version lookup should not run");
    },
    now: () => 1,
  });

  await enqueueJobRunRetry({
    retryContext: buildRetryContext(),
    idempotencyKeyPrefix: "manual_retry",
    versionMode: "same_version",
  });

  assert.equal(
    (enqueued[0] as { flowVersionId: string }).flowVersionId,
    "version-1"
  );
  assert.deepEqual(
    (enqueued[0] as { metadata: Record<string, unknown> }).metadata,
    {
      flow_id: "flow-1",
      flow_version_id: "version-1",
      source_type: "pr_opened",
      repo_id: "repo-1",
      installation_id: 123,
      pr_number: 568,
      retry_version_mode: "same_version",
      retry_original_flow_version_id: "version-1",
      retry_selected_flow_version_id: "version-1",
    }
  );
});

test("event-driven reruns can supply a stable idempotency key", async () => {
  const { createEnqueueJobRunRetry } = await loadJobRunRetry();
  const enqueuedKeys: string[] = [];
  const enqueueJobRunRetry = createEnqueueJobRunRetry({
    enqueueAutomationJobRun: async (input) => {
      enqueuedKeys.push(input.idempotencyKey);
      return { jobRunId: "job-2", outcome: "queued", reason: null };
    },
    loadOwnedPublishedFlowVersionId: async () => {
      throw new Error("latest version lookup should not run");
    },
    now: () => {
      throw new Error("clock should not be used for an explicit key");
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await enqueueJobRunRetry({
      retryContext: buildRetryContext(),
      idempotencyKeyPrefix: "ignored",
      idempotencyKey: "github-webhook:check-run-rerun:91:delivery-1",
      versionMode: "same_version",
    });
  }

  assert.deepEqual(enqueuedKeys, [
    "github-webhook:check-run-rerun:91:delivery-1",
    "github-webhook:check-run-rerun:91:delivery-1",
  ]);
});

test("a later retry clears stale latest-version fallback metadata", async () => {
  const { createEnqueueJobRunRetry } = await loadJobRunRetry();
  const enqueuedMetadata: Array<Record<string, unknown>> = [];
  const enqueueJobRunRetry = createEnqueueJobRunRetry({
    enqueueAutomationJobRun: async (input) => {
      enqueuedMetadata.push(input.metadata ?? {});
      return { jobRunId: "job-3", outcome: "queued", reason: null };
    },
    loadOwnedPublishedFlowVersionId: async () => "version-3",
  });

  await enqueueJobRunRetry({
    retryContext: buildRetryContext({
      metadata: {
        ...buildRun().metadata,
        retry_latest_published_unavailable: true,
      },
    }),
    idempotencyKeyPrefix: "manual_retry",
    versionMode: "latest_published",
  });

  assert.equal(
    "retry_latest_published_unavailable" in enqueuedMetadata[0]!,
    false
  );
});

test("latest_published reruns fail closed when no owned published version is available", async () => {
  const { JobRunRetryVersionError, createEnqueueJobRunRetry } =
    await loadJobRunRetry();
  const enqueueJobRunRetry = createEnqueueJobRunRetry({
    enqueueAutomationJobRun: async () => {
      throw new Error("enqueue should not run");
    },
    loadOwnedPublishedFlowVersionId: async () => null,
  });

  await assert.rejects(
    enqueueJobRunRetry({
      retryContext: buildRetryContext(),
      idempotencyKeyPrefix: "manual_retry",
      versionMode: "latest_published",
    }),
    (error: unknown) => {
      assert.ok(error instanceof JobRunRetryVersionError);
      assert.equal(error.code, "LATEST_PUBLISHED_VERSION_UNAVAILABLE");
      return true;
    }
  );
});

test("default rerun mode uses latest for flow runs and the snapshot for legacy runs", async () => {
  const { getDefaultJobRunRetryVersionMode } = await loadJobRunRetry();
  assert.equal(
    getDefaultJobRunRetryVersionMode(buildRetryContext()),
    "latest_published"
  );
  assert.equal(
    getDefaultJobRunRetryVersionMode(
      buildRetryContext({
        run: buildRun({ flow_id: null, flow_version_id: null }),
        flowId: null,
        flowVersionId: null,
      })
    ),
    "same_version"
  );
});
