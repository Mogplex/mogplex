import assert from "node:assert/strict";
import { AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS } from "../../lib/workflows/automation-model-execution";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
