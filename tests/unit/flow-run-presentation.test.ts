import assert from "node:assert/strict";
import test from "node:test";
import type { FlowRunDetail, FlowRunRecord } from "../../lib/types";
import {
  collectRunEditDiffs,
  dispatchOutcomeLabel,
  dispatchOutcomeTone,
  flowRunStatusLabel,
  flowWaitDescription,
  formatDuration,
  formatRunSourceType,
  getActiveFlowWaits,
  getRunActionDescriptors,
  getRunActionEmptyState,
  getRunCancellationState,
  resolveReviewFindingIssueLink,
  resolveReviewedTargetLink,
  MAX_RUN_EDIT_DIFFS,
  type RunActionDescriptor,
} from "../../lib/flows/run-presentation";

type ActionableRunFixture = Pick<
  FlowRunRecord,
  "status" | "cancelable" | "repairable" | "requeueable"
>;

type ReviewedTargetRunFixture = Pick<FlowRunRecord, "repo" | "metadata">;

type CancellationStateFixture = Pick<
  FlowRunDetail,
  | "cancel_requested_at"
  | "cancelled_at"
  | "cancel_reason"
  | "cancel_error"
  | "dispatch_events"
>;

const CANCEL_DESCRIPTOR = {
  action: "cancel",
  label: "Cancel",
  emphasis: "destructive",
} satisfies RunActionDescriptor;

const RETRY_DESCRIPTOR = {
  action: "requeue",
  label: "Retry",
  emphasis: "secondary",
} satisfies RunActionDescriptor;

const PRIMARY_REPAIR_DESCRIPTOR = {
  action: "repair",
  label: "Repair",
  emphasis: "primary",
} satisfies RunActionDescriptor;

const SECONDARY_REPAIR_DESCRIPTOR = {
  action: "repair",
  label: "Repair",
  emphasis: "secondary",
} satisfies RunActionDescriptor;

function buildActionableRun(
  run: Partial<ActionableRunFixture> & Pick<ActionableRunFixture, "status">
): ActionableRunFixture {
  const { status, ...overrides } = run;

  return {
    status,
    cancelable: false,
    repairable: false,
    requeueable: false,
    ...overrides,
  };
}

function buildReviewedTargetRun(
  overrides: Partial<ReviewedTargetRunFixture> = {}
): ReviewedTargetRunFixture {
  return {
    repo: { id: "repo-1", full_name: "webrenew/mogplex" },
    metadata: { pr_number: 138 },
    ...overrides,
  };
}

function buildCancellationStateRun(
  overrides: Partial<CancellationStateFixture> = {}
): CancellationStateFixture {
  return {
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    dispatch_events: [],
    ...overrides,
  };
}

const runActionScenarios: Array<{
  name: string;
  run: ActionableRunFixture;
  expected: RunActionDescriptor[];
  emptyState?: string;
}> = [
  {
    name: "running runs only expose cancel when cancelable",
    run: buildActionableRun({ status: "running", cancelable: true }),
    expected: [CANCEL_DESCRIPTOR],
  },
  {
    name: "running runs without cancellation support expose no actions",
    run: buildActionableRun({ status: "running" }),
    expected: [],
    emptyState: "This run is active, and no controls are currently available.",
  },
  {
    name: "stale pending runs keep repair available alongside cancel",
    run: buildActionableRun({
      status: "pending",
      cancelable: true,
      repairable: true,
    }),
    expected: [PRIMARY_REPAIR_DESCRIPTOR, CANCEL_DESCRIPTOR],
  },
  {
    name: "pending runs can expose repair without cancel",
    run: buildActionableRun({ status: "pending", repairable: true }),
    expected: [PRIMARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "pending runs can expose cancel without repair",
    run: buildActionableRun({ status: "pending", cancelable: true }),
    expected: [CANCEL_DESCRIPTOR],
  },
  {
    name: "pending runs without repair or cancellation support expose no actions",
    run: buildActionableRun({ status: "pending" }),
    expected: [],
    emptyState: "This run is active, and no controls are currently available.",
  },
  {
    name: "failed runs prioritize retry and render follow-up actions secondary",
    run: buildActionableRun({
      status: "failed",
      repairable: true,
      requeueable: true,
    }),
    expected: [RETRY_DESCRIPTOR, SECONDARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "failed runs can surface retry without repair",
    run: buildActionableRun({ status: "failed", requeueable: true }),
    expected: [RETRY_DESCRIPTOR],
  },
  {
    name: "failed runs can surface repair without retry",
    run: buildActionableRun({ status: "failed", repairable: true }),
    expected: [SECONDARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "failed runs without repair or retry expose no actions",
    run: buildActionableRun({ status: "failed" }),
    expected: [],
    emptyState: "This run cannot be retried or repaired from here.",
  },
  {
    name: "successful runs ignore stale action flags",
    run: buildActionableRun({
      status: "success",
      cancelable: true,
      repairable: true,
      requeueable: true,
    }),
    expected: [],
    emptyState: "Completed runs do not have follow-up actions.",
  },
  {
    name: "cancelled runs ignore stale action flags",
    run: buildActionableRun({
      status: "cancelled",
      cancelable: true,
      repairable: true,
      requeueable: true,
    }),
    expected: [],
    emptyState: "This run is already cancelled.",
  },
];

for (const scenario of runActionScenarios) {
  test(scenario.name, () => {
    assert.deepEqual(getRunActionDescriptors(scenario.run), scenario.expected);

    if (scenario.emptyState) {
      assert.equal(getRunActionEmptyState(scenario.run), scenario.emptyState);
    }
  });
}

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

test("reviewed target resolves GitHub pull request links from repo and metadata", () => {
  assert.deepEqual(resolveReviewedTargetLink(buildReviewedTargetRun()), {
    href: "https://github.com/webrenew/mogplex/pull/138",
    label: "PR #138",
  });
});

test("reviewed target prefers a canonical PR URL when repository metadata is missing", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        repo: { id: null, full_name: null },
        metadata: {
          pr_number: 138,
          pr_url:
            "https://github.com/webrenew/mogplex/pull/138?utm_source=run#discussion",
        },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/138",
      label: "PR #138",
    }
  );
});

test("reviewed target rejects unsafe PR URLs and keeps the legacy fallback", () => {
  const invalidPrUrls: Array<{ name: string; value: unknown }> = [
    {
      name: "non-GitHub host",
      value: "https://example.com/webrenew/mogplex/pull/999",
    },
    {
      name: "spoofed GitHub subdomain",
      value: "https://github.com.evil.example/webrenew/mogplex/pull/999",
    },
    {
      name: "non-HTTPS protocol",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- rejection-path fixture
      value: "http://github.com/webrenew/mogplex/pull/999",
    },
    {
      name: "unsafe protocol",
      // eslint-disable-next-line no-script-url -- rejection-path fixture
      value: "javascript:alert('unsafe')",
    },
    { name: "malformed URL", value: "not a url" },
    {
      name: "issue path instead of pull request path",
      value: "https://github.com/webrenew/mogplex/issues/999",
    },
    {
      name: "non-numeric pull request number",
      value: "https://github.com/webrenew/mogplex/pull/not-a-number",
    },
    {
      name: "zero pull request number",
      value: "https://github.com/webrenew/mogplex/pull/0",
    },
    {
      name: "extra path segment",
      value: "https://github.com/webrenew/mogplex/pull/999/files",
    },
    {
      name: "missing repository segment",
      value: "https://github.com/webrenew/pull/999",
    },
    {
      name: "non-string metadata",
      value: { href: "https://github.com/webrenew/mogplex/pull/999" },
    },
  ];
  const legacyFallback = {
    href: "https://github.com/webrenew/mogplex/pull/138",
    label: "PR #138",
  };

  for (const scenario of invalidPrUrls) {
    assert.deepEqual(
      resolveReviewedTargetLink(
        buildReviewedTargetRun({
          metadata: { pr_number: 138, pr_url: scenario.value },
        })
      ),
      legacyFallback,
      scenario.name
    );
  }

  assert.equal(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        repo: { id: null, full_name: null },
        metadata: {
          pr_url: "https://github.com/webrenew/mogplex/issues/138",
        },
      })
    ),
    null
  );
});

test("reviewed target resolves GitHub issue links from issue_number metadata", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { issue_number: 42, issue_url: "ignored" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/issues/42",
      label: "Issue #42",
    }
  );
});

test("reviewed target routes PR comments (is_pr) through the pull request URL", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { issue_number: 99, is_pr: true },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/99",
      label: "PR #99",
    }
  );
});

test("reviewed target resolves push commits from head_sha", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { head_sha: "abcdef1234567890abcdef1234567890abcdef12" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/commit/abcdef1234567890abcdef1234567890abcdef12",
      label: "Commit abcdef1",
    }
  );
});

test("reviewed target resolves commit comments from commit_id", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { commit_id: "0123456789abcdef0123456789abcdef01234567" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/commit/0123456789abcdef0123456789abcdef01234567",
      label: "Commit 0123456",
    }
  );
});

test("reviewed target prefers PR over issue when both are present", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { pr_number: 12, issue_number: 99 },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/12",
      label: "PR #12",
    }
  );
});

test("reviewed target rejects commit shas that are not hex or are too short", () => {
  for (const badSha of ["nothex0", "abcdef", "abc xyz1234567"]) {
    assert.equal(
      resolveReviewedTargetLink(
        buildReviewedTargetRun({ metadata: { head_sha: badSha } })
      ),
      null,
      `should reject head_sha ${JSON.stringify(badSha)}`
    );
  }
});

test("reviewed target rejects malformed repo names and missing metadata", () => {
  const invalidReviewedTargetRuns: Array<{
    name: string;
    run: ReviewedTargetRunFixture;
  }> = [
    {
      name: "missing metadata",
      run: buildReviewedTargetRun({ metadata: null }),
    },
    {
      name: "missing repo",
      run: buildReviewedTargetRun({ repo: { id: null, full_name: null } }),
    },
    {
      name: "query string in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/mogplex?tab=readme" },
      }),
    },
    {
      name: "embedded whitespace in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/\nmogplex" },
      }),
    },
    {
      name: "path traversal in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/../../../admin" },
        metadata: { pr_number: 1 },
      }),
    },
  ];

  for (const scenario of invalidReviewedTargetRuns) {
    assert.equal(resolveReviewedTargetLink(scenario.run), null, scenario.name);
  }
});

test("review finding issue links are restricted to canonical github issue urls", () => {
  assert.equal(
    resolveReviewFindingIssueLink("https://github.com/acme/widgets/issues/77"),
    "https://github.com/acme/widgets/issues/77"
  );
  assert.equal(
    resolveReviewFindingIssueLink(
      "https://github.com/acme/widgets/issues/77?utm_source=test"
    ),
    "https://github.com/acme/widgets/issues/77"
  );
  assert.equal(
    resolveReviewFindingIssueLink(
      "https://github.com/acme/widgets/issues/not-a-number"
    ),
    null
  );
  assert.equal(
    resolveReviewFindingIssueLink("https://example.com/acme/widgets/issues/77"),
    null
  );
  assert.equal(
    resolveReviewFindingIssueLink("https://github.com/acme/widgets/pull/77"),
    null
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

test("collectRunEditDiffs extracts updateFile commits from run tool calls", () => {
  const patch = [
    "diff --git a/src/widget.ts b/src/widget.ts",
    "index 1111111..2222222 100644",
    "--- a/src/widget.ts",
    "+++ b/src/widget.ts",
    "@@ -1 +1 @@",
    "-export const value = 1",
    "+export const value = 2",
  ].join("\n");

  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: [
            {
              name: "updateFile",
              input: { path: "src/widget.ts" },
              output: {
                success: true,
                path: "src/widget.ts",
                branch: "fix/widgets",
                commitSha: "abcdef1234567890",
                commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
                patch,
              },
            },
          ],
        },
      },
    ],
    ai_calls: [
      {
        id: "call-1",
        model: "minimax/minimax-m2.7",
        tool_calls: [
          {
            name: "updateFile",
            input: { path: "src/widget.ts" },
            output: {
              success: true,
              path: "src/widget.ts",
              commitSha: "abcdef1234567890",
              commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
            },
          },
          {
            name: "reportFix",
            input: { applied: true },
            output: { applied: true },
          },
        ],
      },
    ],
  } as unknown as FlowRunDetail;

  assert.deepEqual(collectRunEditDiffs(run), [
    {
      id: "abcdef1234567890",
      sourceLabel: "Fixer",
      path: "src/widget.ts",
      branch: "fix/widgets",
      commitSha: "abcdef1234567890",
      commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
      patch,
    },
  ]);
});

test("collectRunEditDiffs ignores incomplete updateFile calls", () => {
  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: [
            {
              name: "updateFile",
              input: { path: "src/pending.ts" },
            },
            {
              name: "updateFile",
              input: { path: "src/failed.ts" },
              output: {
                success: false,
                path: "src/failed.ts",
                commitSha: "failed123",
              },
            },
            {
              name: "updateFile",
              input: { path: "src/degraded.ts" },
              output: {
                path: "src/degraded.ts",
                commitSha: "degraded123",
              },
            },
          ],
        },
      },
    ],
    ai_calls: [],
  } as unknown as FlowRunDetail;

  assert.deepEqual(collectRunEditDiffs(run), [
    {
      id: "degraded123",
      sourceLabel: "Fixer",
      path: "src/degraded.ts",
      branch: null,
      commitSha: "degraded123",
      commitUrl: null,
      patch: null,
    },
  ]);
});

test("collectRunEditDiffs caps large edit lists", () => {
  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: Array.from(
            { length: MAX_RUN_EDIT_DIFFS + 2 },
            (_, index) => ({
              name: "updateFile",
              input: { path: `src/file-${index}.ts` },
              output: {
                success: true,
                path: `src/file-${index}.ts`,
                commitSha: `commit-${index}`,
              },
            })
          ),
        },
      },
    ],
    ai_calls: [],
  } as unknown as FlowRunDetail;

  const edits = collectRunEditDiffs(run);
  assert.equal(edits.length, MAX_RUN_EDIT_DIFFS);
  assert.equal(edits.at(-1)?.commitSha, `commit-${MAX_RUN_EDIT_DIFFS - 1}`);
});
