import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask records comment post failures for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 45,
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
    upsertPrReviewTimelineComment: async () => ({
      id: 245,
      htmlUrl: "https://github.com/acme/widgets/pull/45#issuecomment-245",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error("GitHub comment post failed (403): permission denied");
    },
    getDurationMs: async () => 40,
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
    jobRunId: "job-pr-comment-post-failed",
    startedAt: "2026-03-27T00:16:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-comment-post-failed",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub comment post failed (403): permission denied",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_COMMENT_POST_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_COMMENT_POST_FAILED",
      review_outcome_label: "Comment post failed",
      error: "GitHub comment post failed (403): permission denied",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 245,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/45#issuecomment-245",
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
    },
  });
});

test("createAutomationJobTask treats a lost success persistence race as cancellation", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let aiCallLogged = false;
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { issue_number: 8 },
        assignmentType: "issue_comment",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
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
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "done",
      usage: {
        inputTokens: 3,
        outputTokens: 5,
      },
      steps: [],
    }),
    getDurationMs: async () => 88,
    persistJobSuccess: async () => false,
    tryLogAiCall: async () => {
      aiCallLogged = true;
      return null;
    },
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow({
    jobRunId: "job-cancel-race-success",
    startedAt: "2026-03-27T00:10:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-cancel-race-success",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "JOB_RUN_CANCELLED",
  });
  assert.equal(aiCallLogged, false);
  assert.equal(released, false);
});

test("createAutomationJobTask treats a lost failure persistence race as cancellation", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let aiCallLogged = false;
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { issue_number: 9 },
        assignmentType: "issue_comment",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
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
    resolveGithubToken: async () => null,
    getDurationMs: async () => 55,
    persistJobFailure: async () => false,
    tryLogAiCall: async () => {
      aiCallLogged = true;
      return null;
    },
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow({
    jobRunId: "job-cancel-race-failure",
    startedAt: "2026-03-27T00:15:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-cancel-race-failure",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "JOB_RUN_CANCELLED",
  });
  assert.equal(aiCallLogged, false);
  assert.equal(released, false);
});

test("resolvePullRequestNumber falls back to issue_number when is_pr is true", async () => {
  const { resolvePullRequestNumber } = await loadAutomationJobWorkflowModule();

  assert.equal(
    resolvePullRequestNumber({ pr_number: 12, issue_number: 99 }),
    12,
    "pr_number takes precedence when present"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: 76, is_pr: true }),
    76,
    "PR-flagged comment metadata maps issue_number to the PR number"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: 76, is_pr: false }),
    null,
    "issue_number on a non-PR issue does not become a PR number"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: "42", is_pr: true }),
    42,
    "string issue_number is parsed when is_pr is true"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: "not-a-number", is_pr: true }),
    null,
    "non-numeric issue_number is rejected"
  );
});

test("synthesizeReviewOutcomeFromComment converts a comment body into a single-finding review", async () => {
  const { synthesizeReviewOutcomeFromComment } =
    await loadAutomationJobWorkflowModule();

  const review = synthesizeReviewOutcomeFromComment({
    comment_body: "@mogplex please fix the nullable widget guard",
    comment_author: "charlesrhoward",
  });

  assert.deepEqual(review, {
    hasIssues: true,
    summary: "@mogplex please fix the nullable widget guard",
    commentBody: "@mogplex please fix the nullable widget guard",
    affectedFiles: [],
    findings: [],
  });
});

test("synthesizeReviewOutcomeFromComment returns null when the comment body is missing or empty", async () => {
  const { synthesizeReviewOutcomeFromComment } =
    await loadAutomationJobWorkflowModule();

  assert.equal(synthesizeReviewOutcomeFromComment({}), null);
  assert.equal(
    synthesizeReviewOutcomeFromComment({ comment_body: "   " }),
    null
  );
  assert.equal(synthesizeReviewOutcomeFromComment({ comment_body: 42 }), null);
});
