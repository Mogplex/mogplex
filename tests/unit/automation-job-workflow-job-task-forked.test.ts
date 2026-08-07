import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask skips legacy PR autofix for forked pull requests", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let autofixTargetRepo: string | null = null;
  let autofixToken: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 99,
          head_ref: "fix/from-fork",
          head_repo_full_name: "octocat/widgets-fork",
          base_ref: "main",
          base_repo_full_name: "acme/widgets",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-base",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
    }),
    resolveGithubToken: async () => "review-token",
    upsertPrReviewTimelineComment: async () => ({
      id: 601,
      htmlUrl: "https://github.com/acme/widgets-fork/pull/99#issuecomment-601",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => {
      throw new Error(
        "loadPullRequestDetails should not be called without autofix opt-in"
      );
    },
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 10,
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
                affectedFiles: ["src/widget.ts"],
              },
            },
            {
              toolName: "postComment",
              input: {
                body: "Reviewer found one issue.",
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
            { success: true },
          ],
        }),
      ],
    }),
    resolveAutofixTargetRepo: async () => {
      autofixTargetRepo = "unexpected";
      throw new Error(
        "resolveAutofixTargetRepo should not be called without autofix opt-in"
      );
    },
    resolveAutofixGithubToken: async () => {
      autofixToken = "unexpected";
      throw new Error(
        "resolveAutofixGithubToken should not be called without autofix opt-in"
      );
    },
    runPRFixAgent: async (input, githubToken) => {
      autofixTargetRepo = input.targetRepo.full_name;
      autofixToken = githubToken;
      return {
        text: "Applied fix on the fork branch.",
        usage: {
          inputTokens: 4,
          outputTokens: 5,
        },
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "updateFile",
                input: { path: "src/widget.ts", message: "Apply fix" },
              },
            ],
            toolResults: [{ success: true }],
          }),
        ],
      };
    },
    getDurationMs: async () => 100,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-pr-fork",
    startedAt: "2026-03-27T00:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-fork",
      repoId: "repo-base",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(autofixTargetRepo, null);
  assert.equal(autofixToken, null);
});

test("createAutomationJobTask skips the PR fixer when no installation autofix token is available", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let fixerInvoked = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 77,
          head_ref: "fix/no-installation-token",
          head_repo_full_name: "acme/widgets",
          base_ref: "main",
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
          github_installation_id: null,
        },
      },
    }),
    resolveGithubToken: async () => "review-token",
    upsertPrReviewTimelineComment: async () => ({
      id: 602,
      htmlUrl: "https://github.com/acme/widgets/pull/77#issuecomment-602",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => ({
      number: 77,
      title: "Fix without installation token",
      body: null,
      headRef: "fix/no-installation-token",
      headSha: "def456",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
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
              },
            },
            {
              toolName: "postComment",
              input: {
                body: "Reviewer found one issue.",
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
            { success: true },
          ],
        }),
      ],
    }),
    resolveAutofixTargetRepo: async () => ({
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: null,
    }),
    resolveAutofixGithubToken: async () => null,
    runPRFixAgent: async () => {
      fixerInvoked = true;
      throw new Error(
        "runPRFixAgent should not be called without installation auth"
      );
    },
    getDurationMs: async () => 101,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-pr-no-installation-token",
    startedAt: "2026-03-27T00:05:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-installation-token",
      repoId: "repo-123",
      installationId: null,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(fixerInvoked, false);
});

test("createAutomationJobTask records a no-findings control outcome for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let createdCheckRun = false;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 12,
          head_sha: "def456",
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
    createPrReviewCheckRun: async () => {
      createdCheckRun = true;
      return {
        id: 15,
        htmlUrl: "https://github.com/acme/widgets/runs/15",
      };
    },
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/15",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 115,
        htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-115",
        created: true,
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "No issues found.",
      usage: {
        inputTokens: 4,
        outputTokens: 6,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: false,
                summary: "No issues found.",
                affectedFiles: ["src/widget.ts"],
              },
            },
          ],
          toolResults: [{ hasIssues: false, summary: "No issues found." }],
        }),
      ],
    }),
    getDurationMs: async () => 64,
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
    jobRunId: "job-pr-no-findings",
    startedAt: "2026-03-27T00:06:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-findings",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "No issues found.",
    observabilityError: null,
  });
  assert.equal(createdCheckRun, true);
  assert.deepEqual(timelineCommentInput, {
    prNumber: 12,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** No material issues found",
      "",
      "No issues found.",
      "",
      "Affected files:",
      "- src/widget.ts",
      "",
      "[View check run](https://github.com/acme/widgets/runs/15)",
    ].join("\n"),
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_NO_FINDINGS",
    metadata: {
      review_outcome: "PR_REVIEW_NO_FINDINGS",
      review_outcome_label: "No findings",
      review_has_issues: false,
      review_summary: "No issues found.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 115,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/12#issuecomment-115",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 15,
      review_check_run_url: "https://github.com/acme/widgets/runs/15",
      review_check_run_completed: true,
      review_check_run_conclusion: "success",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});
