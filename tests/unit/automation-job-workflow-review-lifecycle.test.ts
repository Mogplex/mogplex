import assert from "node:assert/strict";
import test from "node:test";
import {
  findingMarker,
  parsePrReviewState,
  serializePrReviewState,
} from "../../lib/workflows/pr-review-history";
import { createPrReviewSigner } from "../../lib/workflows/pr-review-signing";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

const signer = createPrReviewSigner("test-secret", {
  repoFullName: "acme/widgets",
  prNumber: 44,
});

const previousState = {
  sha: "0ldhead44",
  reviewedAt: "2026-11-09T10:00:00.000Z",
  findings: [
    {
      key: "aaaaaaaaaaaa",
      severity: "warning" as const,
      title: "Guard nullable widget lookup",
      path: "src/widget.ts",
      line: 14,
      inline: true,
    },
    {
      key: "bbbbbbbbbbbb",
      severity: "warning" as const,
      title: "Close the file handle",
      path: "src/io.ts",
      line: 8,
      inline: true,
    },
  ],
};

const thread = (key: string, path: string, line: number) => ({
  id: `thread-${key}`,
  isResolved: false,
  path,
  line,
  url: `https://github.com/acme/widgets/pull/44#discussion_${key}`,
  comments: [
    {
      author: "mogplex",
      body: `**Warning:** finding\n\nBody.\n\n${findingMarker(key, signer)}`,
      createdAt: "2026-11-09T10:00:00Z",
    },
    {
      author: "dev",
      body: "The lookup is guarded by the caller.",
      createdAt: "2026-11-09T10:30:00Z",
    },
  ],
});

async function runReReview(options: { newerReviewMeanwhile?: boolean } = {}) {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const reviewInputs: Array<{ comments: Array<{ body: string }> }> = [];
  const summaryBodies: string[] = [];
  const resolvedThreads: Array<{ threadId: string; body: string }> = [];
  let promptHistory: unknown = null;
  let summaryReads = 0;
  let metadata: Record<string, unknown> | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { pr_number: 44, head_sha: "newhead44" },
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
      new Map([
        ["src/widget.ts", [14, 15]],
        ["src/cache.ts", [3]],
      ]),
    reviewThreads: {
      readPrReviewTimelineComments: async () => {
        summaryReads += 1;
        const comments = [
          {
            body: `<!-- mogplex-pr-review -->\nOld review\n${serializePrReviewState(previousState, signer)}`,
            author: "mogplex[bot]",
          },
        ];
        if (options.newerReviewMeanwhile && summaryReads > 1) {
          // Another run read the PR after this one and published first.
          comments.push({
            body: `<!-- mogplex-pr-review -->\nNewer review\n${serializePrReviewState(
              { ...previousState, reviewedAt: "2999-01-01T00:00:00.000Z" },
              signer
            )}`,
            author: "mogplex[bot]",
          });
        }
        return comments;
      },
      listPrReviewThreads: async () => [
        thread("aaaaaaaaaaaa", "src/widget.ts", 14),
        thread("bbbbbbbbbbbb", "src/io.ts", 8),
      ],
      comparePrCommits: async () => ({
        status: "ahead",
        files: ["src/widget.ts", "src/cache.ts", "src/io.ts"],
        complete: true,
      }),
      listPrConversationComments: async () => [],
      replyAndResolvePrReviewThread: async (input) => {
        resolvedThreads.push({ threadId: input.threadId, body: input.body });
      },
      signingSecret: () => "test-secret",
    },
    upsertPrReviewTimelineComment: async (input) => {
      summaryBodies.push(input.body);
      return {
        id: 544,
        htmlUrl: "https://github.com/acme/widgets/pull/44#issuecomment-544",
        created: false,
      };
    },
    listPrReviewComments: async () =>
      (reviewInputs[0]?.comments ?? []).map((comment, index) => ({
        body: comment.body,
        htmlUrl: `https://github.com/acme/widgets/pull/44#discussion_r${index}`,
      })),
    createPrReviewGithubReview: async (input) => {
      reviewInputs.push({ comments: input.comments ?? [] });
      return {
        id: 445,
        htmlUrl:
          "https://github.com/acme/widgets/pull/44#pullrequestreview-445",
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async (context) => {
      promptHistory = context.metadata.pr_review_history_block;
      return {
        text: "Re-reviewed.",
        usage: { inputTokens: 9, outputTokens: 12 },
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "reportReview",
                input: {
                  hasIssues: true,
                  summary: "One earlier finding stands; one new one.",
                  affectedFiles: ["src/widget.ts", "src/cache.ts"],
                  findings: [
                    {
                      severity: "warning",
                      title: "Guard nullable widget lookup (still open)",
                      body: "The caller guard does not cover the retry path.",
                      path: "src/widget.ts",
                      line: 15,
                      priorId: "F1",
                    },
                    {
                      severity: "suggestion",
                      title: "Cache key ignores locale",
                      body: "Two locales share one entry.",
                      path: "src/cache.ts",
                      line: 3,
                    },
                  ],
                },
              },
            ],
            toolResults: [{ hasIssues: true, summary: "Re-reviewed." }],
          }),
        ],
      };
    },
    getDurationMs: async () => 55,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings: persisted }) =>
      makePersistedReviewFindingsResult(persisted.length),
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async (input) => {
      metadata = input.metadata ?? null;
    },
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-pr-rereview-lifecycle",
    startedAt: "2026-11-09T12:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-rereview-lifecycle",
      repoId: "repo-123",
      installationId: 123,
    },
  });
  return {
    result,
    reviewInputs,
    summaryBodies,
    resolvedThreads,
    promptHistory,
    metadata: metadata as Record<string, unknown> | null,
  };
}

test("a re-review sees the earlier findings and the author's replies in its prompt", async () => {
  const { promptHistory } = await runReReview();

  assert.equal(typeof promptHistory, "string");
  assert.match(String(promptHistory), /^<previous_review>/);
  assert.match(
    String(promptHistory),
    /- F1 \(warning, open thread\) `src\/widget\.ts:14`/
  );
  assert.match(
    String(promptHistory),
    /> The lookup is guarded by the caller\./
  );
  assert.match(String(promptHistory), /- `src\/cache\.ts`/);
});

test("a re-review keeps the thread of a finding it reports again and posts only the new one", async () => {
  const { result, reviewInputs, summaryBodies } = await runReReview();

  assert.equal(result.success, true);
  assert.equal(reviewInputs.length, 1);
  assert.equal(reviewInputs[0].comments.length, 1);
  assert.match(reviewInputs[0].comments[0].body, /Cache key ignores locale/);
  assert.match(
    reviewInputs[0].comments[0].body,
    /<!-- mogplex-finding:[a-f0-9]{12}\.[A-Za-z0-9_-]{22} -->$/
  );
  assert.match(
    summaryBodies[0],
    /Guard nullable widget lookup \(still open\).*\(https:\/\/github\.com\/acme\/widgets\/pull\/44#discussion_aaaaaaaaaaaa\)\n {2}The caller guard does not cover the retry path\./
  );
  // A finding posted in this run links to its own comment and keeps its
  // body there only.
  assert.match(
    summaryBodies[0],
    /Cache key ignores locale.*\(https:\/\/github\.com\/acme\/widgets\/pull\/44#discussion_r0\)/
  );
  assert.doesNotMatch(summaryBodies[0], /Two locales share one entry/);
});

test("a re-review resolves the thread of a finding it no longer reports and records the new state", async () => {
  const { resolvedThreads, summaryBodies, metadata } = await runReReview();

  assert.deepEqual(resolvedThreads, [
    {
      threadId: "thread-bbbbbbbbbbbb",
      body: "<!-- mogplex-reply -->\nNo longer reported at `newhead`.",
    },
  ]);
  assert.equal(metadata?.review_threads_resolved, 1);
  assert.match(summaryBodies[0], /Resolved since the last review/);
  assert.match(summaryBodies[0], /Close the file handle/);
  const state = parsePrReviewState(summaryBodies[0], signer);
  assert.equal(state?.sha, "newhead44");
  assert.deepEqual(
    state?.findings.map((finding) => finding.key)[0],
    "aaaaaaaaaaaa"
  );
});

test("a re-review publishes only its check run when a newer review published meanwhile", async () => {
  const { result, reviewInputs, summaryBodies, resolvedThreads, metadata } =
    await runReReview({ newerReviewMeanwhile: true });

  assert.equal(result.success, true);
  assert.equal(reviewInputs.length, 0);
  assert.equal(summaryBodies.length, 0);
  assert.equal(resolvedThreads.length, 0);
  assert.equal(metadata?.review_outcome, "PR_REVIEW_SUPERSEDED_BY_REVIEW");
});
