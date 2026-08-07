import assert from "node:assert/strict";
import { AUTOMATION_MODEL_TIMEOUT_FLOOR_MS } from "../../lib/workflows/automation-model-execution";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
