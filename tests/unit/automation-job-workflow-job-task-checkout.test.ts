import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask resolves PR head checkouts when harness review bookkeeping degrades", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  let patchAttempts = 0;
  let loadedPullRequestInput: Record<string, unknown> | null = null;
  let harnessInput: {
    pullRequest?: { headRef: string; headRepoFullName: string } | null;
    targetRepo?: { id: string; full_name: string } | null;
  } | null = null;
  let completedCheckRun: {
    conclusion: string;
    summary: string;
    text: string | null;
  } | null = null;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 143,
          head_sha: "beaded42",
          head_ref: "feat/flow-bookkeeping",
          base_ref: "main",
          head_repo_full_name: "acme/widgets-fork",
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
      flow: {
        flowId: "flow-143",
        flowVersionId: "flow-version-143",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "Start",
                event: "pr_opened",
                isDefault: false,
              },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 240, y: 0 },
              data: {
                label: "PR Review Agent",
                agentId: null,
                harness: "codex",
                role: "review",
                autofix: false,
                modelOverride: "openai/gpt-5.4",
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: {
                label: "End",
              },
            },
          ],
          edges: [
            {
              id: "edge-start-agent",
              source: "start-1",
              target: "agent-1",
            },
            {
              id: "edge-agent-end",
              source: "agent-1",
              target: "end-1",
            },
          ],
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    loadPullRequestDetails: async (input) => {
      loadedPullRequestInput = input;
      return {
        number: 143,
        title: "Harness review",
        body: null,
        headRef: "feat/flow-bookkeeping",
        headSha: "beaded42",
        headRepoFullName: "acme/widgets-fork",
        baseRef: "main",
        baseSha: "base42",
        baseRepoFullName: "acme/widgets",
      };
    },
    resolveAutofixTargetRepo: async () => ({
      id: "repo-head",
      user_id: "user-123",
      full_name: "acme/widgets-fork",
      default_branch: "main",
      github_installation_id: 456,
    }),
    runAutomationHarnessAgent: async (input) => {
      harnessInput = input;
      return {
        text: "No material issues found.",
        usage: null,
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "reportReview",
                input: {
                  hasIssues: false,
                  summary: "No material issues found.",
                  commentBody: "No material issues found.",
                  affectedFiles: [],
                  findings: [],
                },
              },
            ],
            toolResults: [
              { hasIssues: false, summary: "No material issues found." },
            ],
          }),
        ],
      };
    },
    createPrReviewCheckRun: async () => ({
      id: 143,
      htmlUrl: "https://github.com/acme/widgets/runs/143",
    }),
    completePrReviewCheckRun: async (input) => {
      completedCheckRun = {
        conclusion: input.conclusion,
        summary: input.summary,
        text: input.text ?? null,
      };
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/143",
      };
    },
    upsertPrReviewTimelineComment: async () => ({
      id: 5143,
      htmlUrl: "https://github.com/acme/widgets/pull/143#issuecomment-5143",
      created: true,
    }),
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async () => makePersistedReviewFindingsResult(0),
    getDurationMs: async () => 444,
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

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (!requestUrl.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${requestUrl}`);
    }

    if (requestUrl.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: "2026-04-12T23:20:00.000Z",
          },
          { status: 201 }
        );
      }

      if (method === "PATCH") {
        patchAttempts += 1;
        return new Response(
          [
            "<title>testprojectref000000.supabase.co | 522: Connection timed out</title>",
            "Connection timed out Error code 522",
            "Cloudflare Ray ID: 9f09ee74a6bba3be",
          ].join("\n"),
          {
            status: 522,
            headers: {
              "content-type": "text/html",
            },
          }
        );
      }
    }

    if (requestUrl.includes("/rest/v1/job_runs")) {
      return Response.json(
        {
          status: "running",
          cancel_requested_at: null,
          cancelled_at: null,
        },
        { status: 200 }
      );
    }

    throw new Error(`Unhandled fetch in test: ${method} ${requestUrl}`);
  };

  try {
    const result = await workflow({
      jobRunId: "job-flow-pr-review-bookkeeping",
      startedAt: "2026-04-12T23:20:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-143",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.deepEqual(result, {
      success: true,
      output: "No material issues found.",
      observabilityError:
        "Flow node run bookkeeping degraded while updating: Supabase unavailable",
    });
    assert.equal(patchAttempts, 6);
    assert.deepEqual(completedCheckRun, {
      conclusion: "success",
      summary: "No material issues found.",
      text: "No material issues found.",
    });
    assert.deepEqual(controlDispatchEvent, {
      outcome: "completed",
      reason: "PR_REVIEW_NO_FINDINGS",
      metadata: {
        review_outcome: "PR_REVIEW_NO_FINDINGS",
        review_outcome_label: "No findings",
        review_summary: "No material issues found.",
        review_has_issues: false,
        review_affected_files: [],
        review_comment_posted: false,
        review_timeline_comment_posted: true,
        review_timeline_comment_id: 5143,
        review_timeline_comment_url:
          "https://github.com/acme/widgets/pull/143#issuecomment-5143",
        review_timeline_comment_error: null,
        review_github_review_posted: false,
        review_github_review_id: null,
        review_github_review_url: null,
        review_github_review_error: null,
        review_github_inline_comments_count: 0,
        review_check_run_id: 143,
        review_check_run_url: "https://github.com/acme/widgets/runs/143",
        review_check_run_completed: true,
        review_check_run_conclusion: "success",
        review_check_run_error: null,
        review_findings_count: 0,
        review_findings_persisted: true,
        review_findings_persist_error: null,
      },
    });
    assert.deepEqual(loadedPullRequestInput, {
      repoFullName: "acme/widgets",
      prNumber: 143,
      githubToken: "github-token",
      fallbackHeadRef: "feat/flow-bookkeeping",
      fallbackHeadSha: "beaded42",
      fallbackHeadRepoFullName: "acme/widgets-fork",
      fallbackBaseRef: "main",
      fallbackBaseSha: null,
      fallbackBaseRepoFullName: "acme/widgets",
    });
    const capturedHarnessInput = harnessInput as {
      pullRequest?: { headRef: string; headRepoFullName: string } | null;
      targetRepo?: { id: string; full_name: string } | null;
    } | null;
    assert.equal(
      capturedHarnessInput?.pullRequest?.headRef,
      "feat/flow-bookkeeping"
    );
    assert.equal(
      capturedHarnessInput?.pullRequest?.headRepoFullName,
      "acme/widgets-fork"
    );
    assert.equal(capturedHarnessInput?.targetRepo?.id, "repo-head");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
