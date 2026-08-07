import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
  makePersistedReviewFindingsResult,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask routes flow autofix through sandbox runner when opted in", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  let directFixerInvocations = 0;
  let sandboxFixerInvocations = 0;

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
          source_type: "pr_opened",
          repo_id: "repo-123",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          id: "agent-review",
          name: "Reviewer",
          slug: "reviewer",
          model: "openai/gpt-5.4",
          system_prompt: null,
          max_steps: null,
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
      flow: {
        flowId: "flow-144",
        flowVersionId: "flow-version-144",
        agentsById: new Map([
          [
            "agent-review",
            {
              id: "agent-review",
              name: "Reviewer",
              slug: "reviewer",
              model: "openai/gpt-5.4",
              system_prompt: null,
              max_steps: null,
              timeout_ms: null,
            },
          ],
        ]),
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "PR opened", event: "pr_opened" },
            },
            {
              id: "review",
              type: "agent",
              position: { x: 200, y: 0 },
              data: {
                label: "Reviewer",
                agentId: "agent-review",
                role: "review",
                autofix: true,
                autofixSandbox: true,
                modelOverride: "openai/gpt-5.4",
              },
            },
            {
              id: "end",
              type: "end",
              position: { x: 400, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "start-review", source: "start", target: "review" },
            { id: "review-end", source: "review", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      runtime: null,
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => ({
      id: 144,
      htmlUrl: "https://github.com/acme/widgets/runs/144",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/144",
    }),
    createPrReviewGithubReview: async () => ({
      id: 1444,
      htmlUrl:
        "https://github.com/acme/widgets/pull/144#pullrequestreview-1444",
    }),
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 501,
      htmlUrl: "https://github.com/acme/widgets/pull/144#issuecomment-501",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
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
                commentBody: "Fix src/widget.ts",
                affectedFiles: ["src/widget.ts"],
                findings: [],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    runPRFixAgent: async () => {
      directFixerInvocations += 1;
      throw new Error("direct fixer should not run");
    },
    runPRFixAgentInSandbox: async () => {
      sandboxFixerInvocations += 1;
      return {
        text: "Applied fix in sandbox.",
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
                  summary: "Patched src/widget.ts in sandbox.",
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
                summary: "Patched src/widget.ts in sandbox.",
              },
            ],
          }),
        ],
      };
    },
    getDurationMs: async () => 444,
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
      jobRunId: "job-flow-pr-review-autofix-sandbox",
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
    assert.equal(directFixerInvocations, 0);
    assert.equal(sandboxFixerInvocations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
