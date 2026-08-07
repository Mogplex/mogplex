import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask retries GitHub review publishing without inline comments when anchors are invalid", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const githubReviewInputs: Array<{
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  }> = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 44,
          head_sha: "beaded44",
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
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 44,
      htmlUrl: "https://github.com/acme/widgets/runs/44",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/44",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 544,
      htmlUrl: "https://github.com/acme/widgets/pull/44#issuecomment-544",
      created: true,
    }),
    createPrReviewGithubReview: async (input) => {
      githubReviewInputs.push({
        body: input.body,
        comments: input.comments ?? [],
      });

      if (githubReviewInputs.length === 1) {
        throw new Error(
          "GitHub PR review publish failed (422): line must be part of the diff"
        );
      }

      return {
        id: 444,
        htmlUrl:
          "https://github.com/acme/widgets/pull/44#pullrequestreview-444",
      };
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
        inputTokens: 9,
        outputTokens: 12,
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
    getDurationMs: async () => 55,
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
    jobRunId: "job-pr-inline-anchor-retry",
    startedAt: "2026-03-27T00:06:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-inline-anchor-retry",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(githubReviewInputs, [
    {
      body: [
        "## Mogplex PR Review",
        "",
        "**Status:** Attention needed",
        "",
        "Reviewer found one issue.",
        "",
        "1 finding was added inline.",
        "",
        "[View check run](https://github.com/acme/widgets/runs/44)",
      ].join("\n"),
      comments: [
        {
          path: "src/widget.ts",
          line: 14,
          body: "**Warning:** Guard nullable widget lookup\n\nThe widget can be undefined here.",
        },
      ],
    },
    {
      body: [
        "## Mogplex PR Review",
        "",
        "**Status:** Attention needed",
        "",
        "Reviewer found one issue.",
        "",
        "Warnings",
        "- Guard nullable widget lookup (src/widget.ts:L14)",
        "  The widget can be undefined here.",
        "",
        "[View check run](https://github.com/acme/widgets/runs/44)",
      ].join("\n"),
      comments: [],
    },
  ]);
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
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 444,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/44#pullrequestreview-444",
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 44,
      review_check_run_url: "https://github.com/acme/widgets/runs/44",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});
