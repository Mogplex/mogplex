import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask includes flow autofix commit diffs in PR review output", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  let checkRunText: string | null = null;
  let githubReviewBody: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 144,
          head_sha: "beaded43",
          head_ref: "feat/fix-widget",
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
        flowId: "flow-144",
        flowVersionId: "flow-version-144",
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
              id: "review-1",
              type: "agent",
              position: { x: 240, y: 0 },
              data: {
                label: "PR Review Agent",
                agentId: "agent-review",
                role: "review",
                autofix: false,
                modelOverride: "openai/gpt-5.4",
              },
            },
            {
              id: "edit-1",
              type: "agent",
              position: { x: 480, y: 0 },
              data: {
                label: "PR Fix Agent",
                agentId: "agent-fix",
                role: "edit",
                autofix: true,
                modelOverride: "openai/gpt-5.4",
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
              id: "edge-start-review",
              source: "start-1",
              target: "review-1",
            },
            {
              id: "edge-review-edit",
              source: "review-1",
              target: "edit-1",
            },
            {
              id: "edge-edit-end",
              source: "edit-1",
              target: "end-1",
            },
          ],
        },
        agentsById: new Map([
          [
            "agent-review",
            {
              id: "agent-review",
              name: "PR Review Agent",
              slug: "pr-review-agent",
              model: "openai/gpt-5.4",
              system_prompt: null,
              max_steps: null,
              timeout_ms: null,
            },
          ],
          [
            "agent-fix",
            {
              id: "agent-fix",
              name: "PR Fix Agent",
              slug: "pr-fix-agent",
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
      text: "Reviewer found one issue.",
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
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "Guard the nullable widget lookup.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable widget lookup",
                    body: "The widget can be undefined here.",
                    path: "src/widget.ts",
                    line: 14,
                  },
                ],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    loadPullRequestDetails: async () => ({
      number: 144,
      title: "Fix widget",
      body: null,
      headRef: "feat/fix-widget",
      headSha: "beaded43",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    resolveAutofixTargetRepo: async () => ({
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: 123,
    }),
    resolveAutofixGithubToken: async () => "autofix-token",
    runPRFixAgent: async () => ({
      text: "Applied a safe fix.",
      usage: {
        inputTokens: 4,
        outputTokens: 5,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "updateFile",
              input: {
                path: "src/widget.ts",
                message: "Fix nullable widget lookup",
              },
            },
            {
              toolName: "reportFix",
              input: {
                applied: true,
                summary: "Added the missing nullable guard.",
                updatedFiles: ["src/widget.ts"],
              },
            },
          ],
          toolResults: [
            {
              success: true,
              branch: "feat/fix-widget",
              path: "src/widget.ts",
              commitSha: "abcdef1234567890",
              commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
            },
            {
              applied: true,
              summary: "Added the missing nullable guard.",
            },
          ],
        }),
      ],
    }),
    createPrReviewCheckRun: async () => ({
      id: 144,
      htmlUrl: "https://github.com/acme/widgets/runs/144",
    }),
    completePrReviewCheckRun: async (input) => {
      checkRunText = input.text ?? null;
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/144",
      };
    },
    createPrReviewGithubReview: async (input) => {
      githubReviewBody = input.body;
      return {
        id: 1444,
        htmlUrl:
          "https://github.com/acme/widgets/pull/144#pullrequestreview-1444",
      };
    },
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    getDurationMs: async () => 444,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
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
        return Response.json({ id: "node-run-updated" }, { status: 200 });
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
      jobRunId: "job-flow-pr-review-autofix",
      startedAt: "2026-04-12T23:20:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-144",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.equal(result.success, true);
    assert.match(checkRunText ?? "", /Autofix Applied/);
    assert.match(checkRunText ?? "", /Commit diffs:/);
    assert.match(
      checkRunText ?? "",
      /\[abcdef1\]\(https:\/\/github\.com\/acme\/widgets\/commit\/abcdef1\)/
    );
    assert.match(githubReviewBody ?? "", /Autofix Applied/);
    assert.match(githubReviewBody ?? "", /`src\/widget\.ts`/);
    assert.match(
      githubReviewBody ?? "",
      /\[abcdef1\]\(https:\/\/github\.com\/acme\/widgets\/commit\/abcdef1\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
