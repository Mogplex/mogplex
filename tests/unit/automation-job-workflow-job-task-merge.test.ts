import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask defers safe merge actions until the review check is completed", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  // Ordered trace of the calls that matter: in repos that require the Mogplex
  // PR Review check, merging before completePrReviewCheckRun can never see
  // mergeable_state "clean", so the merge gate must run strictly after it.
  const events: string[] = [];
  let nodeRunSequence = 0;
  let mergePutBody: Record<string, unknown> | null = null;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 143,
          head_sha: "beaded42",
          head_ref: "feat/auto-merge-ordering",
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
                agentId: "agent-base-1",
                role: "review",
                autofix: false,
                autoMerge: false,
                modelOverride: "openai/gpt-5.4",
              },
            },
            {
              id: "merge-1",
              type: "action",
              position: { x: 480, y: 0 },
              data: {
                label: "Merge when safe",
                operation: "github.merge_pull_request",
                pullRequestNumber: null,
                commitTitle: "Workflow merge",
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
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
              id: "edge-agent-merge",
              source: "agent-1",
              target: "merge-1",
            },
            {
              id: "edge-merge-end",
              source: "merge-1",
              target: "end-1",
            },
          ],
        },
        agentsById: new Map([
          [
            "agent-base-1",
            {
              id: "agent-base-1",
              name: "PR Review Agent",
              slug: "pr-review-agent",
              model: "openai/gpt-5.4",
              system_prompt: null,
              max_steps: null,
              timeout_ms: null,
            },
          ],
        ]),
      },
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "No material issues found.",
      usage: {
        inputTokens: 9,
        outputTokens: 5,
      },
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
    }),
    loadPullRequestDetails: async () => ({
      number: 143,
      title: "feat: auto-merge ordering",
      body: null,
      headRef: "feat/auto-merge-ordering",
      headSha: "beaded42",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: null,
      baseRepoFullName: "acme/widgets",
    }),
    createPrReviewCheckRun: async () => ({
      id: 143,
      htmlUrl: "https://github.com/acme/widgets/runs/143",
    }),
    completePrReviewCheckRun: async (input) => {
      events.push("check_run_completed");
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

    if (
      requestUrl === "https://api.github.com/repos/acme/widgets/pulls/143" &&
      method === "GET"
    ) {
      events.push("merge_gate_read");
      return Response.json({
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        head: { sha: "beaded42" },
      });
    }

    if (
      requestUrl ===
        "https://api.github.com/repos/acme/widgets/pulls/143/merge" &&
      method === "PUT"
    ) {
      events.push("merge_put");
      mergePutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ merged: true, sha: "merge-sha" });
    }

    if (requestUrl.startsWith("https://example.supabase.co")) {
      if (requestUrl.includes("/rest/v1/flow_node_runs")) {
        if (method === "POST") {
          nodeRunSequence += 1;
          return Response.json(
            {
              id: `node-run-${nodeRunSequence}`,
              started_at: "2026-07-06T20:00:00.000Z",
            },
            { status: 201 }
          );
        }
        if (method === "PATCH") {
          return new Response(null, { status: 204 });
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
    }

    throw new Error(`Unhandled fetch in test: ${method} ${requestUrl}`);
  };

  try {
    const result = await workflow({
      jobRunId: "job-flow-auto-merge-ordering",
      startedAt: "2026-07-06T20:00:00.000Z",
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
      observabilityError: null,
    });

    const checkCompletedIndex = events.indexOf("check_run_completed");
    const mergeGateIndex = events.indexOf("merge_gate_read");
    const mergePutIndex = events.indexOf("merge_put");
    assert.ok(checkCompletedIndex !== -1, "review check run must be completed");
    assert.ok(
      mergeGateIndex > checkCompletedIndex,
      `merge gate must be read after the check run completes, got: ${events.join(", ")}`
    );
    assert.ok(
      mergePutIndex > mergeGateIndex,
      "merge must follow the gate read"
    );

    // The merge pins the reviewed head so a race with a later push loses.
    const mergeBody = mergePutBody as Record<string, unknown> | null;
    assert.equal(mergeBody?.sha, "beaded42");
    assert.equal(mergeBody?.merge_method, "squash");
    assert.equal(mergeBody?.commit_title, "Workflow merge");

    assert.ok(controlDispatchEvent);
    const dispatched = controlDispatchEvent as CapturedControlDispatchEvent;
    assert.equal(dispatched.outcome, "completed");
    assert.equal(dispatched.reason, "PR_REVIEW_NO_FINDINGS");
    assert.deepEqual(dispatched.metadata?.auto_merge, {
      merged: true,
      reason: "Merged after clean review",
      sha: "merge-sha",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
