import assert from "node:assert/strict";
import test from "node:test";
import {
  loadJobRunCancelModule,
  withPatchedCancellationStore,
} from "./helpers/job-run-cancel-fixtures";

test("cancelAutomationJobRun leaves running jobs requested-but-not-cancelled when Trigger cancellation fails", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-running",
          status: "running",
          assignment_id: null,
          trigger_id: null,
          flow_id: "flow-1",
          flow_version_id: "flow-version-1",
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: "run_123",
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {},
        },
      ],
      flows: [
        {
          id: "flow-1",
          user_id: "user-1",
        },
      ],
      cancelImpl: async () => {
        throw new Error("trigger cancel failed");
      },
    },
    async ({ jobRuns, dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      await assert.rejects(
        () => cancelAutomationJobRun("job-running"),
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );

      assert.equal(jobRuns[0]?.status, "running");
      assert.equal(typeof jobRuns[0]?.cancel_requested_at, "string");
      assert.equal(jobRuns[0]?.cancel_reason, "USER_REQUESTED");
      assert.match(
        jobRuns[0]?.cancel_error || "",
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );
      assert.equal(jobRuns[0]?.cancelled_at, null);
      assert.equal(jobRuns[0]?.completed_at, null);
      assert.deepEqual(
        dispatchEvents.map((event) => event.outcome),
        ["cancel_requested", "cancel_failed"]
      );
      assert.ok(dispatchEvents.every((event) => event.user_id === "user-1"));
    }
  );
});

test("cancelAutomationJobRun resolves assignment owners through the linked repo", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-assignment",
          status: "running",
          assignment_id: "assignment-1",
          trigger_id: null,
          flow_id: null,
          flow_version_id: null,
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: "run_assignment",
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {
            repo_id: "repo-1",
            source_type: "pr_review",
          },
        },
      ],
      assignments: [
        {
          id: "assignment-1",
          repo_id: "repo-1",
        },
      ],
      repos: [
        {
          id: "repo-1",
          user_id: "user-assignment",
        },
      ],
      cancelImpl: async () => {
        throw new Error("trigger cancel failed");
      },
    },
    async ({ dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      await assert.rejects(
        () => cancelAutomationJobRun("job-assignment"),
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );

      assert.deepEqual(
        dispatchEvents.map((event) => ({
          userId: event.user_id,
          outcome: event.outcome,
        })),
        [
          {
            userId: "user-assignment",
            outcome: "cancel_requested",
          },
          {
            userId: "user-assignment",
            outcome: "cancel_failed",
          },
        ]
      );
    }
  );
});

test("cancelAutomationJobRun still finalizes when the owner record has been deleted", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-missing-owner",
          status: "running",
          assignment_id: null,
          trigger_id: null,
          flow_id: "flow-deleted",
          flow_version_id: "flow-version-1",
          retry_of_job_run_id: null,
          runtime_provider: null,
          runtime_run_id: null,
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {},
        },
      ],
      flowWaits: [
        {
          id: "wait-1",
          job_run_id: "job-missing-owner",
          status: "waiting",
          resume_payload: null,
        },
      ],
      cancelImpl: async () => {},
    },
    async ({ jobRuns, flowWaits, dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      const result = await cancelAutomationJobRun("job-missing-owner");

      assert.equal(result.ok, true);
      if (!result.ok) {
        assert.fail("expected cancellation to succeed without an owner record");
      }

      assert.equal(jobRuns[0]?.status, "cancelled");
      assert.equal(jobRuns[0]?.cancel_reason, "USER_REQUESTED");
      assert.equal(flowWaits[0]?.status, "cancelled");
      assert.equal(flowWaits[0]?.resume_payload?.cancelled, true);
      assert.equal(dispatchEvents.length, 0);
    }
  );
});

test("reconcileAutomationJobRuns records a reconciled control event when it finalizes a missing runtime handle", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-running",
          status: "running",
          assignment_id: null,
          trigger_id: "trigger-1",
          flow_id: null,
          flow_version_id: null,
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: null,
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {
            repo_id: "repo-1",
            source_type: "pr_opened",
          },
        },
      ],
      triggers: [
        {
          id: "trigger-1",
          user_id: "user-1",
        },
      ],
      cancelImpl: async () => {},
    },
    async ({ jobRuns, dispatchEvents }) => {
      const { reconcileAutomationJobRuns } = await loadJobRunCancelModule();

      const results = await reconcileAutomationJobRuns(10);

      assert.deepEqual(results, [
        {
          jobRunId: "job-running",
          outcome: "failed",
          reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
        },
      ]);
      assert.equal(jobRuns[0]?.status, "failed");
      assert.equal(jobRuns[0]?.error, "RECONCILED_MISSING_RUNTIME_HANDLE");
      assert.deepEqual(
        dispatchEvents.map((event) => ({
          userId: event.user_id,
          outcome: event.outcome,
          reason: event.reason,
        })),
        [
          {
            userId: "user-1",
            outcome: "reconciled",
            reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
          },
        ]
      );
    }
  );
});
