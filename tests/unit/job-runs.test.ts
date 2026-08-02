import assert from "node:assert/strict";
import test from "node:test";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
  summarizeEntityJobRuns,
} from "../../lib/job-runs";
import { STALE_PENDING_JOB_THRESHOLD_MS } from "../../lib/workflows/job-run-repair";

const NOW = Date.UTC(2026, 2, 21, 20, 0, 0);

test("manual retries are classified separately from flow, trigger, and assignment runs", () => {
  assert.equal(
    getJobRunSourceKind({
      trigger_id: null,
      flow_id: null,
      retry_of_job_run_id: null,
    }),
    "assignment"
  );
  assert.equal(
    getJobRunSourceKind({
      trigger_id: "trigger-1",
      flow_id: null,
      retry_of_job_run_id: null,
    }),
    "trigger"
  );
  assert.equal(
    getJobRunSourceKind({
      trigger_id: null,
      flow_id: "flow-1",
      retry_of_job_run_id: null,
    }),
    "flow"
  );
  assert.equal(
    getJobRunSourceKind({
      trigger_id: null,
      flow_id: "flow-1",
      retry_of_job_run_id: "job-1",
    }),
    "manual_retry"
  );
});

test("repairable pending runs use the most recent start attempt timestamp", () => {
  const freshAttempt = new Date(NOW - 1000).toISOString();
  const staleCreation = new Date(
    NOW - STALE_PENDING_JOB_THRESHOLD_MS - 10_000
  ).toISOString();

  assert.equal(
    isRepairableJobRun(
      {
        status: "pending",
        created_at: staleCreation,
        last_start_attempt_at: freshAttempt,
      },
      NOW
    ),
    false
  );

  assert.equal(
    isRepairableJobRun(
      {
        status: "pending",
        created_at: staleCreation,
        last_start_attempt_at: new Date(
          NOW - STALE_PENDING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    true
  );
});

test("entity summaries expose last run state and retry/requeue affordances", () => {
  const summary = summarizeEntityJobRuns(
    [
      {
        id: "run-1",
        status: "failed",
        error: "boom",
        created_at: new Date(NOW - 60_000).toISOString(),
        started_at: new Date(NOW - 60_000).toISOString(),
        last_start_attempt_at: new Date(NOW - 60_000).toISOString(),
      },
      {
        id: "run-2",
        status: "running",
        error: null,
        created_at: new Date(NOW - 10_000).toISOString(),
        started_at: new Date(NOW - 10_000).toISOString(),
        last_start_attempt_at: new Date(NOW - 10_000).toISOString(),
      },
    ],
    NOW
  );

  assert.equal(summary.last_job_run_id, "run-2");
  assert.equal(summary.last_run_status, "running");
  assert.equal(summary.running_count, 1);
  assert.equal(summary.failed_24h, 1);
  assert.equal(summary.last_run_requeueable, false);
  assert.equal(summary.last_run_cancelable, true);
});

test("failed runs are requeueable", () => {
  assert.equal(isRequeueableJobRun({ status: "failed" }), true);
  assert.equal(isRequeueableJobRun({ status: "success" }), false);
});

test("pending and running runs are cancelable until a cancel is requested or completed", () => {
  assert.equal(
    isCancelableJobRun({
      status: "pending",
      cancel_requested_at: null,
      cancelled_at: null,
    }),
    true
  );
  assert.equal(
    isCancelableJobRun({
      status: "running",
      cancel_requested_at: null,
      cancelled_at: null,
    }),
    true
  );
  assert.equal(
    isCancelableJobRun({
      status: "failed",
      cancel_requested_at: null,
      cancelled_at: null,
    }),
    false
  );
  assert.equal(
    isCancelableJobRun({
      status: "cancelled",
      cancel_requested_at: null,
      cancelled_at: "2026-03-29T12:00:00.000Z",
    }),
    false
  );
  assert.equal(
    isCancelableJobRun({
      status: "running",
      cancel_requested_at: "2026-03-29T12:00:00.000Z",
      cancelled_at: null,
    }),
    false
  );
});
