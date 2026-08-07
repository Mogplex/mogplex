import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";

test("createAutomationAgentRunner gates tool calls behind approval when the flow node opted in", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  const createdWaits: Array<Record<string, unknown>> = [];
  let toolOutput: unknown = null;
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      const tools = (input as { tools: Record<string, { execute: unknown }> })
        .tools;
      const fetchFile = tools.fetchFile.execute as (
        toolInput: unknown,
        options: unknown
      ) => Promise<unknown>;
      // Deny path: the wrapped tool must return a denial without ever
      // reaching the real GitHub-backed execute (which would hit the network).
      toolOutput = await fetchFile(
        { path: "README.md" },
        { toolCallId: "call-1", messages: [] }
      );
      return {
        text: "inspected",
        steps: [
          makeStep({ text: "inspected", inputTokens: 2, outputTokens: 1 }),
        ],
        totalUsage: {
          inputTokens: 2,
          outputTokens: 1,
        },
      } as never;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "token-1" }),
      waitForToken: async () =>
        ({
          ok: true,
          output: { decision: "deny", note: "not this file" },
        }) as never,
    },
    waitStore: {
      createWait: async (input) => {
        createdWaits.push(input as unknown as Record<string, unknown>);
        return { id: "wait-1" };
      },
      finalizeWait: async () => {},
    },
    loadApprovalSpentWaitMs: async () => 0,
  });

  await runAutomationAgent(
    {
      metadata: {
        tag_name: "v2.0.0",
        head_sha: "commitsha",
        compare_url: "https://github.com/acme/widgets/compare/v1...v2",
        sender_login: "octocat",
        flow_require_approval: true,
        flow_job_run_id: "job-run-1",
        flow_id: "flow-1",
        flow_version_id: "flow-version-1",
        flow_node_id: "node-1",
        flow_node_label: "Release notes",
      },
      assignmentType: "tag_push",
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

  assert.equal(createdWaits.length, 1);
  assert.equal(createdWaits[0].waitKind, "tool_approval");
  assert.equal(createdWaits[0].jobRunId, "job-run-1");
  assert.equal(createdWaits[0].userId, "user-123");
  const waitConfig = createdWaits[0].waitConfig as Record<string, unknown>;
  assert.equal(waitConfig.toolName, "fetchFile");
  assert.equal(waitConfig.nodeLabel, "Release notes");
  const denial = toolOutput as Record<string, unknown>;
  assert.equal(denial.approved, false);
  assert.equal(denial.denied_by_operator, true);
  assert.match(String(denial.message), /not this file/);
});

test("the approval wait budget spans the review and fix loops of one node run", async () => {
  const { createAutomationAgentRunner, createPRFixAgentRunner } =
    await loadAutomationJobWorkflowModule();

  // The budget is derived from persisted wait rows keyed by job run + node.
  // This durable "table" is shared by both runner instances — which also
  // models process replacement between the loops, since neither runner holds
  // any in-memory budget state.
  const waitRows: Array<{ createdAtMs: number; expiresAtMs: number }> = [];
  const loadApprovalSpentWaitMs = async () =>
    waitRows.reduce(
      (total, row) => total + Math.max(0, row.expiresAtMs - row.createdAtMs),
      0
    );

  const flowMetadata = {
    flow_require_approval: true,
    flow_job_run_id: "job-run-shared-budget",
    flow_id: "flow-1",
    flow_version_id: "flow-version-1",
    flow_node_id: "node-1",
    flow_node_label: "Review",
  };
  const agent = {
    model: "openai/gpt-5.4",
    system_prompt: null,
  };
  const repo = {
    id: "repo-123",
    user_id: "user-123",
    full_name: "acme/widgets",
    default_branch: "main",
    github_installation_id: 123,
  };
  const generateTextResult = {
    text: "done",
    steps: [makeStep({ text: "done", inputTokens: 2, outputTokens: 1 })],
    totalUsage: {
      inputTokens: 2,
      outputTokens: 1,
    },
  } as never;

  // Review loop: the single approval wait goes unanswered, which exhausts the
  // node's entire budget.
  const reviewWaits: unknown[] = [];
  let reviewDenial: Record<string, unknown> | null = null;
  const runReview = createAutomationAgentRunner({
    generateText: async (input) => {
      const tools = (input as { tools: Record<string, { execute: unknown }> })
        .tools;
      const fetchFile = tools.fetchFile.execute as (
        toolInput: unknown,
        options: unknown
      ) => Promise<Record<string, unknown>>;
      reviewDenial = await fetchFile(
        { path: "README.md" },
        { toolCallId: "call-1", messages: [] }
      );
      return generateTextResult;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "token-1" }),
      waitForToken: async () =>
        ({ ok: false, reason: "timeout", message: "unanswered" }) as never,
    },
    waitStore: {
      createWait: async (input) => {
        reviewWaits.push(input);
        waitRows.push({
          createdAtMs: Date.now(),
          expiresAtMs:
            (
              input as unknown as { expiresAt: Date | null }
            ).expiresAt?.getTime() ?? Date.now(),
        });
        return { id: "wait-1" };
      },
      finalizeWait: async () => {},
    },
    loadApprovalSpentWaitMs,
  });

  await runReview(
    {
      metadata: {
        tag_name: "v2.0.0",
        head_sha: "commitsha",
        sender_login: "octocat",
        ...flowMetadata,
      },
      assignmentType: "tag_push",
      skillId: null,
      agent,
      repo,
    },
    "github-token"
  );

  assert.equal(reviewWaits.length, 1);
  assert.equal(
    (reviewDenial as Record<string, unknown> | null)?.reason,
    "timeout"
  );

  // Fix loop for the same node run: no fresh 10-minute window. The gate must
  // deny immediately without ever touching the wait infrastructure.
  let fixDenial: Record<string, unknown> | null = null;
  const runFix = createPRFixAgentRunner({
    generateText: async (input) => {
      const tools = (input as { tools: Record<string, { execute: unknown }> })
        .tools;
      const updateFile = tools.updateFile.execute as (
        toolInput: unknown,
        options: unknown
      ) => Promise<Record<string, unknown>>;
      fixDenial = await updateFile(
        { path: "src/index.ts", content: "fixed" },
        { toolCallId: "call-2", messages: [] }
      );
      return generateTextResult;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => {
        throw new Error(
          "must not create a wait token once the budget is spent"
        );
      },
      waitForToken: async () => {
        throw new Error("must not wait once the budget is spent");
      },
    },
    waitStore: {
      createWait: async () => {
        throw new Error("must not persist a wait once the budget is spent");
      },
      finalizeWait: async () => {},
    },
    loadApprovalSpentWaitMs,
  });

  await runFix(
    {
      context: {
        metadata: { ...flowMetadata },
        assignmentType: "pr_review",
        skillId: null,
        agent,
        repo,
      },
      review: {
        hasIssues: true,
        summary: "issues found",
        commentBody: null,
        affectedFiles: [],
        findings: [],
      },
      pullRequest: {
        number: 7,
        title: "Fix things",
        body: null,
        headRef: "feature-branch",
        headSha: "headsha",
        headRepoFullName: "acme/widgets",
        baseRef: "main",
        baseSha: null,
        baseRepoFullName: "acme/widgets",
      },
      targetRepo: repo,
    },
    "github-token"
  );

  const denial = fixDenial as Record<string, unknown> | null;
  assert.equal(denial?.approved, false);
  assert.equal(denial?.reason, "budget_exhausted");
});
