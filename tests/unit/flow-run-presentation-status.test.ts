import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchOutcomeLabel,
  dispatchOutcomeTone,
  flowRunStatusLabel,
  flowWaitDescription,
  formatDuration,
  formatRunSourceType,
  getActiveFlowWaits,
  getRunCancellationState,
} from "../../lib/flows/run-presentation";
import { buildCancellationStateRun } from "./helpers/flow-run-presentation-fixtures";

test("dispatch outcomes keep labels and tones aligned for queued, started, and cancelled", () => {
  assert.deepEqual(
    [
      {
        outcome: "queued" as const,
        label: dispatchOutcomeLabel("queued"),
        tone: dispatchOutcomeTone("queued"),
      },
      {
        outcome: "started" as const,
        label: dispatchOutcomeLabel("started"),
        tone: dispatchOutcomeTone("started"),
      },
      {
        outcome: "cancelled" as const,
        label: dispatchOutcomeLabel("cancelled"),
        tone: dispatchOutcomeTone("cancelled"),
      },
    ],
    [
      {
        outcome: "queued",
        label: "Queued",
        tone: "text-accent-green border-accent-green/20 bg-accent-green/[0.06]",
      },
      {
        outcome: "started",
        label: "Started",
        tone: "text-accent-green border-accent-green/20 bg-accent-green/[0.06]",
      },
      {
        outcome: "cancelled",
        label: "Cancelled",
        tone: "text-muted-foreground border-border bg-secondary/50",
      },
    ]
  );
});

test("run source labels render PR opened in uppercase", () => {
  assert.equal(formatRunSourceType("pr_opened"), "PR OPENED");
  assert.equal(formatRunSourceType("issue_opened"), "issue opened");
});

test("running flow runs with an active durable wait present as waiting", () => {
  const wait = {
    id: "wait-1",
    user_id: "user-1",
    job_run_id: "job-1",
    flow_id: "flow-1",
    flow_version_id: "version-1",
    installation_id: 99,
    repo_id: "repo-1",
    node_id: "await-1",
    wait_kind: "ci_workflow_completed",
    wait_config: {
      kind: "ci_workflow_completed",
      workflowName: "CI / test",
      conclusion: "success",
      matchTriggerSha: true,
      expectedSha: "abc123",
    },
    resume_token: "token-1",
    status: "waiting",
    expires_at: null,
    created_at: "2026-07-23T12:00:00.000Z",
    resumed_at: null,
    resume_payload: null,
    resume_delivery_id: null,
  } as const;
  const run = { status: "running" as const, waits: [wait] };

  assert.equal(flowRunStatusLabel(run), "waiting");
  assert.deepEqual(getActiveFlowWaits(run), [wait]);
  assert.equal(flowWaitDescription(wait), "CI / test · success");
});

test("GitHub comment waits describe their author and text filters", () => {
  const wait = {
    id: "wait-comment",
    user_id: "user-1",
    job_run_id: "job-1",
    flow_id: "flow-1",
    flow_version_id: "version-1",
    installation_id: 99,
    repo_id: "repo-1",
    node_id: "await-comment",
    wait_kind: "github_comment_added",
    wait_config: {
      kind: "github_comment_added",
      bodyContains: "approved",
      authorLogin: "alice",
      prOnly: true,
      matchTriggerIssue: true,
      expectedIssueNumber: 42,
    },
    resume_token: "token-comment",
    status: "waiting",
    expires_at: null,
    created_at: "2026-07-24T12:00:00.000Z",
    resumed_at: null,
    resume_payload: null,
    resume_delivery_id: null,
  } as const;

  assert.equal(
    flowWaitDescription(wait),
    'GitHub comment from @alice containing "approved"'
  );
});

test("run summaries with an active wait count present as waiting", () => {
  assert.equal(
    flowRunStatusLabel({ status: "running", active_wait_count: 1 }),
    "waiting"
  );
  assert.equal(
    flowRunStatusLabel({ status: "running", active_wait_count: 0 }),
    "running"
  );
  assert.equal(
    flowRunStatusLabel({ status: "success", active_wait_count: 1 }),
    "success"
  );
});

test("cancellation state surfaces requested, failed, and completed branches", () => {
  assert.deepEqual(
    getRunCancellationState(
      buildCancellationStateRun({
        cancel_requested_at: "2026-03-29T11:01:00.000Z",
        cancel_reason: "USER_REQUESTED",
      })
    ),
    {
      label: "Cancel requested",
      detail: "USER_REQUESTED",
      finalizedByReconciliation: false,
    }
  );

  assert.deepEqual(
    getRunCancellationState(
      buildCancellationStateRun({
        cancel_requested_at: "2026-03-29T11:01:00.000Z",
        cancel_error: "runtime unavailable",
      })
    ),
    {
      label: "Cancel failed",
      detail: "runtime unavailable",
      finalizedByReconciliation: false,
    }
  );

  assert.deepEqual(
    getRunCancellationState(
      buildCancellationStateRun({
        cancel_requested_at: "2026-03-29T11:01:00.000Z",
        cancelled_at: "2026-03-29T11:01:02.000Z",
        cancel_reason: "USER_REQUESTED",
        dispatch_events: [
          {
            id: "dispatch-1",
            event_kind: "control",
            outcome: "cancel_requested",
            reason: "USER_REQUESTED",
            metadata: null,
            created_at: "2026-03-29T11:01:00.000Z",
          },
          {
            id: "dispatch-2",
            event_kind: "control",
            outcome: "reconciled",
            reason: "USER_REQUESTED",
            metadata: null,
            created_at: "2026-03-29T11:01:03.000Z",
          },
        ],
      })
    ),
    {
      label: "Cancelled",
      detail: "USER_REQUESTED",
      finalizedByReconciliation: true,
    }
  );
});

test("formatDuration handles null, zero, millisecond, second, and minute ranges", () => {
  assert.equal(formatDuration(null), "n/a");
  assert.equal(formatDuration(-1), "n/a");
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1_500), "1.5s");
  assert.equal(formatDuration(10_000), "10s");
  assert.equal(formatDuration(61_000), "1m 1s");
});
