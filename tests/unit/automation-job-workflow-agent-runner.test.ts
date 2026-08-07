import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
} from "../../lib/workflows/automation-model-execution";
import {
  type CapturedConstructorOptions,
  type CapturedGenerateTextOptions,
  loadAutomationJobWorkflowModule,
  makeStep,
  mockGithubPullRequestFetch,
} from "./helpers/automation-job-fixtures";

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
