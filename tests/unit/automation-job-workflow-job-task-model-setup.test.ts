import assert from "node:assert/strict";
import { AUTOMATION_MODEL_TIMEOUT_FLOOR_MS } from "../../lib/workflows/automation-model-execution";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
