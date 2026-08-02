import assert from "node:assert/strict";
import test from "node:test";
import {
  isRepairablePendingJob,
  isStaleRunningJob,
  STALE_PENDING_JOB_THRESHOLD_MS,
  STALE_RUNNING_JOB_THRESHOLD_MS,
} from "../../lib/workflows/job-run-repair";

const NOW = Date.UTC(2026, 2, 21, 18, 0, 0);

test("repair route targets stale pending jobs even if a prior workflow id exists", () => {
  assert.equal(
    isRepairablePendingJob(
      {
        status: "pending",
        created_at: new Date(
          NOW - STALE_PENDING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    true
  );

  assert.equal(
    isRepairablePendingJob(
      {
        status: "pending",
        created_at: new Date(
          NOW - STALE_PENDING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    true
  );

  assert.equal(
    isRepairablePendingJob(
      {
        status: "running",
        created_at: new Date(
          NOW - STALE_PENDING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    false
  );
});

test("fresh pending jobs are left alone for the primary starter path", () => {
  assert.equal(
    isRepairablePendingJob(
      {
        status: "pending",
        created_at: new Date(
          NOW - STALE_PENDING_JOB_THRESHOLD_MS + 1000
        ).toISOString(),
      },
      NOW
    ),
    false
  );
});

test("isStaleRunningJob targets running jobs past the running-threshold only", () => {
  // Running jobs that haven't reached the threshold are live.
  assert.equal(
    isStaleRunningJob(
      {
        status: "running",
        started_at: new Date(
          NOW - STALE_RUNNING_JOB_THRESHOLD_MS + 1000
        ).toISOString(),
      },
      NOW
    ),
    false
  );

  // Running jobs past the threshold are stale.
  assert.equal(
    isStaleRunningJob(
      {
        status: "running",
        started_at: new Date(
          NOW - STALE_RUNNING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    true
  );

  // Pending jobs are NOT caught by this predicate even if they're old —
  // that's repair territory, not zombie-reaping territory.
  assert.equal(
    isStaleRunningJob(
      {
        status: "pending",
        started_at: new Date(
          NOW - STALE_RUNNING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    false
  );

  // No anchor → not stale (defensive: don't reap rows we can't age).
  assert.equal(
    isStaleRunningJob(
      {
        status: "running",
        started_at: null,
        created_at: null,
      },
      NOW
    ),
    false
  );

  // Falls back to created_at when started_at is null.
  assert.equal(
    isStaleRunningJob(
      {
        status: "running",
        started_at: null,
        created_at: new Date(
          NOW - STALE_RUNNING_JOB_THRESHOLD_MS - 1000
        ).toISOString(),
      },
      NOW
    ),
    true
  );
});
