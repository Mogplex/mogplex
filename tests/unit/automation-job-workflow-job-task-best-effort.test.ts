import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask does not fail when GitHub review publishing is best-effort only", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 19,
          head_sha: "abc999",
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
      id: 19,
      htmlUrl: "https://github.com/acme/widgets/runs/19",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/19",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 119,
      htmlUrl: "https://github.com/acme/widgets/pull/19#issuecomment-119",
      created: true,
    }),
    createPrReviewGithubReview: async () => {
      throw new Error("secondary rate limit");
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 11,
        outputTokens: 14,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "The query needs a null guard.",
                affectedFiles: ["src/query.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable query access",
                    body: "This call can throw when the query record is missing.",
                    path: "src/query.ts",
                    line: 54,
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
    getDurationMs: async () => 41,
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
    jobRunId: "job-pr-best-effort-review",
    startedAt: "2026-03-27T00:12:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-best-effort-review",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/query.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 119,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/19#issuecomment-119",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: "secondary rate limit",
      review_github_inline_comments_count: 1,
      review_check_run_id: 19,
      review_check_run_url: "https://github.com/acme/widgets/runs/19",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});
