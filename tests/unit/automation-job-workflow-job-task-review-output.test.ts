import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask falls back to a timeline comment when reportReview is missing", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 17,
          head_sha: "legacy17",
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
      id: 17,
      htmlUrl: "https://github.com/acme/widgets/runs/17",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/17",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 117,
        htmlUrl: "https://github.com/acme/widgets/pull/17#issuecomment-117",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      throw new Error(
        "createPrReviewGithubReview should not be called without structured review output"
      );
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 7,
        outputTokens: 10,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "postComment",
              input: {
                body: "Guard the nullable widget lookup.",
              },
            },
          ],
          toolResults: [{ success: true }],
        }),
      ],
    }),
    getDurationMs: async () => 73,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
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
  });

  const result = await workflow({
    jobRunId: "job-pr-legacy-review-fallback",
    startedAt: "2026-03-27T00:07:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-legacy-review-fallback",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(timelineCommentInput, {
    prNumber: 17,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Note: Structured review output was missing, so Mogplex used the legacy review comment as fallback output.",
      "",
      "Guard the nullable widget lookup.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/17)",
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
      review_affected_files: [],
      review_comment_posted: true,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 117,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/17#issuecomment-117",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_verdict: "blocking",
      review_check_run_id: 17,
      review_check_run_url: "https://github.com/acme/widgets/runs/17",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask publishes a report without structured findings as the summary comment only", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewInput: {
    prNumber: number;
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 18,
          head_sha: "fedcba",
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
      id: 18,
      htmlUrl: "https://github.com/acme/widgets/runs/18",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/18",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 118,
        htmlUrl: "https://github.com/acme/widgets/pull/18#issuecomment-118",
        created: true,
      };
    },
    createPrReviewGithubReview: async (input) => {
      githubReviewInput = {
        prNumber: input.prNumber,
        body: input.body,
        comments: input.comments ?? [],
      };
      return {
        id: 418,
        htmlUrl:
          "https://github.com/acme/widgets/pull/18#pullrequestreview-418",
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 6,
        outputTokens: 9,
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
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    getDurationMs: async () => 88,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
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
  });

  const result = await workflow({
    jobRunId: "job-pr-check-only",
    startedAt: "2026-03-27T00:08:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-check-only",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  // Nothing can sit on the diff, so there is no native review; the summary
  // comment is the whole review.
  assert.equal(githubReviewInput, null);
  assert.deepEqual(timelineCommentInput, {
    prNumber: 18,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Reviewer found one issue.",
      "",
      "The query needs a null guard.",
      "",
      "**Affected files**",
      "- `src/query.ts`",
      "",
      "[View check run](https://github.com/acme/widgets/runs/18)",
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
      review_affected_files: ["src/query.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 118,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/18#issuecomment-118",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_verdict: "blocking",
      review_check_run_id: 18,
      review_check_run_url: "https://github.com/acme/widgets/runs/18",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});
