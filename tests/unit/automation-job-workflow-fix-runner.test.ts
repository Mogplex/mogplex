import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
} from "../../lib/workflows/automation-model-execution";
import {
  type CapturedGenerateTextOptions,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
