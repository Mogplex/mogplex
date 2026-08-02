import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "undici";
import {
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
} from "../../lib/workflows/automation-model-execution";

type CapturedConstructorOptions = {
  model?: string;
  system?:
    | string
    | { role: string; content: string; providerOptions?: unknown };
  tools?: unknown;
  prompt?: string;
};

type CapturedGenerateTextOptions = {
  model?: string;
  system?:
    | string
    | { role: string; content: string; providerOptions?: unknown };
  tools?: unknown;
  prompt?: string;
  providerOptions?: {
    gateway?: {
      caching?: string;
      tags?: string[];
    };
  };
  stopWhen?: unknown;
  timeout?: number;
  maxRetries?: number;
};

type CapturedAiCallInput = {
  status: "success" | "failed";
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  toolCalls?: Array<{ name: string }>;
};

type CapturedControlDispatchEvent = {
  outcome: "completed" | "failed";
  reason: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
};

type CapturedPersistedReviewFindingsInput = {
  userId: string;
  jobRunId: string;
  repoId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  headSha: string | null;
  findings: Array<{
    severity: "critical" | "warning" | "suggestion";
    title: string;
    body: string;
    path: string | null;
    line: number | null;
  }>;
};

async function loadAutomationJobWorkflowModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/workflows/automation-job-workflow");
}

async function loadAiModelResolverModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/ai-model-resolver");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("automation model generate timeout preserves the full retry budget", () => {
  assert.equal(
    getAutomationGenerateTimeoutMs(null),
    AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
  assert.equal(
    getAutomationGenerateTimeoutMs(30_000),
    AUTOMATION_MODEL_TIMEOUT_FLOOR_MS * 2
  );
  assert.equal(getAutomationGenerateTimeoutMs(360_000), 720_000);
  assert.equal(
    getAutomationGenerateTimeoutMs(30 * 60_000),
    AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
});

test("resolveAutomationAiCallModel records one effective Gateway fallback model", async () => {
  const { resolveAutomationAiCallModel } =
    await loadAutomationJobWorkflowModule();

  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", {
      effectiveModelIds: ["zai/glm-5.2-fast"],
    }),
    "zai/glm-5.2-fast"
  );
  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", {
      effectiveModelIds: ["xai/grok-4.5", "zai/glm-5.2-fast"],
    }),
    "xai/grok-4.5"
  );
  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", null),
    "xai/grok-4.5"
  );
});

test("buildAutofixSandboxInternalApiHeaders carries workflow team scope", async () => {
  const { buildAutofixSandboxInternalApiHeaders } =
    await loadAutomationJobWorkflowModule();
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "internal-secret";
  try {
    assert.deepEqual(
      buildAutofixSandboxInternalApiHeaders({
        metadata: { team_id: " 00000000-0000-4000-8000-000000000123 " },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      }),
      {
        "Content-Type": "application/json",
        Authorization: "Bearer internal-secret",
        "X-Delegated-User-Id": "user-123",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      }
    );
  } finally {
    restoreEnv("INTERNAL_API_SECRET", originalSecret);
  }
});

test("runFlowAction rejects command templates before resolving a sandbox checkout", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let pullRequestLookups = 0;
  let targetRepoLookups = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-template-guard",
      nodeId: "action-template-guard",
      action: {
        label: "Unsafe command",
        operation: "sandbox.run_command",
        command: "git diff {{ metadata.head_ref }}",
        workingDirectory: null,
      },
      context: {
        metadata: { pr_number: 42 },
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
      githubToken: "github-token",
      loadPullRequestDetails: async () => {
        pullRequestLookups += 1;
        throw new Error("sandbox checkout resolution should not run");
      },
      resolveAutofixTargetRepo: async () => {
        targetRepoLookups += 1;
        throw new Error("sandbox target resolution should not run");
      },
    }),
    /Run command cannot use templates in shell commands/
  );
  assert.equal(pullRequestLookups, 0);
  assert.equal(targetRepoLookups, 0);
});

test("runFlowAction executes repository-scoped GitHub action operations", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  const requests: Array<{
    path: string;
    method: string;
    body: Record<string, unknown> | null;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    requests.push({ path: url.pathname, method, body });

    if (url.pathname.endsWith("/comments")) {
      return Response.json({ id: 11, html_url: "https://github.test/comment" });
    }
    if (url.pathname.endsWith("/issues")) {
      return Response.json({ number: 55, html_url: "https://github.test/55" });
    }
    if (url.pathname.endsWith("/labels") && method === "POST") {
      return Response.json([{ name: "ready" }, { name: "needs-review" }]);
    }
    if (url.pathname.includes("/labels/") && method === "DELETE") {
      return Response.json(
        { message: "Label does not exist on this issue" },
        { status: 404 }
      );
    }
    if (url.pathname.includes("/statuses/")) {
      return Response.json({
        id: 22,
        state: "success",
        context: "mogplex/release",
        sha: "a".repeat(40),
      });
    }
    if (url.pathname.endsWith("/reviews")) {
      return Response.json({ id: 33, html_url: "https://github.test/review" });
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url.pathname}`);
  };
  const context = {
    metadata: {
      pr_number: 42,
      issue_number: 42,
      head_sha: "a".repeat(40),
    },
    assignmentType: "pr_review" as const,
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
  const baseInput = {
    jobRunId: "job-github-actions",
    context,
    githubToken: "github-token",
    loadPullRequestDetails: async () => null,
    resolveAutofixTargetRepo: async () => null,
    fetchImpl,
  };

  const comment = await runFlowAction({
    ...baseInput,
    nodeId: "comment",
    action: {
      label: "Comment",
      operation: "github.post_comment",
      targetNumber: null,
      body: "Done",
    },
  });
  const issue = await runFlowAction({
    ...baseInput,
    nodeId: "issue",
    action: {
      label: "Issue",
      operation: "github.create_issue",
      title: "Follow up",
      body: "Investigate",
      labels: ["automation"],
    },
  });
  const labels = await runFlowAction({
    ...baseInput,
    nodeId: "labels",
    action: {
      label: "Labels",
      operation: "github.update_labels",
      targetNumber: null,
      addLabels: ["ready"],
      removeLabels: ["needs-review", "already-absent"],
    },
  });
  const status = await runFlowAction({
    ...baseInput,
    nodeId: "status",
    action: {
      label: "Status",
      operation: "github.set_status",
      commitSha: null,
      state: "success",
      context: "mogplex/release",
      description: "Ready",
      targetUrl: "https://mogplex.dev/runs/1",
    },
  });
  const review = await runFlowAction({
    ...baseInput,
    nodeId: "review",
    action: {
      label: "Review",
      operation: "github.submit_review",
      pullRequestNumber: null,
      event: "APPROVE",
      body: "Looks good",
    },
  });
  await runFlowAction({
    ...baseInput,
    nodeId: "explicit-review",
    action: {
      label: "Review another PR",
      operation: "github.submit_review",
      pullRequestNumber: "99",
      event: "COMMENT",
      body: "Needs a look",
    },
  });
  await runFlowAction({
    ...baseInput,
    nodeId: "explicit-same-review",
    action: {
      label: "Review the triggering PR",
      operation: "github.submit_review",
      pullRequestNumber: "42",
      event: "COMMENT",
      body: "Still pinned",
    },
  });
  const merge = await runFlowAction({
    ...baseInput,
    nodeId: "merge",
    action: {
      label: "Merge",
      operation: "github.merge_pull_request",
      pullRequestNumber: null,
      commitTitle: "Workflow merge",
    },
  });

  assert.match(comment.summary, /#42/);
  assert.equal(comment.output.comment_id, 11);
  assert.match(issue.summary, /#55/);
  assert.deepEqual(labels.output.removed_labels, [
    "needs-review",
    "already-absent",
  ]);
  assert.deepEqual(labels.output.labels, ["ready"]);
  assert.equal(status.output.commit_sha, "a".repeat(40));
  assert.equal(review.output.review_id, 33);
  assert.match(merge.summary, /Requested safe merge.*#42/);
  assert.deepEqual(merge.output, {
    pull_request_number: 42,
    auto_merge_requested: true,
    commit_title: "Workflow merge",
  });
  assert.deepEqual(
    requests.map(({ path, method }) => ({ path, method })),
    [
      {
        path: "/repos/acme/widgets/issues/42/comments",
        method: "POST",
      },
      { path: "/repos/acme/widgets/issues", method: "POST" },
      { path: "/repos/acme/widgets/issues/42/labels", method: "POST" },
      {
        path: "/repos/acme/widgets/issues/42/labels/needs-review",
        method: "DELETE",
      },
      {
        path: `/repos/acme/widgets/statuses/${"a".repeat(40)}`,
        method: "POST",
      },
      { path: "/repos/acme/widgets/pulls/42/reviews", method: "POST" },
      { path: "/repos/acme/widgets/pulls/99/reviews", method: "POST" },
      { path: "/repos/acme/widgets/pulls/42/reviews", method: "POST" },
    ]
  );
  const reviewRequests = requests.filter(({ path }) =>
    path.endsWith("/reviews")
  );
  assert.equal(reviewRequests[0]?.body?.commit_id, "a".repeat(40));
  assert.equal("commit_id" in (reviewRequests[1]?.body ?? {}), false);
  assert.equal(reviewRequests[2]?.body?.commit_id, "a".repeat(40));
});

test("runFlowAction rejects an unresolved safe merge target before queuing", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-merge-blocked",
      nodeId: "merge",
      action: {
        label: "Merge",
        operation: "github.merge_pull_request",
        pullRequestNumber: null,
        commitTitle: null,
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
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
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
    }),
    /could not resolve the triggering pull request number/
  );
});

test("runFlowAction does not hide a missing GitHub label target", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-missing-label-target",
      nodeId: "labels",
      action: {
        label: "Remove label",
        operation: "github.update_labels",
        targetNumber: "404",
        addLabels: [],
        removeLabels: ["needs-review"],
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
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
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({ message: "Not Found" }, { status: 404 });
      },
    }),
    /GitHub issue labels read failed \(404\): Not Found/
  );
  assert.equal(fetchCalls, 1);
});

test("runFlowAction rejects unresolved GitHub targets before mutation", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-missing-target",
      nodeId: "comment",
      action: {
        label: "Comment",
        operation: "github.post_comment",
        targetNumber: null,
        body: "Done",
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
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
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    }),
    /could not resolve the triggering issue or pull request number/
  );
  assert.equal(fetchCalls, 0);
});

test("runFlowAction rejects empty resolved GitHub effects before mutation", async () => {
  const { runFlowAction } = await loadAutomationJobWorkflowModule();
  let fetchCalls = 0;

  await assert.rejects(
    runFlowAction({
      jobRunId: "job-empty-labels",
      nodeId: "labels",
      action: {
        label: "Labels",
        operation: "github.update_labels",
        targetNumber: "42",
        addLabels: [],
        removeLabels: [],
      },
      context: {
        metadata: {},
        assignmentType: "webhook",
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
      loadPullRequestDetails: async () => null,
      resolveAutofixTargetRepo: async () => null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    }),
    /GitHub labels resolved to an empty value/
  );
  assert.equal(fetchCalls, 0);
});

test("resolveSlackTriggerDestination replies in the triggering thread", async () => {
  const { resolveSlackTriggerDestination } =
    await loadAutomationJobWorkflowModule();

  assert.deepEqual(
    resolveSlackTriggerDestination({
      slack: {
        team_id: " T123 ",
        channel_id: " C123 ",
        thread_ts: " 1721000000.000001 ",
        message_ts: "1721000000.000002",
      },
    }),
    {
      teamId: "T123",
      channelId: "C123",
      threadTs: "1721000000.000001",
    }
  );
  assert.deepEqual(
    resolveSlackTriggerDestination({
      slack: {
        team_id: "T123",
        channel_id: "C123",
        message_ts: "1721000000.000002",
      },
    }),
    {
      teamId: "T123",
      channelId: "C123",
      threadTs: "1721000000.000002",
    }
  );
});

test("resolveSlackTriggerDestination requires Slack event context", async () => {
  const { resolveSlackTriggerDestination } =
    await loadAutomationJobWorkflowModule();

  assert.throws(
    () =>
      resolveSlackTriggerDestination({
        slack: {
          team_id: "T123",
          channel_id: "C123",
        },
      }),
    /requires a Slack-triggered workflow event/
  );
});

test("Claude Code review prompts require a structured Mogplex verdict", async () => {
  const { buildAutomationHarnessPrompt } =
    await loadAutomationJobWorkflowModule();

  const prompt = buildAutomationHarnessPrompt({
    harnessId: "claude-code",
    context: {
      metadata: {
        flow_node_role: "review",
        pr_number: 42,
      },
      assignmentType: "pr_review",
      skillId: null,
      agent: {
        model: "harness:claude-code",
        system_prompt: "Focus on correctness.",
      },
      repo: {
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/widgets",
        default_branch: "main",
        github_installation_id: 123,
      },
    },
  });

  assert.match(prompt, /Claude Code running a Mogplex automation/);
  assert.match(prompt, /Inspect only/);
  assert.match(prompt, /MOGPLEX_REVIEW_RESULT:/);
  assert.match(prompt, /Do not edit files, push commits, merge/);
});

test("parseAutomationHarnessReviewResult reads the final structured verdict", async () => {
  const { parseAutomationHarnessReviewResult } =
    await loadAutomationJobWorkflowModule();
  const text = [
    "Inspected the changed files.",
    'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"One correctness issue.","commentBody":null,"affectedFiles":["src/widget.ts"],"findings":[{"severity":"warning","title":"Null case is dropped","body":"Preserve the null result before rendering.","path":"src/widget.ts","line":42}]}',
  ].join("\n");

  assert.deepEqual(parseAutomationHarnessReviewResult(text), {
    hasIssues: true,
    summary: "One correctness issue.",
    commentBody: null,
    affectedFiles: ["src/widget.ts"],
    findings: [
      {
        severity: "warning",
        title: "Null case is dropped",
        body: "Preserve the null result before rendering.",
        path: "src/widget.ts",
        line: 42,
      },
    ],
  });
  assert.equal(
    parseAutomationHarnessReviewResult("Review finished without a verdict."),
    null
  );
  assert.equal(
    parseAutomationHarnessReviewResult(
      'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"Issues found.","findings":[]}'
    ),
    null
  );
  assert.equal(
    parseAutomationHarnessReviewResult(
      'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"Issues found.","findings":[{"severity":"warning"}]}'
    ),
    null
  );
});

function makeStep(input: {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  toolResults?: unknown[];
}) {
  return {
    text: input.text ?? "",
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    toolCalls: input.toolCalls ?? [],
    toolResults: input.toolResults ?? [],
  };
}

function makePersistedReviewFindingsResult(count = 0) {
  return {
    persisted: true as const,
    count,
    error: null,
  };
}

function mockGithubPullRequestFetch(prNumbers: number[]) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = url.match(
      /^https:\/\/api\.github\.com\/repos\/acme\/widgets\/pulls\/(\d+)$/
    );

    if (match) {
      const prNumber = Number(match[1]);
      if (prNumbers.includes(prNumber)) {
        return new Response(
          JSON.stringify({
            number: prNumber,
            title: `PR ${prNumber}`,
            body: null,
            head: {
              ref: "feature/test",
              sha: "abc123",
              repo: { full_name: "acme/widgets" },
            },
            base: {
              ref: "main",
              sha: "def456",
              repo: { full_name: "acme/widgets" },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    throw new Error(`Unexpected fetch during PR access test: ${url}`);
  }) as typeof fetch;

  return {
    mockedFetch: globalThis.fetch,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("createAutomationAgentRunner uses generateText without mutating global fetch", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const mockedGithubFetch = mockGithubPullRequestFetch([42]);
  let options: CapturedGenerateTextOptions | null = null;
  try {
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async (input) => {
        options = input as unknown as CapturedGenerateTextOptions;
        return {
          text: "final answer",
          steps: [
            makeStep({ text: "", inputTokens: 5, outputTokens: 2 }),
            makeStep({ text: "final answer", inputTokens: 7, outputTokens: 3 }),
          ],
          totalUsage: {
            inputTokens: 12,
            outputTokens: 5,
          },
        } as never;
      },
    });

    const result = await runAutomationAgent(
      {
        metadata: { pr_number: 42 },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
          system_prompt: null,
          max_steps: 42,
          timeout_ms: 18000,
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

    assert.equal(globalThis.fetch, mockedGithubFetch.mockedFetch);
    assert.ok(options);
    const capturedOptions = options as unknown as CapturedConstructorOptions;
    assert.equal(capturedOptions.model, "minimax/minimax-m2.5");
    // pr_review now isolates per-call PR data in `prompt` and puts stable
    // instructions in `system` so Anthropic prompt caching can fire (#530).
    // With caching=auto (default) and a non-empty system, the workflow wraps
    // the string in a SystemModelMessage with cacheControl: ephemeral.
    assert.equal(typeof capturedOptions.system, "object");
    const systemMessage = capturedOptions.system as unknown as {
      role: string;
      content: string;
      providerOptions: {
        anthropic: { cacheControl: { type: string } };
      };
    };
    assert.equal(systemMessage.role, "system");
    assert.equal(
      systemMessage.content,
      [
        "Start by calling getPullRequest and listChangedFiles to inspect the actual PR metadata and diff.",
        "Read only the files you need from the PR head branch.",
        "Always call reportReview exactly once before finishing. Mogplex will publish the canonical review result as a GitHub Check plus the best PR surface available from that structured report: a native GitHub review when possible, otherwise a PR timeline comment.",
        "When you find concrete issues, include structured findings with severity, title, body, and the exact file path. If hasIssues=true, you must include at least one structured finding. Add a line number only when the issue maps to a specific changed line in the PR diff.",
        "If there are no material issues, call reportReview with hasIssues=false.",
        "Write summary, commentBody, and finding bodies as plain prose or bullet lists — never markdown headings (#). Mogplex embeds your text under its own '## Mogplex PR Review' heading, so headings you emit would render as top-level section titles.",
        "commentBody is only published when you report no structured findings; use it for the full review narrative in that case. When you include findings, omit commentBody — put everything in summary and the finding bodies.",
      ].join("\n")
    );
    assert.deepEqual(systemMessage.providerOptions.anthropic.cacheControl, {
      type: "ephemeral",
    });
    assert.ok(capturedOptions.tools);
    assert.equal(
      "postComment" in (capturedOptions.tools as Record<string, unknown>),
      false
    );
    assert.equal(
      typeof (options as CapturedGenerateTextOptions).stopWhen,
      "function"
    );
    assert.equal(
      (options as CapturedGenerateTextOptions).timeout,
      getAutomationGenerateTimeoutMs(18000)
    );
    assert.equal((options as CapturedGenerateTextOptions).maxRetries, 0);
    assert.equal(capturedOptions.prompt, "Review PR #42.");
    assert.equal(result.text, "final answer");
    assert.deepEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 5,
    });
    assert.deepEqual(result.execution, {
      phase: "pr_review",
      requestedModelId: "minimax/minimax-m2.5",
      attempts: 1,
      retryCount: 0,
      retried: false,
      effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
      recoveredFromFailureClass: null,
      recoveredFromMessage: null,
      finalFailureClass: null,
      finalFailureMessage: null,
      finalFailureStatusCode: null,
      observedInputTokens: 12,
      observedOutputTokens: 5,
      observedUsage: {
        inputTokens: 12,
        outputTokens: 5,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: null,
        generationIds: [],
      },
    });
  } finally {
    mockedGithubFetch.restore();
  }

  assert.equal(globalThis.fetch, originalFetch);
});

test("pr_review carries agent system_prompt + static instructions on a cacheable system message and isolates per-call data in prompt (issue #530)", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const mockedGithubFetch = mockGithubPullRequestFetch([7, 11]);
  const agentSystemPrompt = "You are a senior code reviewer.";

  type RunCapture = { system: unknown; prompt: unknown };
  const captures: RunCapture[] = [];

  try {
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async (input) => {
        const opts = input as unknown as CapturedGenerateTextOptions;
        captures.push({ system: opts.system, prompt: opts.prompt });
        return {
          text: "ok",
          steps: [makeStep({ text: "ok", inputTokens: 1, outputTokens: 1 })],
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        } as never;
      },
    });

    for (const prNumber of [7, 11]) {
      await runAutomationAgent(
        {
          metadata: {
            pr_number: prNumber,
            flow_previous_outputs: [
              { label: "Lint", output: `Lint summary for PR ${prNumber}` },
            ],
          },
          assignmentType: "pr_review",
          skillId: null,
          agent: {
            model: "anthropic/claude-sonnet-4.6",
            system_prompt: agentSystemPrompt,
            max_steps: 5,
            timeout_ms: 18000,
          },
          repo: {
            id: "repo-1",
            user_id: "user-1",
            full_name: "acme/widgets",
            default_branch: "main",
            github_installation_id: 1,
          },
        },
        "github-token"
      );
    }

    assert.equal(captures.length, 2);

    // System message must be byte-identical across calls (cache prefix stability).
    assert.deepEqual(captures[0].system, captures[1].system);

    const sys = captures[0].system as {
      role: string;
      content: string;
      providerOptions: { anthropic: { cacheControl: { type: string } } };
    };
    assert.equal(sys.role, "system");
    assert.deepEqual(sys.providerOptions.anthropic.cacheControl, {
      type: "ephemeral",
    });
    assert.ok(
      sys.content.startsWith(`${agentSystemPrompt}\n\n`),
      "system content must start with the agent's configured system_prompt"
    );
    assert.ok(
      sys.content.includes(
        "Start by calling getPullRequest and listChangedFiles"
      ),
      "system content must include the static PR review instructions"
    );

    // Per-call prompt must differ between calls and contain the PR number + flow context.
    assert.notEqual(captures[0].prompt, captures[1].prompt);
    assert.ok((captures[0].prompt as string).includes("Review PR #7."));
    assert.ok((captures[1].prompt as string).includes("Review PR #11."));
    assert.ok(
      (captures[0].prompt as string).includes("Upstream flow context:"),
      "flow context block must remain in the per-call prompt"
    );
  } finally {
    mockedGithubFetch.restore();
  }
});

test("pr_review with no agent system_prompt still emits a cacheable system message containing static instructions only", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const mockedGithubFetch = mockGithubPullRequestFetch([99]);

  try {
    let captured: CapturedGenerateTextOptions | null = null;
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async (input) => {
        captured = input as unknown as CapturedGenerateTextOptions;
        return {
          text: "ok",
          steps: [makeStep({ text: "ok", inputTokens: 1, outputTokens: 1 })],
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        } as never;
      },
    });

    await runAutomationAgent(
      {
        metadata: { pr_number: 99 },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "anthropic/claude-sonnet-4.6",
          system_prompt: null,
          max_steps: 5,
          timeout_ms: 18000,
        },
        repo: {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 1,
        },
      },
      "github-token"
    );

    assert.ok(captured);
    const opts = captured as CapturedGenerateTextOptions;
    const sys = opts.system as {
      role: string;
      content: string;
      providerOptions: { anthropic: { cacheControl: { type: string } } };
    };
    assert.equal(sys.role, "system");
    assert.deepEqual(sys.providerOptions.anthropic.cacheControl, {
      type: "ephemeral",
    });
    assert.equal(
      sys.content,
      [
        "Start by calling getPullRequest and listChangedFiles to inspect the actual PR metadata and diff.",
        "Read only the files you need from the PR head branch.",
        "Always call reportReview exactly once before finishing. Mogplex will publish the canonical review result as a GitHub Check plus the best PR surface available from that structured report: a native GitHub review when possible, otherwise a PR timeline comment.",
        "When you find concrete issues, include structured findings with severity, title, body, and the exact file path. If hasIssues=true, you must include at least one structured finding. Add a line number only when the issue maps to a specific changed line in the PR diff.",
        "If there are no material issues, call reportReview with hasIssues=false.",
        "Write summary, commentBody, and finding bodies as plain prose or bullet lists — never markdown headings (#). Mogplex embeds your text under its own '## Mogplex PR Review' heading, so headings you emit would render as top-level section titles.",
        "commentBody is only published when you report no structured findings; use it for the full review narrative in that case. When you include findings, omit commentBody — put everything in summary and the finding bodies.",
      ].join("\n")
    );
    assert.equal(opts.prompt, "Review PR #99.");
  } finally {
    mockedGithubFetch.restore();
  }
});

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

test("createPRFixAgentRunner honors configured automation timeouts above the floor", async () => {
  const { createPRFixAgentRunner } = await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;

  const runPRFixAgent = createPRFixAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
      return {
        text: "fixed",
        steps: [],
        totalUsage: {
          inputTokens: 6,
          outputTokens: 3,
        },
      } as never;
    },
  });

  const result = await runPRFixAgent(
    {
      context: {
        metadata: {},
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
          max_steps: 8,
          timeout_ms: 360_000,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      review: {
        hasIssues: true,
        summary: "Fix the null guard",
        commentBody: null,
        affectedFiles: ["src/file.ts"],
        findings: [],
      },
      pullRequest: {
        number: 42,
        title: "Fix race condition",
        body: null,
        headRef: "feature/fix",
        headSha: "abc123",
        headRepoFullName: "acme/widgets",
        baseRef: "main",
        baseSha: "def456",
        baseRepoFullName: "acme/widgets",
      },
      targetRepo: {
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
  const capturedOptions = options as CapturedGenerateTextOptions;
  assert.equal(capturedOptions.timeout, getAutomationGenerateTimeoutMs(360000));
  assert.equal(capturedOptions.maxRetries, 0);
  assert.equal(result.text, "fixed");
  assert.deepEqual(result.execution, {
    phase: "pr_fix",
    requestedModelId: "openai/gpt-5.4",
    attempts: 1,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: 360000,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: null,
    finalFailureMessage: null,
    finalFailureStatusCode: null,
    observedInputTokens: 6,
    observedOutputTokens: 3,
    observedUsage: {
      inputTokens: 6,
      outputTokens: 3,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: null,
      generationIds: [],
    },
  });
});

test("createPRFixAgentRunner includes structured findings in the fix prompt", async () => {
  const { createPRFixAgentRunner } = await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;

  const runPRFixAgent = createPRFixAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
      return {
        text: "fixed",
        steps: [],
        totalUsage: {
          inputTokens: 6,
          outputTokens: 3,
        },
      } as never;
    },
  });

  await runPRFixAgent(
    {
      context: {
        metadata: {},
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
          max_steps: 8,
          timeout_ms: 360_000,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      review: {
        hasIssues: true,
        summary: "Reviewer found two issues.",
        // Structured reviews omit commentBody; the findings must still
        // reach the fixer prompt on their own.
        commentBody: null,
        affectedFiles: ["src/file.ts"],
        findings: [
          {
            severity: "critical",
            title: "Null deref in widget lookup",
            body: "getWidget can return null and the result is used unchecked.",
            path: "src/file.ts",
            line: 42,
          },
          {
            severity: "suggestion",
            title: "Tighten error message",
            body: "Include the widget id in the thrown error.",
            path: null,
            line: null,
          },
        ],
      },
      pullRequest: {
        number: 42,
        title: "Fix race condition",
        body: null,
        headRef: "feature/fix",
        headSha: "abc123",
        headRepoFullName: "acme/widgets",
        baseRef: "main",
        baseSha: "def456",
        baseRepoFullName: "acme/widgets",
      },
      targetRepo: {
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
  const prompt = (options as CapturedGenerateTextOptions).prompt!;
  assert.ok(prompt.includes("The review findings:"));
  assert.ok(
    prompt.includes(
      "- [critical] Null deref in widget lookup (src/file.ts:42): getWidget can return null and the result is used unchecked."
    )
  );
  assert.ok(
    prompt.includes(
      "- [suggestion] Tighten error message: Include the widget id in the thrown error."
    )
  );
  assert.ok(!prompt.includes("The reviewer comment body was:"));
});

test("createPRFixAgentRunner uses the shared automation timeout floor", async () => {
  const { createPRFixAgentRunner } = await loadAutomationJobWorkflowModule();

  let options: CapturedGenerateTextOptions | null = null;

  const runPRFixAgent = createPRFixAgentRunner({
    generateText: async (input) => {
      options = input as unknown as CapturedGenerateTextOptions;
      return {
        text: "fixed",
        steps: [],
        totalUsage: {
          inputTokens: 6,
          outputTokens: 3,
        },
      } as never;
    },
  });

  const result = await runPRFixAgent(
    {
      context: {
        metadata: {},
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
          max_steps: 8,
          timeout_ms: 30_000,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      review: {
        hasIssues: true,
        summary: "Fix the null guard",
        commentBody: null,
        affectedFiles: ["src/file.ts"],
        findings: [],
      },
      pullRequest: {
        number: 42,
        title: "Fix race condition",
        body: null,
        headRef: "feature/fix",
        headSha: "abc123",
        headRepoFullName: "acme/widgets",
        baseRef: "main",
        baseSha: "def456",
        baseRepoFullName: "acme/widgets",
      },
      targetRepo: {
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
  const capturedOptions = options as CapturedGenerateTextOptions;
  assert.equal(capturedOptions.timeout, getAutomationGenerateTimeoutMs(30_000));
  assert.equal(capturedOptions.maxRetries, 0);
  assert.equal(result.text, "fixed");
  assert.deepEqual(result.execution, {
    phase: "pr_fix",
    requestedModelId: "openai/gpt-5.4",
    attempts: 1,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: null,
    finalFailureMessage: null,
    finalFailureStatusCode: null,
    observedInputTokens: 6,
    observedOutputTokens: 3,
    observedUsage: {
      inputTokens: 6,
      outputTokens: 3,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: null,
      generationIds: [],
    },
  });
});

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
  // pr_review now splits stable instructions into `system` and keeps per-call
  // data in `prompt` (#530); pr_opened uses the same code path.
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

test("createAutomationJobTask propagates failed flow model diagnostics without duplicating ai_calls", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const { AutomationModelExecutionError } =
    await import("../../lib/workflows/automation-model-execution");

  const execution = {
    phase: "pr_review",
    attempts: 2,
    retryCount: 1,
    retried: true,
    effectiveTimeoutMs: 750_000,
    observedInputTokens: 7,
    observedOutputTokens: 3,
    recoveredFromFailureClass: "provider_unavailable" as const,
    recoveredFromMessage: "Service temporarily unavailable",
    finalFailureClass: "provider_unavailable" as const,
    finalFailureMessage: "Service temporarily unavailable",
    finalFailureStatusCode: 503,
  };
  const loggedCalls: Array<{
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    execution: Record<string, unknown> | null | undefined;
  }> = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 142,
          head_sha: "abc123",
          head_ref: "feat/model-override",
          base_ref: "main",
          head_repo_full_name: "acme/widgets",
          base_repo_full_name: "acme/widgets",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "inception/mercury-2",
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
        flowId: "flow-123",
        flowVersionId: "flow-version-123",
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
                modelOverride: "anthropic/claude-sonnet-4.6",
                maxStepsOverride: null,
                timeoutMsOverride: null,
                systemPromptOverride: null,
                autofix: false,
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
        agentsById: new Map([
          [
            "agent-base-1",
            {
              id: "agent-base-1",
              name: "PR Review Agent",
              slug: "pr-review-agent",
              model: "inception/mercury-2",
              system_prompt: null,
              max_steps: null,
              timeout_ms: null,
            },
          ],
        ]),
      },
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async (_userId, modelId) => ({
      model: modelId,
      effectiveModelId: modelId,
    }),
    runAutomationAgent: async () => {
      throw new AutomationModelExecutionError({
        failure: {
          classification: "provider_unavailable",
          retryable: true,
          rawMessage: "Service temporarily unavailable",
          message:
            "Automation model provider was unavailable: Service temporarily unavailable",
          statusCode: 503,
          errorName: "APICallError",
          errorCode: null,
        },
        metadata: execution,
        cause: new Error("Service temporarily unavailable"),
      });
    },
    createPrReviewCheckRun: async () => ({
      id: 91,
      htmlUrl: "https://github.com/acme/widgets/runs/91",
    }),
    completePrReviewCheckRun: async () => ({
      id: 91,
      htmlUrl: "https://github.com/acme/widgets/runs/91",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 1,
      htmlUrl: "https://github.com/acme/widgets/pull/142#issuecomment-1",
      created: true,
    }),
    getDurationMs: async () => 123,
    persistJobFailure: async () => true,
    tryLogAiCall: async (input) => {
      loggedCalls.push({
        model: input.context.agent.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        execution: input.execution as
          | Record<string, unknown>
          | null
          | undefined,
      });
      return null;
    },
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
        return Response.json(
          {
            id: "node-run-updated",
          },
          { status: 200 }
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
      jobRunId: "job-flow-pr-review-failure",
      startedAt: "2026-04-12T23:20:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-123",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.deepEqual(result, {
      success: false,
      error:
        "Automation model provider was unavailable: Service temporarily unavailable",
      observabilityError: null,
      modelFailure: {
        phase: "pr_review",
        failureClass: "provider_unavailable",
        statusCode: 503,
        attempts: 2,
        retryCount: 1,
      },
    });
    assert.equal(loggedCalls.length, 1);
    assert.deepEqual(loggedCalls[0], {
      model: "anthropic/claude-sonnet-4.6",
      inputTokens: 7,
      outputTokens: 3,
      execution,
    });
    assert.ok(controlDispatchEvent);
    const dispatchEvent = controlDispatchEvent as CapturedControlDispatchEvent;
    assert.equal(dispatchEvent.outcome, "failed");
    assert.equal(dispatchEvent.reason, "PR_REVIEW_INFRA_FAILED");
    assert.equal(
      dispatchEvent.metadata?.review_outcome,
      "PR_REVIEW_INFRA_FAILED"
    );
    assert.equal(dispatchEvent.metadata?.model_execution_phase, "pr_review");
    assert.equal(dispatchEvent.metadata?.model_attempts, 2);
    assert.equal(dispatchEvent.metadata?.model_retry_count, 1);
    assert.equal(
      dispatchEvent.metadata?.model_failure_class,
      "provider_unavailable"
    );
    assert.equal(dispatchEvent.metadata?.model_failure_status_code, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("createAutomationJobTask preserves success persistence fields from automation agent results", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let successInput: {
    jobRunId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
  } | null = null;
  let aiCallInput: CapturedAiCallInput | null = null;
  let releasedInput: {
    jobRunId: string;
    releasedScope: {
      sourceKind: "assignment" | "trigger" | "flow" | "manual_retry";
      sourceType: string;
      sourceId: string | null;
      repoId: string | null;
      installationId: number | null;
    };
  } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { issue_number: 7 },
        assignmentType: "issue_comment",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
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
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "done",
      usage: {
        inputTokens: 13,
        outputTokens: 21,
      },
      steps: [
        makeStep({
          toolCalls: [
            { toolName: "replyToThread", input: { message: "hello" } },
          ],
          toolResults: [{ ok: true }],
        }),
      ],
    }),
    getDurationMs: async () => 321,
    persistJobSuccess: async (input) => {
      successInput = input;
      return true;
    },
    tryLogAiCall: async (input) => {
      aiCallInput = {
        status: input.status,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        durationMs: input.durationMs,
        toolCalls: input.toolCalls?.map((toolCall) => ({
          name: toolCall.name,
        })),
      };
      return null;
    },
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async (input) => {
      releasedInput = input;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
  });

  const result = await workflow({
    jobRunId: "job-123",
    startedAt: "2026-03-23T23:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-123",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "done",
    observabilityError: null,
  });
  assert.deepEqual(successInput, {
    jobRunId: "job-123",
    inputTokens: 13,
    outputTokens: 21,
    durationMs: 321,
  });
  assert.ok(aiCallInput);
  const capturedAiCallInput = aiCallInput as unknown as CapturedAiCallInput;
  assert.equal(capturedAiCallInput.status, "success");
  assert.equal(capturedAiCallInput.inputTokens, 13);
  assert.equal(capturedAiCallInput.outputTokens, 21);
  assert.equal(capturedAiCallInput.durationMs, 321);
  assert.equal(capturedAiCallInput.toolCalls?.length, 1);
  assert.equal(capturedAiCallInput.toolCalls?.[0]?.name, "replyToThread");
  assert.deepEqual(releasedInput, {
    jobRunId: "job-123",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-123",
      repoId: "repo-123",
      installationId: 123,
    },
  });
});

test("createAutomationJobTask keeps legacy PR reviews review-only by default", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let successInput: {
    jobRunId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
  } | null = null;
  let aiCallInput: CapturedAiCallInput | null = null;
  let fixerInvocations = 0;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let persistedReviewFindingsInput: CapturedPersistedReviewFindingsInput | null =
    null;
  let createdCheckRun = false;
  let completedCheckRun: {
    conclusion: string;
    summary: string;
  } | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewInput: {
    prNumber: number;
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  } | null = null;
  let clearedTimelineComment = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 42,
          head_sha: "abc123",
          head_ref: "feature/reviewed-pr",
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
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => {
      createdCheckRun = true;
      return {
        id: 91,
        htmlUrl: "https://github.com/acme/widgets/runs/91",
      };
    },
    completePrReviewCheckRun: async (input) => {
      completedCheckRun = {
        conclusion: input.conclusion,
        summary: input.summary,
      };
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/91",
      };
    },
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 501,
        htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-501",
        created: true,
      };
    },
    createPrReviewGithubReview: async (input) => {
      githubReviewInput = {
        prNumber: input.prNumber,
        body: input.body,
        comments: input.comments ?? [],
      };
      return {
        id: 44,
        htmlUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-44",
      };
    },
    clearPrReviewTimelineComment: async () => {
      clearedTimelineComment = true;
      return {
        deleted: true,
        id: 501,
        htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-501",
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => ({
      number: 42,
      title: "Reviewed PR",
      body: null,
      headRef: "feature/reviewed-pr",
      headSha: "abc123",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    resolveAutofixTargetRepo: async () => {
      throw new Error(
        "resolveAutofixTargetRepo should not be called without autofix opt-in"
      );
    },
    resolveAutofixGithubToken: async () => {
      throw new Error(
        "resolveAutofixGithubToken should not be called without autofix opt-in"
      );
    },
    runAutomationAgent: async () => ({
      text: "Reviewer found two issues.",
      usage: {
        inputTokens: 13,
        outputTokens: 21,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found two issues.",
                commentBody: "Two issues need fixes.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable lookup",
                    body: "This property access can throw on undefined input.",
                    path: " src/widget.ts ",
                    line: 18,
                  },
                  {
                    severity: "suggestion",
                    title: "Trim the fallback branch",
                    body: "The fallback branch can return early for clarity.",
                    path: "src/widget.ts",
                    line: 27,
                  },
                ],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found two issues." },
          ],
        }),
      ],
    }),
    runPRFixAgent: async () => {
      fixerInvocations += 1;
      return {
        text: "Applied a safe follow-up fix directly to the PR branch.",
        usage: {
          inputTokens: 5,
          outputTokens: 8,
        },
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "updateFile",
                input: {
                  path: "src/widget.ts",
                  message: "Fix reviewer findings",
                },
              },
              {
                toolName: "reportFix",
                input: {
                  applied: true,
                  summary: "Patched src/widget.ts",
                  updatedFiles: ["src/widget.ts"],
                },
              },
            ],
            toolResults: [
              { success: true },
              { applied: true, summary: "Patched src/widget.ts" },
            ],
          }),
        ],
      };
    },
    getDurationMs: async () => 222,
    persistJobSuccess: async (input) => {
      successInput = input;
      return true;
    },
    persistJobReviewFindings: async (input) => {
      persistedReviewFindingsInput = input;
      return makePersistedReviewFindingsResult(input.findings.length);
    },
    tryLogAiCall: async (input) => {
      aiCallInput = {
        status: input.status,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        durationMs: input.durationMs,
        toolCalls: input.toolCalls?.map((toolCall) => ({
          name: toolCall.name,
        })),
      };
      return null;
    },
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
    jobRunId: "job-pr-123",
    startedAt: "2026-03-26T23:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-123",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found two issues.",
    observabilityError: null,
  });
  assert.equal(fixerInvocations, 0);
  assert.deepEqual(successInput, {
    jobRunId: "job-pr-123",
    inputTokens: 13,
    outputTokens: 21,
    durationMs: 222,
  });
  assert.deepEqual(persistedReviewFindingsInput, {
    userId: "user-123",
    jobRunId: "job-pr-123",
    repoId: "repo-123",
    repoFullName: "acme/widgets",
    prNumber: 42,
    headSha: "abc123",
    findings: [
      {
        severity: "warning",
        title: "Guard nullable lookup",
        body: "This property access can throw on undefined input.",
        path: "src/widget.ts",
        line: 18,
      },
      {
        severity: "suggestion",
        title: "Trim the fallback branch",
        body: "The fallback branch can return early for clarity.",
        path: "src/widget.ts",
        line: 27,
      },
    ],
  });
  assert.ok(aiCallInput);
  const capturedAiCallInput = aiCallInput as unknown as CapturedAiCallInput;
  assert.equal(capturedAiCallInput.status, "success");
  assert.equal(capturedAiCallInput.inputTokens, 13);
  assert.equal(capturedAiCallInput.outputTokens, 21);
  assert.equal(createdCheckRun, true);
  assert.equal(clearedTimelineComment, true);
  assert.deepEqual(completedCheckRun, {
    conclusion: "neutral",
    summary: "Reviewer found two issues.",
  });
  assert.equal(timelineCommentInput, null);
  assert.deepEqual(githubReviewInput, {
    prNumber: 42,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Reviewer found two issues.",
      "",
      "2 findings were added inline.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/91)",
    ].join("\n"),
    comments: [
      {
        path: "src/widget.ts",
        line: 18,
        body: "**Warning:** Guard nullable lookup\n\nThis property access can throw on undefined input.",
      },
      {
        path: "src/widget.ts",
        line: 27,
        body: "**Suggestion:** Trim the fallback branch\n\nThe fallback branch can return early for clarity.",
      },
    ],
  });
  assert.deepEqual(
    capturedAiCallInput.toolCalls?.map((toolCall) => toolCall.name),
    ["reportReview"]
  );
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found two issues.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 44,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/42#pullrequestreview-44",
      review_github_review_error: null,
      review_github_inline_comments_count: 2,
      review_check_run_id: 91,
      review_check_run_url: "https://github.com/acme/widgets/runs/91",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 2,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask skips PR review publishing when the PR head changed", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let completedCheckRun: {
    conclusion: string;
    title: string;
    summary: string;
    text: string | null | undefined;
  } | null = null;
  let githubReviewCalled = false;
  let timelineCommentCalled = false;
  let findingsPersistCalled = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 45,
          head_sha: "old123",
          head_ref: "feature/reviewed-pr",
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
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => ({
      id: 92,
      htmlUrl: "https://github.com/acme/widgets/runs/92",
    }),
    completePrReviewCheckRun: async (input) => {
      completedCheckRun = {
        conclusion: input.conclusion,
        title: input.title,
        summary: input.summary,
        text: input.text,
      };
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/92",
      };
    },
    loadPullRequestDetails: async () => ({
      number: 45,
      title: "Reviewed PR",
      body: null,
      headRef: "feature/reviewed-pr",
      headSha: "new456",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    upsertPrReviewTimelineComment: async () => {
      timelineCommentCalled = true;
      throw new Error("stale PR reviews should not post timeline comments");
    },
    createPrReviewGithubReview: async () => {
      githubReviewCalled = true;
      throw new Error("stale PR reviews should not post native reviews");
    },
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 13,
        outputTokens: 21,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                affectedFiles: ["src/widget.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable lookup",
                    body: "This property access can throw on undefined input.",
                    path: "src/widget.ts",
                    line: 18,
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
    resolveAutofixTargetRepo: async () => {
      throw new Error("resolveAutofixTargetRepo should not be called");
    },
    resolveAutofixGithubToken: async () => {
      throw new Error("resolveAutofixGithubToken should not be called");
    },
    runPRFixAgent: async () => {
      throw new Error("runPRFixAgent should not be called");
    },
    getDurationMs: async () => 223,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async () => {
      findingsPersistCalled = true;
      throw new Error("stale PR findings should not be persisted");
    },
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
    jobRunId: "job-pr-stale-head",
    startedAt: "2026-03-26T23:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-123",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(githubReviewCalled, false);
  assert.equal(timelineCommentCalled, false);
  assert.equal(findingsPersistCalled, false);
  assert.deepEqual(completedCheckRun, {
    conclusion: "success",
    title: "Review skipped",
    summary:
      "Mogplex skipped publishing this review because the PR head changed from old123 to new456.",
    text: "Mogplex skipped publishing this review because the PR head changed from old123 to new456.",
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_STALE_HEAD_SHA",
    metadata: {
      review_outcome: "PR_REVIEW_STALE_HEAD_SHA",
      review_outcome_label: "Stale PR head SHA",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 92,
      review_check_run_url: "https://github.com/acme/widgets/runs/92",
      review_check_run_completed: true,
      review_check_run_conclusion: "success",
      review_check_run_error: null,
      review_findings_persisted: false,
      review_findings_count: 0,
      review_findings_persist_error: null,
      review_head_sha: "old123",
      review_current_head_sha: "new456",
      review_stale_head_check_error: null,
    },
  });
});

test("createAutomationJobTask skips native GitHub review publishing when PR head SHA is missing", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewCalled = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 43,
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
    }),
    resolveGithubToken: async () => "github-token",
    createPrReviewCheckRun: async () => {
      throw new Error(
        "createPrReviewCheckRun should not be called without a PR head SHA"
      );
    },
    completePrReviewCheckRun: async () => {
      throw new Error(
        "completePrReviewCheckRun should not be called without a PR head SHA"
      );
    },
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 502,
        htmlUrl: "https://github.com/acme/widgets/pull/43#issuecomment-502",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      githubReviewCalled = true;
      throw new Error(
        "createPrReviewGithubReview should not be called without a PR head SHA"
      );
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 8,
        outputTokens: 11,
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
    getDurationMs: async () => 48,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
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
    jobRunId: "job-pr-no-head-sha",
    startedAt: "2026-03-27T00:05:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-head-sha",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(githubReviewCalled, false);
  assert.deepEqual(timelineCommentInput, {
    prNumber: 43,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      // Structured reports lead with the summary; commentBody would
      // double-report the findings sections below.
      "Reviewer found one issue.",
      "",
      "Affected files:",
      "- src/widget.ts",
      "",
      "Warnings",
      "- Guard nullable widget lookup (src/widget.ts:L14)",
      "  The widget can be undefined here.",
    ].join("\n"),
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 502,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/43#issuecomment-502",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: null,
      review_check_run_url: null,
      review_check_run_completed: false,
      review_check_run_conclusion: null,
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask retries GitHub review publishing without inline comments when anchors are invalid", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const githubReviewInputs: Array<{
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  }> = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 44,
          head_sha: "beaded44",
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
    upsertPrReviewTimelineComment: async () => ({
      id: 544,
      htmlUrl: "https://github.com/acme/widgets/pull/44#issuecomment-544",
      created: true,
    }),
    createPrReviewGithubReview: async (input) => {
      githubReviewInputs.push({
        body: input.body,
        comments: input.comments ?? [],
      });

      if (githubReviewInputs.length === 1) {
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
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 9,
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
    getDurationMs: async () => 55,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
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
    jobRunId: "job-pr-inline-anchor-retry",
    startedAt: "2026-03-27T00:06:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-inline-anchor-retry",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(githubReviewInputs, [
    {
      body: [
        "## Mogplex PR Review",
        "",
        "**Status:** Attention needed",
        "",
        "Reviewer found one issue.",
        "",
        "1 finding was added inline.",
        "",
        "[View check run](https://github.com/acme/widgets/runs/44)",
      ].join("\n"),
      comments: [
        {
          path: "src/widget.ts",
          line: 14,
          body: "**Warning:** Guard nullable widget lookup\n\nThe widget can be undefined here.",
        },
      ],
    },
    {
      body: [
        "## Mogplex PR Review",
        "",
        "**Status:** Attention needed",
        "",
        "Reviewer found one issue.",
        "",
        "Warnings",
        "- Guard nullable widget lookup (src/widget.ts:L14)",
        "  The widget can be undefined here.",
        "",
        "[View check run](https://github.com/acme/widgets/runs/44)",
      ].join("\n"),
      comments: [],
    },
  ]);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 444,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/44#pullrequestreview-444",
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 44,
      review_check_run_url: "https://github.com/acme/widgets/runs/44",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask skips legacy PR autofix for forked pull requests", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let autofixTargetRepo: string | null = null;
  let autofixToken: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 99,
          head_ref: "fix/from-fork",
          head_repo_full_name: "octocat/widgets-fork",
          base_ref: "main",
          base_repo_full_name: "acme/widgets",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-base",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
    }),
    resolveGithubToken: async () => "review-token",
    upsertPrReviewTimelineComment: async () => ({
      id: 601,
      htmlUrl: "https://github.com/acme/widgets-fork/pull/99#issuecomment-601",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => {
      throw new Error(
        "loadPullRequestDetails should not be called without autofix opt-in"
      );
    },
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
                affectedFiles: ["src/widget.ts"],
              },
            },
            {
              toolName: "postComment",
              input: {
                body: "Reviewer found one issue.",
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
            { success: true },
          ],
        }),
      ],
    }),
    resolveAutofixTargetRepo: async () => {
      autofixTargetRepo = "unexpected";
      throw new Error(
        "resolveAutofixTargetRepo should not be called without autofix opt-in"
      );
    },
    resolveAutofixGithubToken: async () => {
      autofixToken = "unexpected";
      throw new Error(
        "resolveAutofixGithubToken should not be called without autofix opt-in"
      );
    },
    runPRFixAgent: async (input, githubToken) => {
      autofixTargetRepo = input.targetRepo.full_name;
      autofixToken = githubToken;
      return {
        text: "Applied fix on the fork branch.",
        usage: {
          inputTokens: 4,
          outputTokens: 5,
        },
        steps: [
          makeStep({
            toolCalls: [
              {
                toolName: "updateFile",
                input: { path: "src/widget.ts", message: "Apply fix" },
              },
            ],
            toolResults: [{ success: true }],
          }),
        ],
      };
    },
    getDurationMs: async () => 100,
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

  const result = await workflow({
    jobRunId: "job-pr-fork",
    startedAt: "2026-03-27T00:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-fork",
      repoId: "repo-base",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(autofixTargetRepo, null);
  assert.equal(autofixToken, null);
});

test("createAutomationJobTask skips the PR fixer when no installation autofix token is available", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let fixerInvoked = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 77,
          head_ref: "fix/no-installation-token",
          head_repo_full_name: "acme/widgets",
          base_ref: "main",
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
          github_installation_id: null,
        },
      },
    }),
    resolveGithubToken: async () => "review-token",
    upsertPrReviewTimelineComment: async () => ({
      id: 602,
      htmlUrl: "https://github.com/acme/widgets/pull/77#issuecomment-602",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    loadPullRequestDetails: async () => ({
      number: 77,
      title: "Fix without installation token",
      body: null,
      headRef: "fix/no-installation-token",
      headSha: "def456",
      headRepoFullName: "acme/widgets",
      baseRef: "main",
      baseSha: "def456",
      baseRepoFullName: "acme/widgets",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 11,
        outputTokens: 14,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
              },
            },
            {
              toolName: "postComment",
              input: {
                body: "Reviewer found one issue.",
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
            { success: true },
          ],
        }),
      ],
    }),
    resolveAutofixTargetRepo: async () => ({
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: null,
    }),
    resolveAutofixGithubToken: async () => null,
    runPRFixAgent: async () => {
      fixerInvoked = true;
      throw new Error(
        "runPRFixAgent should not be called without installation auth"
      );
    },
    getDurationMs: async () => 101,
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

  const result = await workflow({
    jobRunId: "job-pr-no-installation-token",
    startedAt: "2026-03-27T00:05:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-installation-token",
      repoId: "repo-123",
      installationId: null,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(fixerInvoked, false);
});

test("createAutomationJobTask records a no-findings control outcome for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let createdCheckRun = false;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 12,
          head_sha: "def456",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => {
      createdCheckRun = true;
      return {
        id: 15,
        htmlUrl: "https://github.com/acme/widgets/runs/15",
      };
    },
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/15",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 115,
        htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-115",
        created: true,
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "No issues found.",
      usage: {
        inputTokens: 4,
        outputTokens: 6,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: false,
                summary: "No issues found.",
                affectedFiles: ["src/widget.ts"],
              },
            },
          ],
          toolResults: [{ hasIssues: false, summary: "No issues found." }],
        }),
      ],
    }),
    getDurationMs: async () => 64,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
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
  });

  const result = await workflow({
    jobRunId: "job-pr-no-findings",
    startedAt: "2026-03-27T00:06:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-findings",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "No issues found.",
    observabilityError: null,
  });
  assert.equal(createdCheckRun, true);
  assert.deepEqual(timelineCommentInput, {
    prNumber: 12,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** No material issues found",
      "",
      "No issues found.",
      "",
      "Affected files:",
      "- src/widget.ts",
      "",
      "[View check run](https://github.com/acme/widgets/runs/15)",
    ].join("\n"),
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_NO_FINDINGS",
    metadata: {
      review_outcome: "PR_REVIEW_NO_FINDINGS",
      review_outcome_label: "No findings",
      review_has_issues: false,
      review_summary: "No issues found.",
      review_affected_files: ["src/widget.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 115,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/12#issuecomment-115",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 15,
      review_check_run_url: "https://github.com/acme/widgets/runs/15",
      review_check_run_completed: true,
      review_check_run_conclusion: "success",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask falls back to a timeline comment when reportReview is missing", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 17,
          head_sha: "legacy17",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 17,
      htmlUrl: "https://github.com/acme/widgets/runs/17",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/17",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 117,
        htmlUrl: "https://github.com/acme/widgets/pull/17#issuecomment-117",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      throw new Error(
        "createPrReviewGithubReview should not be called without structured review output"
      );
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 7,
        outputTokens: 10,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "postComment",
              input: {
                body: "Guard the nullable widget lookup.",
              },
            },
          ],
          toolResults: [{ success: true }],
        }),
      ],
    }),
    getDurationMs: async () => 73,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
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
  });

  const result = await workflow({
    jobRunId: "job-pr-legacy-review-fallback",
    startedAt: "2026-03-27T00:07:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-legacy-review-fallback",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(timelineCommentInput, {
    prNumber: 17,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Note: Structured review output was missing, so Mogplex used the legacy review comment as fallback output.",
      "",
      "Guard the nullable widget lookup.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/17)",
    ].join("\n"),
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: [],
      review_comment_posted: true,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 117,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/17#issuecomment-117",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 17,
      review_check_run_url: "https://github.com/acme/widgets/runs/17",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask publishes a body-only native GitHub review when issues have no structured findings", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let timelineCommentInput: { prNumber: number; body: string } | null = null;
  let githubReviewInput: {
    prNumber: number;
    body: string;
    comments: Array<{ path: string; body: string; line: number }>;
  } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 18,
          head_sha: "fedcba",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 18,
      htmlUrl: "https://github.com/acme/widgets/runs/18",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/18",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineCommentInput = {
        prNumber: input.prNumber,
        body: input.body,
      };
      return {
        id: 118,
        htmlUrl: "https://github.com/acme/widgets/pull/18#issuecomment-118",
        created: true,
      };
    },
    createPrReviewGithubReview: async (input) => {
      githubReviewInput = {
        prNumber: input.prNumber,
        body: input.body,
        comments: input.comments ?? [],
      };
      return {
        id: 418,
        htmlUrl:
          "https://github.com/acme/widgets/pull/18#pullrequestreview-418",
      };
    },
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 6,
        outputTokens: 9,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "The query needs a null guard.",
                affectedFiles: ["src/query.ts"],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    getDurationMs: async () => 88,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
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
  });

  const result = await workflow({
    jobRunId: "job-pr-check-only",
    startedAt: "2026-03-27T00:08:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-check-only",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.equal(timelineCommentInput, null);
  assert.deepEqual(githubReviewInput, {
    prNumber: 18,
    body: [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Reviewer found one issue.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/18)",
    ].join("\n"),
    comments: [],
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/query.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 418,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/18#pullrequestreview-418",
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 18,
      review_check_run_url: "https://github.com/acme/widgets/runs/18",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 0,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask does not fail when GitHub review publishing is best-effort only", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 19,
          head_sha: "abc999",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 19,
      htmlUrl: "https://github.com/acme/widgets/runs/19",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/19",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 119,
      htmlUrl: "https://github.com/acme/widgets/pull/19#issuecomment-119",
      created: true,
    }),
    createPrReviewGithubReview: async () => {
      throw new Error("secondary rate limit");
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 11,
        outputTokens: 14,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "The query needs a null guard.",
                affectedFiles: ["src/query.ts"],
                findings: [
                  {
                    severity: "warning",
                    title: "Guard nullable query access",
                    body: "This call can throw when the query record is missing.",
                    path: "src/query.ts",
                    line: 54,
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
    getDurationMs: async () => 41,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
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
    jobRunId: "job-pr-best-effort-review",
    startedAt: "2026-03-27T00:12:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-best-effort-review",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Reviewer found one issue.",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "PR_REVIEW_POSTED",
    metadata: {
      review_outcome: "PR_REVIEW_POSTED",
      review_outcome_label: "Review posted",
      review_has_issues: true,
      review_summary: "Reviewer found one issue.",
      review_affected_files: ["src/query.ts"],
      review_comment_posted: false,
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 119,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/19#issuecomment-119",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: "secondary rate limit",
      review_github_inline_comments_count: 1,
      review_check_run_id: 19,
      review_check_run_url: "https://github.com/acme/widgets/runs/19",
      review_check_run_completed: true,
      review_check_run_conclusion: "neutral",
      review_check_run_error: null,
      review_findings_persisted: true,
      review_findings_count: 1,
      review_findings_persist_error: null,
    },
  });
});

test("createAutomationJobTask fails PR reviews when a required check run cannot be completed", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  const checkRunConclusions: string[] = [];

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 24,
          head_sha: "cafebabe",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 24,
      htmlUrl: "https://github.com/acme/widgets/runs/24",
    }),
    completePrReviewCheckRun: async (input) => {
      checkRunConclusions.push(input.conclusion);
      if (input.conclusion === "neutral") {
        throw new Error("transient completion failure");
      }

      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/24",
      };
    },
    upsertPrReviewTimelineComment: async () => ({
      id: 224,
      htmlUrl: "https://github.com/acme/widgets/pull/24#issuecomment-224",
      created: true,
    }),
    createPrReviewGithubReview: async () => ({
      id: 424,
      htmlUrl: "https://github.com/acme/widgets/pull/24#pullrequestreview-424",
    }),
    clearPrReviewTimelineComment: async () => ({
      deleted: false,
      id: null,
      htmlUrl: null,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 6,
        outputTokens: 9,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "A null guard is missing.",
                affectedFiles: ["src/query.ts"],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    getDurationMs: async () => 91,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-check-run-must-complete",
    startedAt: "2026-03-27T00:12:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-check-run-must-complete",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub check run publish failed: transient completion failure",
    observabilityError: null,
  });
  assert.deepEqual(checkRunConclusions, ["neutral", "failure"]);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_CHECK_RUN_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_CHECK_RUN_FAILED",
      review_outcome_label: "Check run failed",
      error: "GitHub check run publish failed: transient completion failure",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 224,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/24#issuecomment-224",
      review_timeline_comment_error: null,
      review_github_review_posted: true,
      review_github_review_id: 424,
      review_github_review_url:
        "https://github.com/acme/widgets/pull/24#pullrequestreview-424",
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 24,
      review_check_run_url: "https://github.com/acme/widgets/runs/24",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
    },
  });
});

test("createAutomationJobTask fails PR reviews when a required fallback timeline comment cannot be published", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  const timelineConclusions: string[] = [];

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: "26",
          head_sha: "feedface",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 26,
      htmlUrl: "https://github.com/acme/widgets/runs/26",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/26",
    }),
    upsertPrReviewTimelineComment: async (input) => {
      timelineConclusions.push(
        input.body.includes("**Status:** Review failed") ? "failure" : "neutral"
      );

      if (timelineConclusions.length === 1) {
        throw new Error("timeline write failed");
      }

      return {
        id: 226,
        htmlUrl: "https://github.com/acme/widgets/pull/26#issuecomment-226",
        created: true,
      };
    },
    createPrReviewGithubReview: async () => {
      throw new Error("review unavailable");
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Reviewer found one issue.",
      usage: {
        inputTokens: 5,
        outputTokens: 8,
      },
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Reviewer found one issue.",
                commentBody: "Guard the nullable lookup.",
                affectedFiles: ["src/query.ts"],
              },
            },
          ],
          toolResults: [
            { hasIssues: true, summary: "Reviewer found one issue." },
          ],
        }),
      ],
    }),
    getDurationMs: async () => 77,
    persistJobSuccess: async () => true,
    persistJobReviewFindings: async ({ findings }) =>
      makePersistedReviewFindingsResult(findings.length),
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-timeline-comment-must-complete",
    startedAt: "2026-03-27T00:14:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-timeline-comment-must-complete",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub timeline comment publish failed: timeline write failed",
    observabilityError: null,
  });
  assert.deepEqual(timelineConclusions, ["neutral", "failure"]);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_TIMELINE_COMMENT_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_TIMELINE_COMMENT_FAILED",
      review_outcome_label: "Timeline comment failed",
      error: "GitHub timeline comment publish failed: timeline write failed",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 226,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/26#issuecomment-226",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: "review unavailable",
      review_github_inline_comments_count: 0,
      review_check_run_id: 26,
      review_check_run_url: "https://github.com/acme/widgets/runs/26",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
    },
  });
});

test("createAutomationJobTask records GitHub auth failures for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 44,
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
    }),
    resolveGithubToken: async () => null,
    getDurationMs: async () => 55,
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-no-github-token",
    startedAt: "2026-03-27T00:15:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-no-github-token",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "NO_GITHUB_CONNECTION",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_GITHUB_AUTH_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_GITHUB_AUTH_FAILED",
      review_outcome_label: "GitHub auth failed",
    },
  });
});

test("createAutomationJobTask fails PR reviews early when GitHub coverage cannot read the PR repo", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  try {
    globalThis.fetch = (async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://api.github.com/repos/acme/widgets/pulls/44") {
        return new Response(
          JSON.stringify({
            message: "Resource not accessible by integration",
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch during PR access preflight: ${url}`);
    }) as typeof fetch;

    const workflow = createAutomationJobTask({
      resolveJobContext: async () => ({
        context: {
          metadata: {
            pr_number: 44,
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
      }),
      resolveGithubToken: async () => "review-token",
      resolveAutomationModel: async () => ({
        model: "openai/gpt-5.4",
        effectiveModelId: "openai/gpt-5.4",
      }),
      getDurationMs: async () => 55,
      persistJobFailure: async () => true,
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
    });

    const result = await workflow({
      jobRunId: "job-pr-access-forbidden",
      startedAt: "2026-04-21T12:00:00.000Z",
      releasedScope: {
        sourceKind: "assignment",
        sourceType: "pr_review",
        sourceId: "assignment-pr-access-forbidden",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.observabilityError, null);
    assert.equal(typeof result.error, "string");
    assert.match(
      result.error!,
      /^GitHub PR access failed for acme\/widgets#44\./
    );
    assert.match(
      result.error!,
      /GitHub responded with 403: Resource not accessible by integration\./
    );
    assert.match(
      result.error!,
      /Open Settings > GitHub App coverage and add the "acme" org or personal account, then rerun the review\./
    );

    assert.ok(controlDispatchEvent);
    const dispatchEvent = controlDispatchEvent as CapturedControlDispatchEvent;
    assert.equal(dispatchEvent.outcome, "failed");
    assert.equal(dispatchEvent.reason, "PR_REVIEW_GITHUB_AUTH_FAILED");
    assert.equal(
      dispatchEvent.metadata?.review_outcome,
      "PR_REVIEW_GITHUB_AUTH_FAILED"
    );
    assert.equal(
      dispatchEvent.metadata?.review_outcome_label,
      "GitHub auth failed"
    );
    assert.equal(dispatchEvent.metadata?.error, result.error);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask records automation infrastructure failures for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const { AutomationModelExecutionError } =
    await import("../../lib/workflows/automation-model-execution");

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let capturedAiCall: {
    status: string;
    durationMs: number;
    error: string | null | undefined;
    execution: Record<string, unknown> | null | undefined;
  } | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: "27",
          head_sha: "deadbeef",
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
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 27,
      htmlUrl: "https://github.com/acme/widgets/runs/27",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/27",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 227,
      htmlUrl: "https://github.com/acme/widgets/pull/27#issuecomment-227",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new AutomationModelExecutionError({
        failure: {
          classification: "timeout",
          retryable: true,
          rawMessage: "Cannot connect to API: Headers Timeout Error",
          message:
            "Automation model request timed out: Cannot connect to API: Headers Timeout Error",
          statusCode: null,
          errorName: "Error",
          errorCode: "UND_ERR_HEADERS_TIMEOUT",
        },
        metadata: {
          phase: "pr_review",
          attempts: 1,
          retryCount: 0,
          retried: false,
          effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
          observedInputTokens: 34,
          observedOutputTokens: 11,
          recoveredFromFailureClass: null,
          recoveredFromMessage: null,
          finalFailureClass: "timeout",
          finalFailureMessage: "Cannot connect to API: Headers Timeout Error",
          finalFailureStatusCode: null,
        },
        cause: new Error("Cannot connect to API: Headers Timeout Error"),
      });
    },
    getDurationMs: async () => 999,
    persistJobFailure: async () => true,
    tryLogAiCall: async (input) => {
      capturedAiCall = input as unknown as {
        status: string;
        inputTokens: number | null;
        outputTokens: number | null;
        durationMs: number;
        error: string | null | undefined;
        execution: Record<string, unknown> | null | undefined;
      };
      return null;
    },
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
  });

  const result = await workflow({
    jobRunId: "job-pr-infra-timeout",
    startedAt: "2026-04-13T10:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-review",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "AI provider timed out during PR review after 300s.",
    observabilityError: null,
    modelFailure: {
      phase: "pr_review",
      failureClass: "timeout",
      statusCode: null,
      attempts: 1,
      retryCount: 0,
    },
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_INFRA_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_INFRA_FAILED",
      review_outcome_label: "Automation infra failed",
      error: "AI provider timed out during PR review after 300s.",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 227,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/27#issuecomment-227",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 27,
      review_check_run_url: "https://github.com/acme/widgets/runs/27",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
      model_execution_phase: "pr_review",
      model_attempts: 1,
      model_retry_attempted: false,
      model_retry_count: 0,
      model_effective_timeout_ms: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
      model_recovered_from_failure_class: null,
      model_recovered_from_message: null,
      model_failure_class: "timeout",
      model_failure_message: "Cannot connect to API: Headers Timeout Error",
      model_failure_status_code: null,
    },
  });
  assert.ok(capturedAiCall);
  const aiCall = capturedAiCall as {
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
    error: string | null | undefined;
    execution: Record<string, unknown> | null | undefined;
  };
  assert.equal(aiCall.status, "failed");
  assert.equal(aiCall.inputTokens, 34);
  assert.equal(aiCall.outputTokens, 11);
  assert.equal(typeof aiCall.durationMs, "number");
  assert.ok(aiCall.durationMs > 0);
  assert.equal(
    aiCall.error,
    "AI provider timed out during PR review after 300s."
  );
  assert.deepEqual(aiCall.execution, {
    phase: "pr_review",
    attempts: 1,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
    observedInputTokens: 34,
    observedOutputTokens: 11,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: "timeout",
    finalFailureMessage: "Cannot connect to API: Headers Timeout Error",
    finalFailureStatusCode: null,
  });
});

test("createAutomationJobTask sanitizes Supabase HTML outages in PR review failure surfaces", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let capturedCheckRunSummary: string | null = null;
  let capturedCheckRunText: string | null = null;
  let capturedTimelineCommentBody: string | null = null;

  const rawFailure = [
    "Failed to update flow node run:",
    "<title>testprojectref000000.supabase.co | 522: Connection timed out</title>",
    "Connection timed out Error code 522",
    "Cloudflare Ray ID: 9f09ee74a6bba3be",
  ].join("\n");

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: "271",
          head_sha: "cafe271",
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
      runtime: {
        provider: "trigger",
        runId: "run_pr_review_271",
      },
    }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 271,
      htmlUrl: "https://github.com/acme/widgets/runs/271",
    }),
    completePrReviewCheckRun: async (input) => {
      capturedCheckRunSummary = input.summary;
      capturedCheckRunText = input.text ?? null;
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/271",
      };
    },
    upsertPrReviewTimelineComment: async (input) => {
      capturedTimelineCommentBody = input.body;
      return {
        id: 5271,
        htmlUrl: "https://github.com/acme/widgets/pull/271#issuecomment-5271",
        created: true,
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error(rawFailure);
    },
    getDurationMs: async () => 999,
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-supabase-522",
    startedAt: "2026-04-13T10:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-review-271",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "Supabase was unavailable while recording PR review workflow state.",
    observabilityError: null,
  });
  assert.equal(
    capturedCheckRunSummary,
    "Automation infra failed: Supabase unavailable"
  );
  assert.equal(
    capturedCheckRunText,
    [
      "Supabase was unavailable while recording PR review workflow state.",
      "",
      "Diagnostics",
      "- Failure type: Automation infra failed",
      "- Infra failure: Supabase unavailable",
      "- Infra detail: Cloudflare 522 while reaching the Supabase origin",
    ].join("\n")
  );
  assert.equal(
    capturedTimelineCommentBody,
    [
      "## Mogplex PR Review",
      "",
      "**Status:** Review failed",
      "",
      "Supabase was unavailable while recording PR review workflow state.",
      "",
      "Diagnostics",
      "- Failure type: Automation infra failed",
      "- Infra failure: Supabase unavailable",
      "- Infra detail: Cloudflare 522 while reaching the Supabase origin",
      "",
      "[View check run](https://github.com/acme/widgets/runs/271)",
    ].join("\n")
  );
  assert.doesNotMatch(capturedTimelineCommentBody ?? "", /<title>/);
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_INFRA_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_INFRA_FAILED",
      review_outcome_label: "Automation infra failed",
      error:
        "Supabase was unavailable while recording PR review workflow state.",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 5271,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/271#issuecomment-5271",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 271,
      review_check_run_url: "https://github.com/acme/widgets/runs/271",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
      runtime_provider: "trigger",
      runtime_run_id: "run_pr_review_271",
    },
  });
  assert.doesNotMatch(capturedCheckRunText ?? "", /run_pr_review_271|Runtime:/);
  assert.doesNotMatch(
    capturedTimelineCommentBody ?? "",
    /run_pr_review_271|Runtime:/
  );
});

test("createAutomationJobTask wraps PR review model setup failures as infrastructure failures", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let runAutomationAgentCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: "29",
          head_sha: "cab005e",
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
          timeout_ms: 18_000,
        },
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
      id: 29,
      htmlUrl: "https://github.com/acme/widgets/runs/29",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/29",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 229,
      htmlUrl: "https://github.com/acme/widgets/pull/29#issuecomment-229",
      created: true,
    }),
    resolveAutomationModel: async () => {
      throw new Error(
        "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key."
      );
    },
    runAutomationAgent: async () => {
      runAutomationAgentCalled = true;
      return {
        text: "should not run",
        steps: [],
        usage: null,
        execution: null,
      };
    },
    getDurationMs: async () => 999,
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-model-setup-failed",
    startedAt: "2026-04-13T10:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-review-model-setup",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.equal(runAutomationAgentCalled, false);
  assert.deepEqual(result, {
    success: false,
    error:
      "Automation model configuration failed: No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
    observabilityError: null,
    modelFailure: {
      phase: "pr_review:model_resolution",
      failureClass: "configuration",
      statusCode: null,
      attempts: 0,
      retryCount: 0,
    },
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_INFRA_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_INFRA_FAILED",
      review_outcome_label: "Automation infra failed",
      error:
        "Automation model configuration failed: No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 229,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/29#issuecomment-229",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: 29,
      review_check_run_url: "https://github.com/acme/widgets/runs/29",
      review_check_run_completed: true,
      review_check_run_conclusion: "failure",
      review_check_run_error: null,
      model_execution_phase: "pr_review:model_resolution",
      model_attempts: 0,
      model_retry_attempted: false,
      model_retry_count: 0,
      model_effective_timeout_ms: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
      model_recovered_from_failure_class: null,
      model_recovered_from_message: null,
      model_failure_class: "configuration",
      model_failure_message:
        "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
      model_failure_status_code: null,
    },
  });
});

test("createAutomationJobTask classifies transport timeouts from resolved gateway fetches as infrastructure failures", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const { createResolveUserLanguageModel } = await loadAiModelResolverModule();
  const {
    buildAutomationProviderFetch,
    resetAutomationDispatcherCacheForTests,
  } = await import("../../lib/workflows/automation-model-execution");
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  const originalFetch = globalThis.fetch;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let capturedAiCall: {
    status: string;
    durationMs: number;
    error: string | null | undefined;
    execution: Record<string, unknown> | null | undefined;
  } | null = null;
  let fetchCallCount = 0;
  let capturedFetchInit: (RequestInit & { dispatcher?: unknown }) | null = null;
  let capturedCheckRunSummary: string | null = null;
  let capturedCheckRunText: string | null = null;
  let capturedTimelineCommentBody: string | null = null;

  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolveUserLanguageModel = createResolveUserLanguageModel({
      getProviderKey: async () => null,
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: true,
      }),
    });

    globalThis.fetch = (async (_input, init) => {
      const requestInit = init as RequestInit & { dispatcher?: unknown };
      if (!(requestInit.dispatcher instanceof Agent)) {
        return new Response(
          JSON.stringify({
            id: "memory-timeout-transport",
            lane: "episodic",
            content: "PR review failed: timeout",
            metadata: {},
            created_at: "2026-04-13T10:00:00.000Z",
            updated_at: "2026-04-13T10:00:00.000Z",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        );
      }

      fetchCallCount += 1;
      capturedFetchInit = requestInit;
      throw Object.assign(
        new Error("Cannot connect to API: Headers Timeout Error"),
        {
          code: "UND_ERR_HEADERS_TIMEOUT",
        }
      );
    }) as typeof fetch;

    const workflow = createAutomationJobTask({
      resolveJobContext: async () => ({
        context: {
          metadata: {
            pr_number: "28",
            head_sha: "feedface",
          },
          assignmentType: "pr_review",
          skillId: null,
          agent: {
            model: "openai/gpt-5.4",
            system_prompt: null,
            timeout_ms: 360_000,
          },
          repo: {
            id: "repo-123",
            user_id: "user-123",
            full_name: "acme/widgets",
            default_branch: "main",
            github_installation_id: 123,
          },
        },
        runtime: {
          provider: "trigger",
          runId: "run_pr_review_28",
        },
      }),
      resolveGithubToken: async () => "review-token",
      createPrReviewCheckRun: async () => ({
        id: 28,
        htmlUrl: "https://github.com/acme/widgets/runs/28",
      }),
      completePrReviewCheckRun: async (input) => {
        capturedCheckRunSummary = input.summary;
        capturedCheckRunText = input.text ?? null;

        return {
          id: input.checkRunId,
          htmlUrl: "https://github.com/acme/widgets/runs/28",
        };
      },
      upsertPrReviewTimelineComment: async (input) => {
        capturedTimelineCommentBody = input.body;

        return {
          id: 228,
          htmlUrl: "https://github.com/acme/widgets/pull/28#issuecomment-228",
          created: true,
        };
      },
      resolveAutomationModel: async (userId, modelId, timeoutMs) => ({
        ...(await resolveUserLanguageModel(userId, modelId, {
          providerFetch: buildAutomationProviderFetch({ timeoutMs }),
          preferGatewayProviderObject: true,
        })),
        effectiveModelId: modelId,
      }),
      getDurationMs: async () => 999,
      persistJobFailure: async () => true,
      tryLogAiCall: async (input) => {
        capturedAiCall = input as unknown as {
          status: string;
          durationMs: number;
          error: string | null | undefined;
          execution: Record<string, unknown> | null | undefined;
        };
        return null;
      },
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
    });

    const result = await workflow({
      jobRunId: "job-pr-infra-timeout-transport",
      startedAt: "2026-04-13T10:00:00.000Z",
      releasedScope: {
        sourceKind: "assignment",
        sourceType: "pr_review",
        sourceId: "assignment-pr-review-transport-timeout",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.equal(fetchCallCount, 2);
    assert.ok(capturedFetchInit);
    const fetchInit = capturedFetchInit as RequestInit & {
      dispatcher?: unknown;
    };
    assert.ok(fetchInit.signal);
    assert.ok(fetchInit.dispatcher instanceof Agent);

    assert.equal(result.success, false);
    assert.equal(result.observabilityError, null);
    assert.equal(
      result.error,
      "AI provider timed out during PR review after 360s."
    );
    const resultError = result.error!;
    assert.equal(
      capturedCheckRunSummary,
      "Automation infra failed: Timeout (HTTP 408)"
    );
    assert.notEqual(capturedCheckRunText, null);
    const checkRunText = capturedCheckRunText ?? "";
    assert.ok(checkRunText.startsWith(`${resultError}\n\nDiagnostics`));
    assert.match(
      checkRunText,
      /Diagnostics\n- Failure type: Automation infra failed\n- Model failure: Timeout\n- HTTP status: 408\n- Timeout budget: 360s\n- Attempts: 2\n- Retry attempted: Yes\n- Retry count: 1/
    );
    assert.match(
      checkRunText,
      /Provider detail: Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(checkRunText, /This is a client-side timeout/);
    assert.ok(capturedTimelineCommentBody);
    assert.match(
      capturedTimelineCommentBody as string,
      /\*\*Status:\*\* Review failed/
    );
    assert.match(
      capturedTimelineCommentBody as string,
      /Diagnostics\n- Failure type: Automation infra failed\n- Model failure: Timeout\n- HTTP status: 408\n- Timeout budget: 360s\n- Attempts: 2\n- Retry attempted: Yes\n- Retry count: 1/
    );
    assert.match(
      capturedTimelineCommentBody as string,
      /Provider detail: Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(
      capturedTimelineCommentBody as string,
      /This is a client-side timeout/
    );
    assert.doesNotMatch(checkRunText, /run_pr_review_28|Runtime:/);
    assert.doesNotMatch(
      capturedTimelineCommentBody as string,
      /run_pr_review_28|Runtime:/
    );

    assert.ok(controlDispatchEvent);
    const dispatchEvent = controlDispatchEvent as CapturedControlDispatchEvent;
    assert.deepEqual(dispatchEvent.outcome, "failed");
    assert.deepEqual(dispatchEvent.reason, "PR_REVIEW_INFRA_FAILED");
    assert.ok(dispatchEvent.metadata);
    const controlMetadata = dispatchEvent.metadata as Record<string, unknown>;
    assert.equal(controlMetadata.review_outcome, "PR_REVIEW_INFRA_FAILED");
    assert.equal(
      controlMetadata.review_outcome_label,
      "Automation infra failed"
    );
    assert.equal(controlMetadata.review_timeline_comment_posted, true);
    assert.equal(controlMetadata.review_timeline_comment_id, 228);
    assert.equal(
      controlMetadata.review_timeline_comment_url,
      "https://github.com/acme/widgets/pull/28#issuecomment-228"
    );
    assert.equal(controlMetadata.review_timeline_comment_error, null);
    assert.equal(controlMetadata.review_github_review_posted, false);
    assert.equal(controlMetadata.review_github_review_id, null);
    assert.equal(controlMetadata.review_github_review_url, null);
    assert.equal(controlMetadata.review_github_review_error, null);
    assert.equal(controlMetadata.review_github_inline_comments_count, 0);
    assert.equal(controlMetadata.review_check_run_id, 28);
    assert.equal(
      controlMetadata.review_check_run_url,
      "https://github.com/acme/widgets/runs/28"
    );
    assert.equal(controlMetadata.review_check_run_completed, true);
    assert.equal(controlMetadata.review_check_run_conclusion, "failure");
    assert.equal(controlMetadata.review_check_run_error, null);
    assert.equal(controlMetadata.model_execution_phase, "pr_review");
    assert.equal(controlMetadata.model_attempts, 2);
    assert.equal(controlMetadata.model_retry_attempted, true);
    assert.equal(controlMetadata.model_retry_count, 1);
    assert.equal(controlMetadata.model_effective_timeout_ms, 360000);
    assert.equal(controlMetadata.model_recovered_from_failure_class, "timeout");
    assert.equal(typeof controlMetadata.model_recovered_from_message, "string");
    assert.match(
      controlMetadata.model_recovered_from_message as string,
      /^Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(
      controlMetadata.model_recovered_from_message as string,
      /client-side timeout/i
    );
    assert.equal(controlMetadata.model_failure_class, "timeout");
    assert.equal(controlMetadata.model_failure_status_code, 408);
    assert.equal(
      controlMetadata.error,
      "AI provider timed out during PR review after 360s."
    );
    assert.equal(controlMetadata.runtime_provider, "trigger");
    assert.equal(controlMetadata.runtime_run_id, "run_pr_review_28");
    assert.equal(typeof controlMetadata.model_failure_message, "string");
    assert.match(
      controlMetadata.model_failure_message as string,
      /^Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(
      controlMetadata.model_failure_message as string,
      /client-side timeout/i
    );

    assert.ok(capturedAiCall);
    const aiCall = capturedAiCall as {
      status: string;
      durationMs: number;
      error: string | null | undefined;
      execution: Record<string, unknown> | null | undefined;
    };
    assert.equal(aiCall.status, "failed");
    assert.equal(typeof aiCall.durationMs, "number");
    assert.ok(aiCall.durationMs > 0);
    assert.equal(
      aiCall.error,
      "AI provider timed out during PR review after 360s."
    );
    assert.ok(aiCall.execution);
    const execution = aiCall.execution as Record<string, unknown>;
    assert.equal(execution.phase, "pr_review");
    assert.equal(execution.attempts, 2);
    assert.equal(execution.retryCount, 1);
    assert.equal(execution.retried, true);
    assert.equal(execution.effectiveTimeoutMs, 360000);
    assert.equal(execution.recoveredFromFailureClass, "timeout");
    assert.equal(typeof execution.recoveredFromMessage, "string");
    assert.match(
      execution.recoveredFromMessage as string,
      /^Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(
      execution.recoveredFromMessage as string,
      /client-side timeout/i
    );
    assert.equal(execution.finalFailureClass, "timeout");
    assert.equal(execution.finalFailureStatusCode, 408);
    assert.equal(typeof execution.finalFailureMessage, "string");
    assert.match(
      execution.finalFailureMessage as string,
      /^Gateway request timed out: Cannot connect to API: Headers Timeout Error/
    );
    assert.match(
      execution.finalFailureMessage as string,
      /client-side timeout/i
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetAutomationDispatcherCacheForTests();
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("automation gateway caching can be disabled by env without changing routing tags", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const originalCaching = process.env.AUTOMATION_GATEWAY_CACHING;
  const capturedOptions: CapturedGenerateTextOptions[] = [];

  try {
    const runAutomationAgent = createAutomationAgentRunner({
      generateText: async (input) => {
        capturedOptions.push(input as unknown as CapturedGenerateTextOptions);
        return {
          text: "triage complete",
          steps: [makeStep({ text: "triage complete" })],
          totalUsage: {
            inputTokens: 12,
            outputTokens: 4,
          },
          providerMetadata: undefined,
        } as never;
      },
    });

    const context = {
      metadata: { issue_number: 14 },
      assignmentType: "issue_triage",
      skillId: null,
      agent: {
        model: "openai/gpt-5.4",
        system_prompt: null,
        max_steps: 4,
        timeout_ms: null,
      },
      repo: {
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/widgets",
        default_branch: "main",
        github_installation_id: 123,
      },
    };

    delete process.env.AUTOMATION_GATEWAY_CACHING;
    await runAutomationAgent(context, "github-token");
    const defaultGateway = capturedOptions[0].providerOptions!.gateway!;
    assert.equal(defaultGateway.caching, "auto");
    assert.deepEqual(defaultGateway.tags, [
      "surface:automation",
      "type:issue_triage",
      "repo:acme/widgets",
      "flow:none",
    ]);

    process.env.AUTOMATION_GATEWAY_CACHING = "off";
    await runAutomationAgent(context, "github-token");
    const disabledGateway = capturedOptions[1].providerOptions!.gateway!;
    assert.equal(disabledGateway.caching, undefined);
    assert.deepEqual(disabledGateway.tags, [
      "surface:automation",
      "type:issue_triage",
      "repo:acme/widgets",
      "flow:none",
    ]);
  } finally {
    restoreEnv("AUTOMATION_GATEWAY_CACHING", originalCaching);
  }
});

test("createAutomationJobTask records generic automation failure diagnostics for non-PR model setup failures", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let runAutomationAgentCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          issue_number: 14,
          issue_title: "Triage this",
        },
        assignmentType: "issue_triage",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
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
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async () => {
      throw new Error(
        "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys."
      );
    },
    runAutomationAgent: async () => {
      runAutomationAgentCalled = true;
      return {
        text: "should not run",
        steps: [],
        usage: null,
        execution: null,
      };
    },
    getDurationMs: async () => 55,
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-issue-triage-model-setup-failed",
    startedAt: "2026-04-13T12:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_triage",
      sourceId: "assignment-issue-triage",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.equal(runAutomationAgentCalled, false);
  assert.deepEqual(result, {
    success: false,
    error:
      "Automation model configuration failed: Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
    observabilityError: null,
    modelFailure: {
      phase: "issue_triage:model_resolution",
      failureClass: "configuration",
      statusCode: null,
      attempts: 0,
      retryCount: 0,
    },
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "AUTOMATION_CONFIGURATION_FAILED",
    metadata: {
      error:
        "Automation model configuration failed: Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
      review_timeline_comment_posted: false,
      review_timeline_comment_id: null,
      review_timeline_comment_url: null,
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: null,
      review_check_run_url: null,
      review_check_run_completed: false,
      review_check_run_conclusion: null,
      review_check_run_error: null,
      model_execution_phase: "issue_triage:model_resolution",
      model_attempts: 0,
      model_retry_attempted: false,
      model_retry_count: 0,
      model_effective_timeout_ms: AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
      model_recovered_from_failure_class: null,
      model_recovered_from_message: null,
      model_failure_class: "configuration",
      model_failure_message:
        "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
      model_failure_status_code: null,
    },
  });
});

test("createAutomationJobTask records generic completion events for non-PR automation runs", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          issue_number: 15,
          issue_title: "Need triage",
        },
        assignmentType: "issue_triage",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
          timeout_ms: 360_000,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "Applied labels and left a next-steps comment on the issue.",
      steps: [],
      usage: {
        inputTokens: 4,
        outputTokens: 2,
      },
      execution: {
        phase: "issue_triage",
        attempts: 1,
        retryCount: 0,
        retried: false,
        effectiveTimeoutMs: 360000,
        recoveredFromFailureClass: null,
        recoveredFromMessage: null,
        finalFailureClass: null,
        finalFailureMessage: null,
        finalFailureStatusCode: null,
      },
    }),
    getDurationMs: async () => 55,
    persistJobSuccess: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-issue-triage-success",
    startedAt: "2026-04-13T12:00:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_triage",
      sourceId: "assignment-issue-triage-success",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: true,
    output: "Applied labels and left a next-steps comment on the issue.",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "completed",
    reason: "AUTOMATION_COMPLETED",
    metadata: {
      automation_output_summary:
        "Applied labels and left a next-steps comment on the issue.",
      model_execution_phase: "issue_triage",
      model_attempts: 1,
      model_retry_attempted: false,
      model_retry_count: 0,
      model_effective_timeout_ms: 360000,
      model_recovered_from_failure_class: null,
      model_recovered_from_message: null,
      model_failure_class: null,
      model_failure_message: null,
      model_failure_status_code: null,
    },
  });
});

test("createAutomationJobTask fails PR reviews with invalid pull request metadata before agent execution", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let runAutomationAgentCalls = 0;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: true,
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
    }),
    resolveGithubToken: async () => "review-token",
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      runAutomationAgentCalls += 1;
      return {
        text: "unexpected",
        usage: null,
        steps: [],
      };
    },
    getDurationMs: async () => 41,
    persistJobFailure: async () => true,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow({
    jobRunId: "job-pr-invalid-metadata",
    startedAt: "2026-03-27T00:15:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-invalid-metadata",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.equal(runAutomationAgentCalls, 0);
  assert.deepEqual(result, {
    success: false,
    error: "Missing pull request context for PR review",
    observabilityError: null,
  });
});

test("createAutomationJobTask records comment post failures for PR reviews", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          pr_number: 45,
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
    }),
    resolveGithubToken: async () => "review-token",
    upsertPrReviewTimelineComment: async () => ({
      id: 245,
      htmlUrl: "https://github.com/acme/widgets/pull/45#issuecomment-245",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error("GitHub comment post failed (403): permission denied");
    },
    getDurationMs: async () => 40,
    persistJobFailure: async () => true,
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
  });

  const result = await workflow({
    jobRunId: "job-pr-comment-post-failed",
    startedAt: "2026-03-27T00:16:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "pr_review",
      sourceId: "assignment-pr-comment-post-failed",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "GitHub comment post failed (403): permission denied",
    observabilityError: null,
  });
  assert.deepEqual(controlDispatchEvent, {
    outcome: "failed",
    reason: "PR_REVIEW_COMMENT_POST_FAILED",
    metadata: {
      review_outcome: "PR_REVIEW_COMMENT_POST_FAILED",
      review_outcome_label: "Comment post failed",
      error: "GitHub comment post failed (403): permission denied",
      review_timeline_comment_posted: true,
      review_timeline_comment_id: 245,
      review_timeline_comment_url:
        "https://github.com/acme/widgets/pull/45#issuecomment-245",
      review_timeline_comment_error: null,
      review_github_review_posted: false,
      review_github_review_id: null,
      review_github_review_url: null,
      review_github_review_error: null,
      review_github_inline_comments_count: 0,
      review_check_run_id: null,
      review_check_run_url: null,
      review_check_run_completed: false,
      review_check_run_conclusion: null,
      review_check_run_error: null,
    },
  });
});

test("createAutomationJobTask treats a lost success persistence race as cancellation", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let aiCallLogged = false;
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { issue_number: 8 },
        assignmentType: "issue_comment",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
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
    }),
    resolveGithubToken: async () => "github-token",
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => ({
      text: "done",
      usage: {
        inputTokens: 3,
        outputTokens: 5,
      },
      steps: [],
    }),
    getDurationMs: async () => 88,
    persistJobSuccess: async () => false,
    tryLogAiCall: async () => {
      aiCallLogged = true;
      return null;
    },
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow({
    jobRunId: "job-cancel-race-success",
    startedAt: "2026-03-27T00:10:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-cancel-race-success",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "JOB_RUN_CANCELLED",
  });
  assert.equal(aiCallLogged, false);
  assert.equal(released, false);
});

test("createAutomationJobTask treats a lost failure persistence race as cancellation", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  let aiCallLogged = false;
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { issue_number: 9 },
        assignmentType: "issue_comment",
        skillId: null,
        agent: {
          model: "minimax/minimax-m2.5",
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
    }),
    resolveGithubToken: async () => null,
    getDurationMs: async () => 55,
    persistJobFailure: async () => false,
    tryLogAiCall: async () => {
      aiCallLogged = true;
      return null;
    },
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow({
    jobRunId: "job-cancel-race-failure",
    startedAt: "2026-03-27T00:15:00.000Z",
    releasedScope: {
      sourceKind: "assignment",
      sourceType: "issue_comment",
      sourceId: "assignment-cancel-race-failure",
      repoId: "repo-123",
      installationId: 123,
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "JOB_RUN_CANCELLED",
  });
  assert.equal(aiCallLogged, false);
  assert.equal(released, false);
});

test("resolvePullRequestNumber falls back to issue_number when is_pr is true", async () => {
  const { resolvePullRequestNumber } = await loadAutomationJobWorkflowModule();

  assert.equal(
    resolvePullRequestNumber({ pr_number: 12, issue_number: 99 }),
    12,
    "pr_number takes precedence when present"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: 76, is_pr: true }),
    76,
    "PR-flagged comment metadata maps issue_number to the PR number"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: 76, is_pr: false }),
    null,
    "issue_number on a non-PR issue does not become a PR number"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: "42", is_pr: true }),
    42,
    "string issue_number is parsed when is_pr is true"
  );
  assert.equal(
    resolvePullRequestNumber({ issue_number: "not-a-number", is_pr: true }),
    null,
    "non-numeric issue_number is rejected"
  );
});

test("synthesizeReviewOutcomeFromComment converts a comment body into a single-finding review", async () => {
  const { synthesizeReviewOutcomeFromComment } =
    await loadAutomationJobWorkflowModule();

  const review = synthesizeReviewOutcomeFromComment({
    comment_body: "@mogplex please fix the nullable widget guard",
    comment_author: "charlesrhoward",
  });

  assert.deepEqual(review, {
    hasIssues: true,
    summary: "@mogplex please fix the nullable widget guard",
    commentBody: "@mogplex please fix the nullable widget guard",
    affectedFiles: [],
    findings: [],
  });
});

test("synthesizeReviewOutcomeFromComment returns null when the comment body is missing or empty", async () => {
  const { synthesizeReviewOutcomeFromComment } =
    await loadAutomationJobWorkflowModule();

  assert.equal(synthesizeReviewOutcomeFromComment({}), null);
  assert.equal(
    synthesizeReviewOutcomeFromComment({ comment_body: "   " }),
    null
  );
  assert.equal(synthesizeReviewOutcomeFromComment({ comment_body: 42 }), null);
});

test("createAutomationJobTask persists flow_node_runs for every operator node type", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  const insertedNodeTypes: string[] = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          issue_number: 21,
          issue_title: "Operator persistence regression fixture",
          package: "web",
        },
        assignmentType: "issue_triage",
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
        flowId: "flow-operators",
        flowVersionId: "flow-version-operators",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "Start",
                event: "issue_opened",
                isDefault: false,
              },
            },
            {
              id: "condition-1",
              type: "condition",
              position: { x: 240, y: 0 },
              data: {
                label: "If never set",
                mode: "all",
                rules: [
                  {
                    field: "metadata.never_set",
                    operator: "exists",
                    value: "",
                  },
                ],
              },
            },
            {
              id: "parallel-1",
              type: "parallel",
              position: { x: 480, y: 120 },
              data: {
                label: "Fan out",
              },
            },
            {
              id: "delay-a",
              type: "delay",
              position: { x: 720, y: 60 },
              data: {
                label: "Wait A",
                duration: 0,
                unit: "seconds",
              },
            },
            {
              id: "delay-b",
              type: "delay",
              position: { x: 720, y: 180 },
              data: {
                label: "Wait B",
                duration: 0,
                unit: "seconds",
              },
            },
            {
              id: "join-1",
              type: "join",
              position: { x: 960, y: 120 },
              data: {
                label: "Merge",
                policy: "wait_for_all",
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 1200, y: 0 },
              data: {
                label: "Done",
              },
            },
            {
              id: "action-1",
              type: "action",
              position: { x: 1080, y: 120 },
              data: {
                label: "Test package",
                operation: "sandbox.run_command",
                command: "pnpm --filter web test",
                workingDirectory: null,
              },
            },
          ],
          edges: [
            {
              id: "edge-start-condition",
              source: "start-1",
              target: "condition-1",
            },
            {
              id: "edge-condition-end",
              source: "condition-1",
              target: "end-1",
              sourceHandle: "true",
            },
            {
              id: "edge-condition-parallel",
              source: "condition-1",
              target: "parallel-1",
              sourceHandle: "false",
            },
            {
              id: "edge-parallel-delay-a",
              source: "parallel-1",
              target: "delay-a",
            },
            {
              id: "edge-parallel-delay-b",
              source: "parallel-1",
              target: "delay-b",
            },
            {
              id: "edge-delay-a-join",
              source: "delay-a",
              target: "join-1",
            },
            {
              id: "edge-delay-b-join",
              source: "delay-b",
              target: "join-1",
            },
            {
              id: "edge-join-action",
              source: "join-1",
              target: "action-1",
            },
            {
              id: "edge-action-end",
              source: "action-1",
              target: "end-1",
            },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    runFlowAction: async ({ action }) => {
      assert.equal(action.operation, "sandbox.run_command");
      assert.equal(action.command, "pnpm --filter web test");
      return {
        summary: "Command completed",
        output: { exit_code: 0, stdout: "ok" },
      };
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
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
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: "2026-04-30T21:00:00.000Z",
          },
          { status: 201 }
        );
      }

      if (method === "PATCH") {
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }

    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-flow-operator-persistence",
      startedAt: "2026-04-30T21:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-operators",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    const capturedDispatch =
      controlDispatchEvent as unknown as CapturedControlDispatchEvent | null;
    assert.equal(capturedDispatch?.outcome, "completed");

    const seen = new Set(insertedNodeTypes);
    for (const expected of [
      "start",
      "condition",
      "parallel",
      "delay",
      "join",
      "action",
      "end",
    ]) {
      assert.ok(
        seen.has(expected),
        `expected flow_node_runs insert with node_type "${expected}", saw ${JSON.stringify(insertedNodeTypes)}`
      );
    }
    // delay fan-out emits two delay rows
    const delayCount = insertedNodeTypes.filter(
      (type) => type === "delay"
    ).length;
    assert.equal(delayCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask routes action failures through the error edge", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  const completedStatuses: string[] = [];
  let nodeRunSequence = 0;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "issue_opened" },
        assignmentType: "issue_triage",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-action-failure",
          user_id: "user-action-failure",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-action-failure",
        flowVersionId: "flow-version-action-failure",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "issue_opened" },
            },
            {
              id: "action-1",
              type: "action",
              position: { x: 240, y: 0 },
              data: {
                label: "Notify",
                operation: "slack.send_message",
                teamId: "T123",
                channelId: "C123",
                channelName: "alerts",
                message: "Build failed",
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 180 },
              data: {
                label: "Record failure",
                assignments: [
                  { key: "notification_status", template: "failed" },
                ],
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "action-1" },
            { id: "e2", source: "action-1", target: "end-1" },
            {
              id: "e3",
              source: "action-1",
              target: "recover-1",
              sourceHandle: "error",
            },
            { id: "e4", source: "recover-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runFlowAction: async () => {
      throw new Error("Slack workspace unavailable");
    },
    getDurationMs: async () => 10,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
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

    if (!requestUrl.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${requestUrl}`);
    }
    if (requestUrl.includes("/rest/v1/flow_node_runs")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (method === "POST") {
        insertedNodeTypes.push(String(body.node_type));
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: "2026-07-23T16:00:00.000Z",
          },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        completedStatuses.push(String(body.status));
        return Response.json({ id: "updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-action-failure",
      startedAt: "2026-07-23T16:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-action-failure",
        repoId: "repo-action-failure",
        installationId: 77,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.deepEqual(insertedNodeTypes, [
      "start",
      "action",
      "set_variable",
      "end",
    ]);
    assert.ok(completedStatuses.includes("failed"));
    assert.ok(completedStatuses.includes("success"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask resumes an await_event node when the wait token completes", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  const completedStatuses: string[] = [];
  const createWaitCalls: Array<Record<string, unknown>> = [];
  const finalizeWaitCalls: Array<{ waitId: string; status: string }> = [];

  let nodeRunSequence = 0;
  let createTokenCount = 0;
  let waitForTokenCount = 0;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-await",
          user_id: "user-await",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-await",
        flowVersionId: "flow-version-await",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait for ready",
                config: {
                  kind: "github_label_added",
                  labelName: "ready",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "hours" },
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => {
        createTokenCount += 1;
        return { id: "tok-await-1" };
      },
      waitForToken: async <T>() => {
        waitForTokenCount += 1;
        return {
          ok: true as const,
          output: { delivery_id: "d-1", action: "labeled" } as T,
        };
      },
    },
    waitStore: {
      createWait: async (input) => {
        createWaitCalls.push(input as unknown as Record<string, unknown>);
        return { id: "wait-row-1" };
      },
      finalizeWait: async (input) => {
        finalizeWaitCalls.push(input);
      },
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: new Date().toISOString(),
          },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.status === "string") {
          completedStatuses.push(body.status);
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-1",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-await",
        repoId: "repo-await",
        installationId: 77,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.equal(createTokenCount, 1);
    assert.equal(waitForTokenCount, 1);
    assert.equal(createWaitCalls.length, 1);
    assert.equal(createWaitCalls[0]?.resumeToken, "tok-await-1");
    assert.equal(createWaitCalls[0]?.nodeId, "await-1");
    assert.deepEqual(finalizeWaitCalls, [
      { waitId: "wait-row-1", status: "resumed" },
    ]);
    assert.ok(insertedNodeTypes.includes("await_event"));
    // The await_event row completes as success once the token is resumed.
    assert.ok(completedStatuses.includes("success"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask fails an await_event node when the wait times out", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const completedStatuses: Array<{
    status: string;
    error: string | null;
  }> = [];
  const finalizeWaitCalls: Array<{ waitId: string; status: string }> = [];
  let persistFailureCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-timeout",
          user_id: "user-timeout",
          full_name: "acme/widgets",
          github_installation_id: 88,
        },
      },
      flow: {
        flowId: "flow-timeout",
        flowVersionId: "flow-version-timeout",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 5, unit: "minutes" },
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      throw new Error("persistJobSuccess should not be called on timeout");
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      persistFailureCalled = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-timeout-1" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-2" }),
      finalizeWait: async (input) => {
        finalizeWaitCalls.push(input);
      },
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        return Response.json(
          { id: "node-run-1", started_at: new Date().toISOString() },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.status === "string") {
          completedStatuses.push({
            status: body.status,
            error: typeof body.error === "string" ? body.error : null,
          });
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-timeout",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-timeout",
        repoId: "repo-timeout",
        installationId: 88,
      },
    });

    assert.equal(result.success, false);
    assert.equal(persistFailureCalled, true);
    assert.deepEqual(finalizeWaitCalls, [
      { waitId: "wait-row-2", status: "expired" },
    ]);
    const failedAwaitRow = completedStatuses.find(
      (entry) => entry.status === "failed"
    );
    assert.ok(
      failedAwaitRow,
      "expected a failed flow_node_run for await_event"
    );
    assert.ok(failedAwaitRow!.error?.includes("timed out"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask routes await_event timeout failures to a downstream error edge when one is wired", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  // Map node-run id -> node id so PATCH status matches a specific node.
  const nodeRunIdToNodeId = new Map<string, string>();
  const completedByNodeId = new Map<string, string>();
  let nodeRunSequence = 0;
  let persistedSuccess = false;
  let persistFailureCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-recover",
          user_id: "user-recover",
          full_name: "acme/widgets",
          github_installation_id: 99,
        },
      },
      flow: {
        flowId: "flow-recover",
        flowVersionId: "flow-version-recover",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait for ship",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "minutes" },
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 200 },
              data: {
                label: "Record timeout",
                assignments: [{ key: "await_status", template: "timed_out" }],
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
            {
              id: "e3",
              source: "await-1",
              target: "recover-1",
              sourceHandle: "error",
            },
            { id: "e4", source: "recover-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 50,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      persistFailureCalled = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-recover-1" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-recover" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        nodeRunSequence += 1;
        const id = `node-run-${nodeRunSequence}`;
        if (typeof body.node_id === "string") {
          nodeRunIdToNodeId.set(id, body.node_id);
        }
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        return Response.json(
          { id, started_at: new Date().toISOString() },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const match = url.match(/flow_node_runs.*id=eq\.([^&]+)/);
        const nodeRunId = match ? decodeURIComponent(match[1]) : null;
        const nodeId = nodeRunId
          ? (nodeRunIdToNodeId.get(nodeRunId) ?? null)
          : null;
        if (nodeId && typeof body.status === "string") {
          completedByNodeId.set(nodeId, body.status);
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-recover",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-recover",
        repoId: "repo-recover",
        installationId: 99,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.equal(persistFailureCalled, false);
    // The failed await node should still record as "failed" — only the
    // outgoing token signal is rerouted.
    assert.equal(completedByNodeId.get("await-1"), "failed");
    // The recovery node executes and records success.
    assert.equal(completedByNodeId.get("recover-1"), "success");
    assert.ok(insertedNodeTypes.includes("set_variable"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask preserves fail-fast when no error edge is wired", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let persistedFailure = false;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-failfast",
          user_id: "user-failfast",
          full_name: "acme/widgets",
          github_installation_id: 100,
        },
      },
      flow: {
        flowId: "flow-failfast",
        flowVersionId: "flow-version-failfast",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "minutes" },
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 50,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      persistedFailure = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-failfast" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-failfast" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        return Response.json(
          { id: "node-run", started_at: new Date().toISOString() },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-failfast",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-failfast",
        repoId: "repo-failfast",
        installationId: 100,
      },
    });

    assert.equal(result.success, false);
    assert.equal(persistedFailure, true);
    assert.equal(persistedSuccess, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask does not route cancellation to a downstream error edge", async () => {
  const { createAutomationJobTask, JobRunCancelledError } =
    await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  let persistedSuccess = false;
  let persistedFailure: { error: string } | null = null;
  let recoverNodeRan = false;
  let cancellationFired = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-cancel",
          user_id: "user-cancel",
          full_name: "acme/widgets",
          github_installation_id: 101,
        },
      },
      flow: {
        flowId: "flow-cancel",
        flowVersionId: "flow-version-cancel",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "minutes" },
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 200 },
              data: {
                label: "Record cancel",
                assignments: [{ key: "await_status", template: "cancelled" }],
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
            {
              id: "e3",
              source: "await-1",
              target: "recover-1",
              sourceHandle: "error",
            },
            { id: "e4", source: "recover-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 50,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async (input) => {
      persistedFailure = { error: input.error };
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-cancel" }),
      // Simulate a cancellation thrown from inside the wait by throwing the
      // executor's cancellation error — the catch block should NOT route this
      // to the recovery edge.
      waitForToken: async () => {
        cancellationFired = true;
        throw new JobRunCancelledError();
      },
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-cancel" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
          if (body.node_id === "recover-1") recoverNodeRan = true;
        }
        return Response.json(
          {
            id: `node-run-${insertedNodeTypes.length}`,
            started_at: new Date().toISOString(),
          },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-cancel",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-cancel",
        repoId: "repo-cancel",
        installationId: 101,
      },
    });

    assert.equal(cancellationFired, true);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : null,
      "JOB_RUN_CANCELLED",
      "cancellation must surface as JOB_RUN_CANCELLED, not be caught by error edge"
    );
    assert.equal(persistedSuccess, false);
    assert.equal(recoverNodeRan, false);
    // Cancellation does not flow through persistJobFailure — the wrapper
    // releases queued jobs and returns directly.
    assert.equal(persistedFailure, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask wait_for_any join fires after the first active branch and ignores slower branches", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  // Map node-run id -> { node_id, node_type } so PATCH bodies can be matched
  // back to the specific node that emitted them.
  const nodeRunCatalog = new Map<
    string,
    { nodeId: string; nodeType: string }
  >();
  const completedByNodeId: Array<{
    nodeId: string;
    nodeType: string;
    status: string;
    output: Record<string, unknown> | null;
  }> = [];
  let persistedSuccess = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-join-any",
          user_id: "user-join-any",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 91,
        },
      },
      flow: {
        flowId: "flow-join-any",
        flowVersionId: "flow-version-join-any",
        // start → parallel
        //   ├─ delay-fast → join (depth 1)
        //   └─ delay-slow1 → delay-slow2 → join (depth 2)
        // → end
        // wait_for_any policy means the join fires after delay-fast emits.
        // delay-slow2 still emits after the join is processed; that token
        // should be discarded by the executor.
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "parallel-1",
              type: "parallel",
              position: { x: 200, y: 0 },
              data: { label: "Fan out" },
            },
            {
              id: "delay-fast",
              type: "delay",
              position: { x: 400, y: -80 },
              data: { label: "Fast", duration: 0, unit: "seconds" },
            },
            {
              id: "delay-slow1",
              type: "delay",
              position: { x: 400, y: 80 },
              data: { label: "Slow 1", duration: 0, unit: "seconds" },
            },
            {
              id: "delay-slow2",
              type: "delay",
              position: { x: 600, y: 80 },
              data: { label: "Slow 2", duration: 0, unit: "seconds" },
            },
            {
              id: "join-1",
              type: "join",
              position: { x: 800, y: 0 },
              data: { label: "Race", policy: "wait_for_any" },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 1000, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "parallel-1" },
            { id: "e2", source: "parallel-1", target: "delay-fast" },
            { id: "e3", source: "parallel-1", target: "delay-slow1" },
            { id: "e4", source: "delay-fast", target: "join-1" },
            { id: "e5", source: "delay-slow1", target: "delay-slow2" },
            { id: "e6", source: "delay-slow2", target: "join-1" },
            { id: "e7", source: "join-1", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
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
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok" }),
      waitForToken: async <T>() => ({ ok: true as const, output: {} as T }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        nodeRunSequence += 1;
        const id = `node-run-${nodeRunSequence}`;
        nodeRunCatalog.set(id, {
          nodeId: String(body.node_id ?? ""),
          nodeType: String(body.node_type ?? ""),
        });
        return Response.json(
          { id, started_at: "2026-04-30T22:00:00.000Z" },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const id = idMatch?.[1] ?? "";
        const catalogEntry = nodeRunCatalog.get(id);
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (catalogEntry && typeof body.status === "string") {
          completedByNodeId.push({
            nodeId: catalogEntry.nodeId,
            nodeType: catalogEntry.nodeType,
            status: body.status,
            output: (body.output ?? null) as Record<string, unknown> | null,
          });
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-join-any",
      startedAt: "2026-04-30T22:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-join-any",
        repoId: "repo-join-any",
        installationId: 91,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    const capturedDispatch =
      controlDispatchEvent as unknown as CapturedControlDispatchEvent | null;
    assert.equal(capturedDispatch?.outcome, "completed");

    const joinCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "join-1"
    );
    assert.ok(
      joinCompletion,
      `expected a flow_node_runs PATCH for join-1; saw ${JSON.stringify(completedByNodeId)}`
    );
    assert.equal(joinCompletion!.status, "success");
    const output = joinCompletion!.output ?? {};
    assert.equal(output.policy, "wait_for_any");
    assert.equal(output.reason, "policy_satisfied");
    // The join fired after delay-fast's token arrived; delay-slow2's token
    // hadn't arrived yet, so it shows up in pending_from.
    assert.deepEqual(output.active_from, ["Fast"]);
    assert.deepEqual(output.pending_from, ["Slow 2"]);
    assert.equal(output.emitted_after, 1);

    // The whole flow should still complete (end ran), even though delay-slow2
    // emitted to a join that was already processed — that token is dropped.
    const endCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "end-1"
    );
    assert.ok(endCompletion, "expected end-1 to be reached");
    assert.equal(endCompletion!.status, "success");

    // The join must only have completed once.
    const joinCompletions = completedByNodeId.filter(
      (entry) => entry.nodeId === "join-1"
    );
    assert.equal(joinCompletions.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask state operators feed transformed values into downstream If nodes", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  const nodeRunCatalog = new Map<
    string,
    { nodeId: string; nodeType: string }
  >();
  const completedByNodeId: Array<{
    nodeId: string;
    nodeType: string;
    status: string;
    output: Record<string, unknown> | null;
  }> = [];
  let persistedSuccess = false;
  let capturedFailureMessage: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          source_type: "pr_opened",
          pr_number: 7,
          changed_files: ["app/page.tsx", "lib/page.test.ts"],
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-state",
          user_id: "user-state",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 91,
        },
      },
      flow: {
        flowId: "flow-state",
        flowVersionId: "flow-version-state",
        // start → set_variable → transform → If → (then|else) → end
        // No agents: this test exercises the deterministic state path.
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "set-1",
              type: "set_variable",
              position: { x: 200, y: 0 },
              data: {
                label: "Capture",
                assignments: [
                  {
                    key: "pr_number",
                    template: "{{ metadata.pr_number }}",
                  },
                  {
                    key: "summary",
                    template: "PR #{{ metadata.pr_number }}",
                  },
                ],
              },
            },
            {
              id: "transform-1",
              type: "transform",
              position: { x: 400, y: 0 },
              data: {
                label: "Derive",
                assignments: [
                  {
                    key: "tests_changed",
                    source: "metadata.changed_files",
                    operation: "files_match_glob",
                    argument: "**/*.test.ts",
                  },
                  {
                    key: "file_count",
                    source: "metadata.changed_files",
                    operation: "array_length",
                  },
                  {
                    key: "copied_pr_number",
                    source: "state.pr_number",
                    operation: "copy",
                  },
                ],
              },
            },
            {
              id: "if-1",
              type: "condition",
              position: { x: 600, y: 0 },
              data: {
                label: "Tests changed",
                mode: "all",
                rules: [
                  {
                    field: "state.tests_changed",
                    operator: "equals",
                    value: "true",
                  },
                ],
              },
            },
            {
              id: "end-then",
              type: "end",
              position: { x: 800, y: -80 },
              data: { label: "Done (then)" },
            },
            {
              id: "end-else",
              type: "end",
              position: { x: 800, y: 80 },
              data: { label: "Done (else)" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "set-1" },
            { id: "e2", source: "set-1", target: "transform-1" },
            { id: "e3", source: "transform-1", target: "if-1" },
            {
              id: "e4",
              source: "if-1",
              target: "end-then",
              sourceHandle: "true",
            },
            {
              id: "e5",
              source: "if-1",
              target: "end-else",
              sourceHandle: "false",
            },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async (input) => {
      capturedFailureMessage =
        (input as { error?: string })?.error ?? "(no error)";
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok" }),
      waitForToken: async <T>() => ({ ok: true as const, output: {} as T }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://api.github.com")) {
      // The end-of-run summary tries to post a GitHub timeline comment because
      // the metadata exposes a pr_number. Stub a successful comment create so
      // the run focuses on flow_node_runs assertions.
      if (method === "POST") {
        return Response.json(
          {
            id: 12345,
            html_url:
              "https://github.com/acme/widgets/issues/7#issuecomment-12345",
          },
          { status: 201 }
        );
      }
      return Response.json([], { status: 200 });
    }
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        nodeRunSequence += 1;
        const id = `node-run-${nodeRunSequence}`;
        nodeRunCatalog.set(id, {
          nodeId: String(body.node_id ?? ""),
          nodeType: String(body.node_type ?? ""),
        });
        return Response.json(
          { id, started_at: "2026-05-01T12:00:00.000Z" },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const id = idMatch?.[1] ?? "";
        const catalogEntry = nodeRunCatalog.get(id);
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (catalogEntry && typeof body.status === "string") {
          completedByNodeId.push({
            nodeId: catalogEntry.nodeId,
            nodeType: catalogEntry.nodeType,
            status: body.status,
            output: (body.output ?? null) as Record<string, unknown> | null,
          });
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-state",
      startedAt: "2026-05-01T12:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-state",
        repoId: "repo-state",
        installationId: 91,
      },
    });

    assert.equal(
      result.success,
      true,
      `expected success; got failure: ${capturedFailureMessage ?? "<none>"}`
    );
    assert.equal(persistedSuccess, true);

    // set_variable persisted both assignments with type-correct values.
    const setCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "set-1"
    );
    assert.ok(setCompletion, "expected set-1 to complete");
    assert.equal(setCompletion!.nodeType, "set_variable");
    assert.equal(setCompletion!.status, "success");
    const setOutput = setCompletion!.output ?? {};
    const assignments = setOutput.assignments as Array<{
      key: string;
      template: string;
      value: unknown;
    }>;
    assert.deepEqual(assignments, [
      {
        key: "pr_number",
        template: "{{ metadata.pr_number }}",
        // Whole-string substitution preserves the source number type.
        value: 7,
      },
      {
        key: "summary",
        template: "PR #{{ metadata.pr_number }}",
        value: "PR #7",
      },
    ]);

    const transformCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "transform-1"
    );
    assert.ok(transformCompletion, "expected transform-1 to complete");
    assert.equal(transformCompletion!.nodeType, "transform");
    assert.equal(transformCompletion!.status, "success");
    assert.deepEqual(transformCompletion!.output?.transformations, [
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
        value: true,
      },
      {
        key: "file_count",
        source: "metadata.changed_files",
        operation: "array_length",
        value: 2,
      },
      {
        key: "copied_pr_number",
        source: "state.pr_number",
        operation: "copy",
        value: 7,
      },
    ]);

    // The If node read the Transform result and chose the then branch.
    const ifCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "if-1"
    );
    assert.ok(ifCompletion, "expected if-1 to complete");
    assert.equal(ifCompletion!.status, "success");
    assert.equal(ifCompletion?.output?.branch, "then");

    // The then branch's end ran; the else branch's end was skipped.
    const thenEnd = completedByNodeId.find(
      (entry) => entry.nodeId === "end-then"
    );
    const elseEnd = completedByNodeId.find(
      (entry) => entry.nodeId === "end-else"
    );
    assert.ok(thenEnd, "expected end-then to complete");
    assert.equal(thenEnd!.status, "success");
    assert.ok(elseEnd, "expected end-else to be observed");
    assert.equal(elseEnd!.status, "skipped");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
