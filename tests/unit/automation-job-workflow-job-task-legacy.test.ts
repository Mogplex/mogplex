import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedAiCallInput,
  type CapturedControlDispatchEvent,
  type CapturedPersistedReviewFindingsInput,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask keeps legacy PR reviews review-only by default", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let successInput: {
    jobRunId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
  } | null = null;
  let aiCallInput: CapturedAiCallInput | null = null;
  let fixerInvocations = 0;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let persistedReviewFindingsInput: CapturedPersistedReviewFindingsInput | null =
    null;
  let createdCheckRun = false;
  let completedCheckRun: {
    conclusion: string;
    summary: string;
  } | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewInput: {
    prNumber: number;
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  } | null = null;
  let clearedTimelineComment = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 42,
          head_sha: "abc123",
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
    createPrReviewCheckRun: async () => {
      createdCheckRun = true;
      return {
        id: 91,
        htmlUrl: "https://github.com/acme/widgets/runs/91",
      };
    },
    completePrReviewCheckRun: async (input) => {
      completedCheckRun = {
        conclusion: input.conclusion,
        summary: input.summary,
      };
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/91",
      };
    },
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 501,
        htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-501",
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
        id: 44,
        htmlUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-44",
      };
    },
    clearPrReviewTimelineComment: async () => {
      clearedTimelineComment = true;
      return {
        deleted: true,
        id: 501,
        htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-501",
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => ({
      number: 42,
      title: "Reviewed PR",
      body: null,
      headRef: "feature/reviewed-pr",
      headSha: "abc123",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    resolveAutofixTargetRepo: async () => {
      throw new Error(
        "resolveAutofixTargetRepo should not be called without autofix opt-in"
      );
    },
    resolveAutofixGithubToken: async () => {
      throw new Error(
        "resolveAutofixGithubToken should not be called without autofix opt-in"
      );
    },
    runAutomationAgent: async () => ({
      text: "Reviewer found two issues.",
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
                summary: "Reviewer found two issues.",
                commentBody: "Two issues need fixes.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable lookup",
                    body: "This property access can throw on undefined input.",
                    path: " src/widget.ts ",
                    line: 18,
                  },
                  {
                    severity: "suggestion",
                    title: "Trim the fallback branch",
                    body: "The fallback branch can return early for clarity.",
                    path: "src/widget.ts",
                    line: 27,
                  },
                ],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found two issues." },
          ],
        }),
      ],
    }),
    runPRFixAgent: async () => {
      fixerInvocations += 1;
      return {
        text: "Applied a safe follow-up fix directly to the PR branch.",
        usage: {
          inputTokens: 5,
          outputTokens: 8,
        },
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "updateFile",
                input: {
                  path: "src/widget.ts",
                  message: "Fix reviewer findings",
                },
              },
              {
                toolName: "reportFix",
                input: {
                  applied: true,
                  summary: "Patched src/widget.ts",
                  updatedFiles: ["src/widget.ts"],
                },
              },
            ],
            toolResults: [
              { success: true },
              { applied: true, summary: "Patched src/widget.ts" },
            ],
          }),
        ],
      };
    },
    getDurationMs: async () => 222,
    persistJobSuccess: async (input) => {
      successInput = input;
      return true;
    },
    persistJobReviewFindings: async (input) => {
      persistedReviewFindingsInput = input;
      return makePersistedReviewFindingsResult(input.findings.length);
    },
    tryLogAiCall: async (input) => {
      aiCallInput = {
        status: input.status,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        durationMs: input.durationMs,
        toolCalls: input.toolCalls?.map((toolCall) => ({
          name: toolCall.name,
        })),
      };
      return null;
    },
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
    jobRunId: "job-pr-123",
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
    output: "Reviewer found two issues.",
    observabilityError: null,
  });
  assert.equal(fixerInvocations, 0);
  assert.deepEqual(successInput, {
    jobRunId: "job-pr-123",
    inputTokens: 13,
    outputTokens: 21,
    durationMs: 222,
  });
  assert.deepEqual(persistedReviewFindingsInput, {
    userId: "user-123",
    jobRunId: "job-pr-123",
    repoId: "repo-123",
    repoFullName: "acme/widgets",
    prNumber: 42,
    headSha: "abc123",
    findings: [
      {
        severity: "warning",
        title: "Guard nullable lookup",
        body: "This property access can throw on undefined input.",
        path: "src/widget.ts",
        line: 18,
      },
      {
        severity: "suggestion",
        title: "Trim the fallback branch",
        body: "The fallback branch can return early for clarity.",
        path: "src/widget.ts",
        line: 27,
      },
    ],
  });
  assert.ok(aiCallInput);
  const capturedAiCallInput = aiCallInput as unknown as CapturedAiCallInput;
  assert.equal(capturedAiCallInput.status, "success");
  assert.equal(capturedAiCallInput.inputTokens, 13);
  assert.equal(capturedAiCallInput.outputTokens, 21);
  assert.equal(createdCheckRun, true);
  assert.equal(clearedTimelineComment, true);
  assert.deepEqual(completedCheckRun, {
    conclusion: "neutral",
    summary: "Reviewer found two issues.",
  });
  assert.equal(timelineCommentInput, null);
  assert.deepEqual(githubReviewInput, {
    prNumber: 42,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Reviewer found two issues.",
      "",
      "2 findings were added inline.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/91)",
    ].join("\n"),
    comments: [
      {
        path: "src/widget.ts",
        line: 18,
        body: "**Warning:** Guard nullable lookup\n\nThis property access can throw on undefined input.",
      },
      {
        path: "src/widget.ts",
        line: 27,
        body: "**Suggestion:** Trim the fallback branch\n\nThe fallback branch can return early for clarity.",
      },
    ],
  });
  assert.deepEqual(
    capturedAiCallInput.toolCalls?.map((toolCall) => toolCall.name),
    ["reportReview"]
  );
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found two issues.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 44,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/42#pullrequestreview-44",
      review_github_review_error: null,
      review_github_inline_comments_count: 2,
      review_check_run_id: 91,
      review_check_run_url: "https://github.com/acme/widgets/runs/91",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 2,
      review_findings_persist_error: null,
    },
  });
});
