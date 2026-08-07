import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask skips PR review publishing when the PR head changed", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let completedCheckRun: {
    conclusion: string;
    title: string;
    summary: string;
    text: string | null | undefined;
  } | null = null;
  let githubReviewCalled = false;
  let timelineCommentCalled = false;
  let findingsPersistCalled = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 45,
          head_sha: "old123",
          head_ref: "feature/reviewed-pr",
          base_ref: "main",
          head_repo_full_name: "acme/widgets",
          base_repo_full_name: "acme/widgets",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => ({
      id: 92,
      htmlUrl: "https://github.com/acme/widgets/runs/92",
    }),
    completePrReviewCheckRun: async (input) => {
      completedCheckRun = {
        conclusion: input.conclusion,
        title: input.title,
        summary: input.summary,
        text: input.text,
      };
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/92",
      };
    },
    loadPullRequestDetails: async () => ({
      number: 45,
      title: "Reviewed PR",
      body: null,
      headRef: "feature/reviewed-pr",
      headSha: "new456",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    upsertPrReviewTimelineComment: async () => {
      timelineCommentCalled = true;
      throw new Error("stale PR reviews should not post timeline comments");
    },
    createPrReviewGithubReview: async () => {
      githubReviewCalled = true;
      throw new Error("stale PR reviews should not post native reviews");
    },
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 13,
        outputTokens: 21,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable lookup",
                    body: "This property access can throw on undefined input.",
                    path: "src/widget.ts",
                    line: 18,
                  },
                ],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    resolveAutofixTargetRepo: async () => {
      throw new Error("resolveAutofixTargetRepo should not be called");
    },
    resolveAutofixGithubToken: async () => {
      throw new Error("resolveAutofixGithubToken should not be called");
    },
    runPRFixAgent: async () => {
      throw new Error("runPRFixAgent should not be called");
    },
    getDurationMs: async () => 223,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async () => {
      findingsPersistCalled = true;
      throw new Error("stale PR findings should not be persisted");
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async (input) => {
      controlDispatchEvent = {
        outcome: input.outcome,
        reason: input.reason,
        metadata: input.metadata,
      };
    },
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-pr-stale-head",
    startedAt: "2026-03-26T23:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-123",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(githubReviewCalled, false);
  assert.equal(timelineCommentCalled, false);
  assert.equal(findingsPersistCalled, false);
  assert.deepEqual(completedCheckRun, {
    conclusion: "success",
    title: "Review skipped",
    summary:
      "Mogplex skipped publishing this review because the PR head changed from old123 to new456.",
    text: "Mogplex skipped publishing this review because the PR head changed from old123 to new456.",
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_STALE_HEAD_SHA",
    metadata: {
      review_outcome: "PR_REVIEW_STALE_HEAD_SHA",
      review_outcome_label: "Stale PR head SHA",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 92,
      review_check_run_url: "https://github.com/acme/widgets/runs/92",
      review_check_run_completed: true,
      review_check_run_conclusion: "success",
      review_check_run_error: null,
      review_findings_persisted: false,
      review_findings_count: 0,
      review_findings_persist_error: null,
      review_head_sha: "old123",
      review_current_head_sha: "new456",
      review_stale_head_check_error: null,
    },
  });
});

test("createAutomationJobTask skips native GitHub review publishing when PR head SHA is missing", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewCalled = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 43,
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => {
      throw new Error(
        "createPrReviewCheckRun should not be called without a PR head SHA"
      );
    },
    completePrReviewCheckRun: async () => {
      throw new Error(
        "completePrReviewCheckRun should not be called without a PR head SHA"
      );
    },
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 502,
        htmlUrl: "https://github.com/acme/widgets/pull/43#issuecomment-502",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      githubReviewCalled = true;
      throw new Error(
        "createPrReviewGithubReview should not be called without a PR head SHA"
      );
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 8,
        outputTokens: 11,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "Guard the nullable widget lookup.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable widget lookup",
                    body: "The widget can be undefined here.",
                    path: "src/widget.ts",
                    line: 14,
                  },
                ],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    getDurationMs: async () => 48,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async (input) => {
      controlDispatchEvent = {
        outcome: input.outcome,
        reason: input.reason,
        metadata: input.metadata,
      };
    },
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-pr-no-head-sha",
    startedAt: "2026-03-27T00:05:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-head-sha",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(githubReviewCalled, false);
  assert.deepEqual(timelineCommentInput, {
    prNumber: 43,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      // Structured reports lead with the summary; commentBody would
      // double-report the findings sections below.
      "Reviewer found one issue.",
      "",
      "Affected files:",
      "- src/widget.ts",
      "",
      "Warnings",
      "- Guard nullable widget lookup (src/widget.ts:L14)",
      "  The widget can be undefined here.",
    ].join("\n"),
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 502,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/43#issuecomment-502",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: null,
      review_check_run_url: null,
      review_check_run_completed: false,
      review_check_run_conclusion: null,
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});
