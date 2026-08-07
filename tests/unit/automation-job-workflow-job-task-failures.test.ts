import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask fails PR reviews when a required check run cannot be completed", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  const checkRunConclusions: string[] = [];

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 24,
          head_sha: "cafebabe",
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
      id: 24,
      htmlUrl: "https://github.com/acme/widgets/runs/24",
    }),
    completePrReviewCheckRun: async (input) => {
      checkRunConclusions.push(input.conclusion);
      if (input.conclusion === "neutral") {
        throw new Error("transient completion failure");
      }

      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/24",
      };
    },
    upsertPrReviewTimelineComment: async () => ({
      id: 224,
      htmlUrl: "https://github.com/acme/widgets/pull/24#issuecomment-224",
      created: true,
    }),
    createPrReviewGithubReview: async () => ({
      id: 424,
      htmlUrl: "https://github.com/acme/widgets/pull/24#pullrequestreview-424",
    }),
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
                commentBody: "A null guard is missing.",
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
    getDurationMs: async () => 91,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => true,
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
    jobRunId: "job-pr-check-run-must-complete",
    startedAt: "2026-03-27T00:12:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-check-run-must-complete",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub check run publish failed: transient completion failure",
    observabilityError: null,
  });
  assert.deepEqual(checkRunConclusions, ["neutral", "failure"]);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_CHECK_RUN_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_CHECK_RUN_FAILED",
      review_outcome_label: "Check run failed",
      error: "GitHub check run publish failed: transient completion failure",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 224,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/24#issuecomment-224",
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 424,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/24#pullrequestreview-424",
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 24,
      review_check_run_url: "https://github.com/acme/widgets/runs/24",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
    },
  });
});

test("createAutomationJobTask fails PR reviews when a required fallback timeline comment cannot be published", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  const timelineConclusions: string[] = [];

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: "26",
          head_sha: "feedface",
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
      id: 26,
      htmlUrl: "https://github.com/acme/widgets/runs/26",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/26",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineConclusions.push(
        input.body.includes("**Status:** Review failed") ? "failure" : "neutral"
      );

      if (timelineConclusions.length === 1) {
        throw new Error("timeline write failed");
      }

      return {
        id: 226,
        htmlUrl: "https://github.com/acme/widgets/pull/26#issuecomment-226",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      throw new Error("review unavailable");
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 5,
        outputTokens: 8,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "Guard the nullable lookup.",
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
    getDurationMs: async () => 77,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => true,
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
    jobRunId: "job-pr-timeline-comment-must-complete",
    startedAt: "2026-03-27T00:14:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-timeline-comment-must-complete",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub timeline comment publish failed: timeline write failed",
    observabilityError: null,
  });
  assert.deepEqual(timelineConclusions, ["neutral", "failure"]);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_TIMELINE_COMMENT_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_TIMELINE_COMMENT_FAILED",
      review_outcome_label: "Timeline comment failed",
      error: "GitHub timeline comment publish failed: timeline write failed",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 226,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/26#issuecomment-226",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: "review unavailable",
      review_github_inline_comments_count: 0,
      review_check_run_id: 26,
      review_check_run_url: "https://github.com/acme/widgets/runs/26",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
    },
  });
});
