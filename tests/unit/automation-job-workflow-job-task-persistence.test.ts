import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedAiCallInput,
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";

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
