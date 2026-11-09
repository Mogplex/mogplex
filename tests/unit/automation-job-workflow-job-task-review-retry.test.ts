import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

type ReviewInput = {
  body: string;
  comments: Array<{ path: string; body: string; line: number }>;
};

const findings = [
  {
    severity: "warning",
    title: "Guard nullable widget lookup",
    body: "The widget can be undefined here.",
    path: "src/widget.ts",
    line: 14,
  },
  {
    severity: "suggestion",
    title: "Document the retry path",
    body: "Explain why the fallback is safe.",
    path: "src/untouched.ts",
    line: 3,
  },
];

async function runReview(options: { reviewFails: boolean }) {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const githubReviewInputs: ReviewInput[] = [];
  const summaryBodies: string[] = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { pr_number: 44, head_sha: "beaded44" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
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
    loadPullRequestChangedLines: async () =>
      new Map([["src/widget.ts", [20, 21, 22]]]),
    upsertPrReviewTimelineComment: async (input) => {
      summaryBodies.push(input.body);
      return {
        id: 544,
        htmlUrl: "https://github.com/acme/widgets/pull/44#issuecomment-544",
        created: true,
      };
    },
    createPrReviewGithubReview: async (input) => {
      githubReviewInputs.push({
        body: input.body,
        comments: input.comments ?? [],
      });
      if (options.reviewFails) {
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
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: { inputTokens: 9, outputTokens: 12 },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                affectedFiles: ["src/widget.ts"],
                findings,
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
    persistJobReviewFindings: async ({ findings: persisted }) =>
      makePersistedReviewFindingsResult(persisted.length),
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
    jobRunId: "job-pr-inline-anchor",
    startedAt: "2026-03-27T00:06:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-inline-anchor",
      repoId: "repo-123",
      installationId: 123,
    },
  });
  return {
    result,
    githubReviewInputs,
    summaryBodies,
    metadata: (controlDispatchEvent as CapturedControlDispatchEvent | null)
      ?.metadata,
  };
}

test("createAutomationJobTask anchors findings to the diff and keeps the rest in the summary comment", async () => {
  const { result, githubReviewInputs, summaryBodies, metadata } =
    await runReview({ reviewFails: false });

  assert.equal(result.success, true);
  assert.equal(githubReviewInputs.length, 1);
  assert.deepEqual(githubReviewInputs[0].comments, [
    {
      path: "src/widget.ts",
      line: 20,
      body: [
        "**Warning:** Guard nullable widget lookup",
        "_About line 14, which this diff does not show._",
        "The widget can be undefined here.",
      ].join("\n\n"),
    },
  ]);
  assert.doesNotMatch(githubReviewInputs[0].body, /Document the retry path/);
  assert.equal(summaryBodies.length, 1);
  assert.match(
    summaryBodies[0],
    /- \*\*Guard nullable widget lookup\*\* \(`src\/widget\.ts:L14`\): \[inline comment\]\(https:\/\/github\.com\/acme\/widgets\/pull\/44#pullrequestreview-444\)/
  );
  assert.doesNotMatch(summaryBodies[0], /The widget can be undefined here/);
  assert.match(summaryBodies[0], /Explain why the fallback is safe\./);
  assert.equal(metadata?.review_github_inline_comments_count, 1);
  assert.equal(metadata?.review_timeline_comment_posted, true);
});

test("createAutomationJobTask puts every finding in the summary comment when the review cannot publish", async () => {
  const { result, githubReviewInputs, summaryBodies, metadata } =
    await runReview({ reviewFails: true });

  assert.equal(result.success, true);
  assert.equal(githubReviewInputs.length, 1);
  assert.match(summaryBodies[0], /The widget can be undefined here\./);
  assert.match(summaryBodies[0], /Explain why the fallback is safe\./);
  assert.doesNotMatch(summaryBodies[0], /inline comment/);
  assert.equal(metadata?.review_github_review_posted, false);
  assert.equal(metadata?.review_github_inline_comments_count, 0);
});
