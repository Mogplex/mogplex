import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
