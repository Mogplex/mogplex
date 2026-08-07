import assert from "node:assert/strict";
import test from "node:test";
import { AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS } from "../../lib/workflows/automation-model-execution";
import {
  loadAutomationJobWorkflowModule,
  mockGithubPullRequestFetch,
} from "./helpers/automation-job-fixtures";

test("resolveFlowAgentNodeRole defaults invalid roles to review", async () => {
  const { resolveFlowAgentNodeRole } = await loadAutomationJobWorkflowModule();

  assert.equal(
    resolveFlowAgentNodeRole({
      id: "agent-1",
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        label: "Reviewer",
        agentId: "agent-1",
        role: "edit",
        modelOverride: "openai/gpt-5.4",
      },
    }),
    "edit"
  );

  assert.equal(
    resolveFlowAgentNodeRole({
      id: "agent-2",
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        label: "Legacy reviewer",
        agentId: "agent-2",
        role: "bad-role" as never,
        modelOverride: "openai/gpt-5.4",
      },
    }),
    "review"
  );
});

test("PR review merge requests require an explicit no-issues verdict", async () => {
  const { getPrReviewAutoMergeBlockReason } =
    await loadAutomationJobWorkflowModule();

  assert.equal(
    getPrReviewAutoMergeBlockReason({
      reviewOutcome: { hasIssues: false },
      requestedPrNumber: 42,
      reviewedPrNumber: 42,
    }),
    null
  );
  assert.equal(
    getPrReviewAutoMergeBlockReason({
      reviewOutcome: { hasIssues: true },
      requestedPrNumber: 42,
      reviewedPrNumber: 42,
    }),
    "Mogplex review reported issues"
  );
  assert.equal(
    getPrReviewAutoMergeBlockReason({
      reviewOutcome: null,
      requestedPrNumber: 42,
      reviewedPrNumber: 42,
    }),
    "Mogplex review did not produce a no-issues verdict"
  );
  assert.equal(
    getPrReviewAutoMergeBlockReason({
      reviewOutcome: { hasIssues: false },
      requestedPrNumber: 43,
      reviewedPrNumber: 42,
    }),
    "Safe merge target does not match the reviewed pull request"
  );
});

test("safe merge requests pin the triggering pull request head", async () => {
  const { getAutoMergeHeadBlockReason, resolveAutoMergeExpectedHeadSha } =
    await loadAutomationJobWorkflowModule();
  const metadata = {
    pr_number: 42,
    head_sha: " reviewed-head ",
  };

  assert.equal(resolveAutoMergeExpectedHeadSha(metadata, 42), "reviewed-head");
  assert.equal(resolveAutoMergeExpectedHeadSha(metadata, 43), null);
  assert.equal(resolveAutoMergeExpectedHeadSha({ pr_number: 42 }, 42), null);
  assert.equal(getAutoMergeHeadBlockReason(metadata, 42), null);
  assert.equal(
    getAutoMergeHeadBlockReason({ issue_number: 42, is_pr: true }, 42),
    "Triggering pull request head SHA is unavailable"
  );
  assert.equal(
    getAutoMergeHeadBlockReason(
      { issue_number: 42, is_pr: true },
      42,
      "workflow-authored-head"
    ),
    null
  );
  assert.equal(
    getAutoMergeHeadBlockReason({ issue_number: 42, is_pr: true }, 43),
    null
  );
});

test("comment-triggered flow context resolves missing and workflow-edited pull request heads", async () => {
  const { hydrateFlowPullRequestHeadContext } =
    await loadAutomationJobWorkflowModule();
  let loadInput: Record<string, unknown> | null = null;

  const context = await hydrateFlowPullRequestHeadContext({
    context: {
      metadata: {
        issue_number: 42,
        issue_title: "Review this",
        is_pr: true,
      },
      assignmentType: "mention",
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
    githubToken: "github-token",
    loadPullRequestDetails: async (input) => {
      loadInput = input;
      return {
        number: 42,
        title: "Review this",
        body: null,
        headRef: "feature/comment-flow",
        headSha: "comment-head",
        headRepoFullName: "acme/widgets",
        baseRef: "main",
        baseSha: "base-head",
        baseRepoFullName: "acme/widgets",
      };
    },
  });

  assert.deepEqual(loadInput, {
    repoFullName: "acme/widgets",
    prNumber: 42,
    githubToken: "github-token",
    fallbackHeadRef: null,
    fallbackHeadSha: null,
    fallbackHeadRepoFullName: null,
    fallbackBaseRef: null,
    fallbackBaseSha: null,
    fallbackBaseRepoFullName: null,
  });
  assert.equal(context.metadata.pr_number, 42);
  assert.equal(context.metadata.head_ref, "feature/comment-flow");
  assert.equal(context.metadata.head_sha, "comment-head");
  assert.equal(context.metadata.head_repo_full_name, "acme/widgets");
  assert.equal(context.metadata.base_ref, "main");
  assert.equal(context.metadata.base_sha, "base-head");
  assert.equal(context.metadata.base_repo_full_name, "acme/widgets");

  const refreshed = await hydrateFlowPullRequestHeadContext({
    context: {
      ...context,
      metadata: {
        ...context.metadata,
        head_sha: "pre-edit-head",
      },
    },
    githubToken: "github-token",
    loadPullRequestDetails: async () => ({
      number: 42,
      title: "Review this",
      body: null,
      headRef: "feature/comment-flow",
      headSha: "workflow-authored-head",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "base-head",
      baseRepoFullName: "acme/widgets",
    }),
    refresh: true,
  });
  assert.equal(refreshed.metadata.head_sha, "workflow-authored-head");
});

test("createAutomationAgentRunner does not retry transient failures above the model seam", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const { isAutomationModelExecutionError } =
    await import("../../lib/workflows/automation-model-execution");

  const mockedGithubFetch = mockGithubPullRequestFetch([42]);
  let calls = 0;
  try {
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async () => {
        calls += 1;
        throw Object.assign(
          new Error("Cannot connect to API: Headers Timeout Error"),
          {
            code: "UND_ERR_HEADERS_TIMEOUT",
          }
        );
      },
    });

    await assert.rejects(
      () =>
        runAutomationAgent(
          {
            metadata: { pr_number: 42 },
            assignmentType: "pr_review",
            skillId: null,
            agent: {
              model: "minimax/minimax-m2.5",
              system_prompt: null,
              max_steps: 42,
              timeout_ms: null,
            },
            repo: {
              id: "repo-123",
              user_id: "user-123",
              full_name: "acme/widgets",
              default_branch: "main",
              github_installation_id: 123,
            },
          },
          "github-token"
        ),
      (error: unknown) => {
        assert.equal(calls, 1);
        assert.ok(isAutomationModelExecutionError(error));
        assert.equal(error.failure.classification, "timeout");
        assert.deepEqual(error.metadata, {
          phase: "pr_review",
          requestedModelId: "minimax/minimax-m2.5",
          attempts: 1,
          retryCount: 0,
          retried: false,
          effectiveTimeoutMs: AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
          recoveredFromFailureClass: null,
          recoveredFromMessage: null,
          finalFailureClass: "timeout",
          finalFailureMessage: "Cannot connect to API: Headers Timeout Error",
          finalFailureStatusCode: null,
        });
        return true;
      }
    );
  } finally {
    mockedGithubFetch.restore();
  }
});
