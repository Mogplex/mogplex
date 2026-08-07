import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedAiCallInput,
  type CapturedControlDispatchEvent,
  type CapturedGenerateTextOptions,
  loadAutomationJobWorkflowModule,
  makeStep,
  mockGithubPullRequestFetch,
} from "./helpers/automation-job-fixtures";

test("extractFlowReviewOutcome ignores triage tokens and merges review payloads", async () => {
  const { extractFlowReviewOutcome } = await loadAutomationJobWorkflowModule();

  const review = extractFlowReviewOutcome([
    {
      fromNodeId: "triage",
      label: "Triage",
      text: "This is contextual analysis, not a code review.",
      skipped: false,
      payload: {
        role: "triage",
      },
    },
    {
      fromNodeId: "review-a",
      label: "Review A",
      text: "A",
      skipped: false,
      payload: {
        role: "review",
        review: {
          hasIssues: false,
          summary: "No issues in auth flow.",
          commentBody: null,
          affectedFiles: ["src/auth.ts"],
          findings: [],
        },
      },
    },
    {
      fromNodeId: "review-b",
      label: "Review B",
      text: "B",
      skipped: false,
      payload: {
        role: "review",
        review: {
          hasIssues: true,
          summary: "Found a race condition in preview bootstrap.",
          commentBody: "Please guard preview activation.",
          affectedFiles: ["src/preview.ts", "src/auth.ts"],
          findings: [
            {
              severity: "warning",
              title: "Guard preview activation",
              body: "The preview bootstrap can race without a null guard.",
              path: "src/preview.ts",
              line: 42,
            },
          ],
        },
      },
    },
  ]);

  assert.deepEqual(review, {
    hasIssues: true,
    summary:
      "No issues in auth flow.\n\nFound a race condition in preview bootstrap.",
    commentBody: "Please guard preview activation.",
    affectedFiles: ["src/auth.ts", "src/preview.ts"],
    findings: [
      {
        severity: "warning",
        title: "Guard preview activation",
        body: "The preview bootstrap can race without a null guard.",
        path: "src/preview.ts",
        line: 42,
      },
    ],
  });

  const noReview = extractFlowReviewOutcome([
    {
      fromNodeId: "triage-only",
      label: "Triage",
      text: "General notes only.",
      skipped: false,
      payload: {
        role: "triage",
      },
    },
  ]);

  assert.equal(noReview, null);
});

test("createAutomationJobTask fails standalone fix nodes for non-comment trigger flows instead of silently skipping", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  const nodeUpdates: Array<Record<string, unknown>> = [];
  let modelCalled = false;
  let failure: { jobRunId: string; error: string; durationMs: number } | null =
    null;
  const controlDispatchEvents: CapturedControlDispatchEvent[] = [];
  const aiCallInputs: CapturedAiCallInput[] = [];
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 48,
          pr_url: "https://github.com/acme/widgets/pull/48",
          pr_title: "Delete transport paths",
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
        flowId: "flow-pr-opened",
        flowVersionId: "flow-version-pr-opened",
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "PR opened",
                event: "pr_opened",
                isDefault: true,
              },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 240, y: 0 },
              data: {
                label: "NEXTJS-REVIEWER",
                agentId: "agent-base-1",
                role: "edit",
                autofix: false,
                modelOverride: "openai/gpt-5.4",
              },
            },
            {
              id: "end",
              type: "end",
              position: { x: 480, y: 0 },
              data: {
                label: "Done",
              },
            },
          ],
          edges: [
            { id: "edge-start-agent", source: "start", target: "agent-1" },
            { id: "edge-agent-end", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map([
          [
            "agent-base-1",
            {
              id: "agent-base-1",
              name: "NEXTJS-REVIEWER",
              slug: "nextjs-reviewer",
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
    runAutomationAgent: async () => {
      modelCalled = true;
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 123,
    persistJobFailure: async (input) => {
      failure = input;
      return true;
    },
    tryLogAiCall: async (input) => {
      aiCallInputs.push(input);
      return null;
    },
    recordControlDispatchEvent: async (input) => {
      controlDispatchEvents.push({
        outcome: input.outcome,
        reason: input.reason,
        metadata: input.metadata,
      });
    },
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (requestUrl.startsWith("https://example.supabase.co")) {
      if (requestUrl.includes("/rest/v1/flow_node_runs")) {
        if (method === "POST") {
          nodeRunSequence += 1;
          return Response.json(
            {
              id: `node-run-${nodeRunSequence}`,
              started_at: "2026-04-29T00:13:23.000Z",
            },
            { status: 201 }
          );
        }

        if (method === "PATCH") {
          const body =
            typeof init?.body === "string" ? JSON.parse(init.body) : {};
          nodeUpdates.push(body);
          return Response.json({ id: "node-run-updated" }, { status: 200 });
        }
      }

      return Response.json([], { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${method} ${requestUrl}`);
  };

  try {
    const result = await workflow({
      jobRunId: "job-mention-standalone-fix",
      startedAt: "2026-04-29T00:13:19.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-pr-opened",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    const expectedError =
      'Fix node "NEXTJS-REVIEWER" must be placed after a Review node, or its flow must start from a pull request comment trigger (@mogplex mention or PR comment).';
    assert.deepEqual(result, {
      success: false,
      error: expectedError,
      observabilityError: null,
    });
    assert.equal(modelCalled, false);
    assert.deepEqual(failure, {
      jobRunId: "job-mention-standalone-fix",
      error: expectedError,
      durationMs: 123,
    });
    assert.equal(released, true);
    assert.equal(controlDispatchEvents[0]?.outcome, "failed");
    assert.equal(controlDispatchEvents[0]?.metadata?.error, expectedError);
    assert.equal(aiCallInputs[0]?.status, "failed");
    assert.equal(aiCallInputs[0]?.inputTokens, null);
    assert.equal(aiCallInputs[0]?.outputTokens, null);
    assert.equal(
      nodeUpdates.some(
        (update) => update.status === "failed" && update.error === expectedError
      ),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationAgentRunner treats pr_opened triggers as PR reviews", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  const mockedGithubFetch = mockGithubPullRequestFetch([130]);
  let options: CapturedGenerateTextOptions | null = null;
  try {
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async (input) => {
        options = input as unknown as CapturedGenerateTextOptions;
        return {
          text: "reviewed",
          steps: [
            makeStep({ text: "reviewed", inputTokens: 2, outputTokens: 1 }),
          ],
          totalUsage: {
            inputTokens: 2,
            outputTokens: 1,
          },
        } as never;
      },
    });

    await runAutomationAgent(
      {
        metadata: { pr_number: 130 },
        assignmentType: "pr_opened",
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
      "github-token"
    );
  } finally {
    mockedGithubFetch.restore();
  }

  assert.ok(options);
  assert.equal(
    (options as CapturedGenerateTextOptions).prompt,
    "Review PR #130."
  );
  const sys = (options as CapturedGenerateTextOptions).system as {
    role: string;
    content: string;
  };
  assert.equal(sys.role, "system");
  assert.ok(
    sys.content.includes("Start by calling getPullRequest and listChangedFiles")
  );
});
