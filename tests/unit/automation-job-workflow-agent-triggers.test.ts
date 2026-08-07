import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedGenerateTextOptions,
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";

test("createAutomationAgentRunner gives labeled PR triggers the PR review toolset", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;
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
      metadata: {
        pr_number: 55,
        issue_number: 55,
        issue_title: "Add widgets",
        is_pr: true,
        label_name: "ready-for-review",
        sender_login: "octocat",
        head_ref: "feature/test",
      },
      assignmentType: "labeled",
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

  assert.ok(options);
  const captured = options as CapturedGenerateTextOptions;
  assert.ok(
    captured.prompt?.includes(
      'The "ready-for-review" label was added to PR #55'
    )
  );
  assert.ok(captured.prompt?.includes("@octocat"));
  const toolNames = Object.keys(captured.tools as Record<string, unknown>);
  assert.ok(toolNames.includes("getPullRequest"));
  assert.ok(toolNames.includes("reportReview"));
  assert.ok(toolNames.includes("postComment"));
});

test("createAutomationAgentRunner gives labeled issue triggers the issue toolset", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
      return {
        text: "triaged",
        steps: [makeStep({ text: "triaged", inputTokens: 2, outputTokens: 1 })],
        totalUsage: {
          inputTokens: 2,
          outputTokens: 1,
        },
      } as never;
    },
  });

  await runAutomationAgent(
    {
      metadata: {
        issue_number: 9,
        issue_title: "Bug report",
        is_pr: false,
        label_name: "needs-triage",
        sender_login: "octocat",
      },
      assignmentType: "labeled",
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

  assert.ok(options);
  const captured = options as CapturedGenerateTextOptions;
  assert.ok(
    captured.prompt?.includes('The "needs-triage" label was added to issue #9')
  );
  const toolNames = Object.keys(captured.tools as Record<string, unknown>);
  assert.ok(toolNames.includes("fetchIssue"));
  assert.ok(toolNames.includes("addLabels"));
  assert.ok(toolNames.includes("postIssueComment"));
});

test("createAutomationAgentRunner gives tag_push triggers the tag toolset", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
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
  });

  await runAutomationAgent(
    {
      metadata: {
        tag_name: "v2.0.0",
        head_sha: "commitsha",
        compare_url: "https://github.com/acme/widgets/compare/v1...v2",
        sender_login: "octocat",
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

  assert.ok(options);
  const captured = options as CapturedGenerateTextOptions;
  assert.ok(captured.prompt?.includes('Tag "v2.0.0" was pushed by @octocat'));
  const toolNames = Object.keys(captured.tools as Record<string, unknown>);
  assert.ok(toolNames.includes("listFiles"));
  assert.ok(toolNames.includes("fetchFile"));
  assert.ok(toolNames.includes("postCommitComment"));
  assert.ok(toolNames.includes("createIssue"));
  // PR-thread tools must not leak into tag runs — postComment on prNumber 0
  // posts to /issues/0/comments, which GitHub rejects.
  assert.ok(!toolNames.includes("postComment"));
  assert.ok(!toolNames.includes("getPullRequest"));
});

test("createAutomationAgentRunner treats a webhook prompt as the agent task", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
      return {
        text: "processed",
        steps: [
          makeStep({ text: "processed", inputTokens: 2, outputTokens: 1 }),
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
      metadata: {
        webhook: {
          prompt: "Summarize release risk",
          release: "1.2.3",
        },
      },
      assignmentType: "webhook",
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

  assert.ok(options);
  const captured = options as CapturedGenerateTextOptions;
  assert.ok(captured.prompt?.startsWith("Summarize release risk"));
  assert.match(captured.prompt ?? "", /Webhook payload:/);
  assert.match(captured.prompt ?? "", /"release":"1.2.3"/);
});

test("createAutomationAgentRunner exposes createRevertPr only for opted-in ci_failure runs", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  const capturedToolNames: string[][] = [];
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      capturedToolNames.push(
        Object.keys((input as { tools?: Record<string, unknown> }).tools ?? {})
      );
      return {
        text: "analyzed",
        steps: [
          makeStep({ text: "analyzed", inputTokens: 2, outputTokens: 1 }),
        ],
        totalUsage: {
          inputTokens: 2,
          outputTokens: 1,
        },
      } as never;
    },
  });

  const baseContext = {
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
  };

  await runAutomationAgent(
    {
      ...baseContext,
      assignmentType: "ci_failure",
      metadata: {
        check_name: "build",
        head_sha: "badc0ffee",
        flow_auto_revert: true,
      },
    },
    "github-token"
  );
  await runAutomationAgent(
    {
      ...baseContext,
      assignmentType: "ci_failure",
      metadata: {
        check_name: "build",
        head_sha: "badc0ffee",
      },
    },
    "github-token"
  );

  assert.equal(capturedToolNames.length, 2);
  assert.ok(capturedToolNames[0]?.includes("createRevertPr"));
  assert.ok(!capturedToolNames[1]?.includes("createRevertPr"));
});

test("createAutomationAgentRunner targets the failing branch, not the repo default, for revert PRs", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  const capturedTools: Array<Record<string, unknown>> = [];
  const runAutomationAgent = createAutomationAgentRunner({
    generateText: async (input) => {
      capturedTools.push(
        (input as { tools?: Record<string, unknown> }).tools ?? {}
      );
      return {
        text: "analyzed",
        steps: [
          makeStep({ text: "analyzed", inputTokens: 2, outputTokens: 1 }),
        ],
        totalUsage: {
          inputTokens: 2,
          outputTokens: 1,
        },
      } as never;
    },
  });

  const baseContext = {
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
  };

  await runAutomationAgent(
    {
      ...baseContext,
      assignmentType: "ci_failure",
      metadata: {
        check_name: "build",
        head_sha: "badc0ffee",
        head_branch: "release/2.x",
        flow_auto_revert: true,
      },
    },
    "github-token"
  );
  await runAutomationAgent(
    {
      ...baseContext,
      assignmentType: "ci_failure",
      metadata: {
        check_name: "build",
        head_sha: "badc0ffee",
        flow_auto_revert: true,
      },
    },
    "github-token"
  );

  // Execute each captured createRevertPr against a recording fetch: the
  // first request is the idempotency lookup, whose `base` param is the
  // branch the revert PR will target.
  const lookupBase = async (tools: Record<string, unknown> | undefined) => {
    const createRevertPr = tools?.createRevertPr as
      | { execute: (input: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    assert.ok(createRevertPr, "createRevertPr tool missing");
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(typeof input === "string" ? input : input.toString());
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;
    try {
      await createRevertPr.execute({ reason: "r" });
    } finally {
      globalThis.fetch = originalFetch;
    }
    return new URL(urls[0] ?? "https://invalid.test").searchParams.get("base");
  };

  assert.equal(await lookupBase(capturedTools[0]), "release/2.x");
  // Without head_branch metadata the revert falls back to the repo default.
  assert.equal(await lookupBase(capturedTools[1]), "main");
});
