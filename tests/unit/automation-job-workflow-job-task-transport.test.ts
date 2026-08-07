import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "undici";
import {
  type CapturedControlDispatchEvent,
  type CapturedGenerateTextOptions,
  loadAutomationJobWorkflowModule,
  loadAiModelResolverModule,
  makeStep,
  restoreEnv,
} from "./helpers/automation-job-fixtures";

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
