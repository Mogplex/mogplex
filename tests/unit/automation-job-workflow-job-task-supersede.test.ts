import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

const HEAD_REF = "dependabot/npm_and_yarn/left-pad-1.0.0";

function makePrContext() {
  return {
    metadata: {
      source_type: "pr_opened",
      pr_number: 42,
      head_ref: HEAD_REF,
      head_sha: "cafebabe",
    },
    assignmentType: "pr_review",
    skillId: null,
    agent: { model: "openai/gpt-5.4", system_prompt: null },
    repo: {
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: 123,
    },
  };
}

function makeInput(jobRunId: string) {
  return {
    jobRunId,
    startedAt: "2026-08-16T00:12:00.000Z",
    releasedScope: {
      sourceKind: "assignment" as const,
      sourceType: "pr_opened",
      sourceId: "assignment-pr-supersede",
      repoId: "repo-123",
      installationId: 123,
    },
  };
}

// Reads go through get() so TypeScript does not narrow the captured value to
// null (assignments happen inside executor callbacks).
function captureControlDispatchEvents() {
  let captured: CapturedControlDispatchEvent | null = null;
  return {
    record: async (input: {
      outcome: "completed" | "failed" | "cancelled";
      reason?: string | null;
      metadata?: Record<string, unknown> | null;
    }) => {
      captured = {
        outcome: input.outcome,
        reason: input.reason,
        metadata: input.metadata,
      };
    },
    get: () => captured,
  };
}

test("createAutomationJobTask supersedes a PR review when the PR closed before execution started", async () => {
  const { createAutomationJobTask, JOB_RUN_CANCELLED } =
    await loadAutomationJobWorkflowModule();

  let checkRunCreated = false;
  let persistedFailure = false;
  let persistedCancelled: {
    reason: string;
    cancelError: string | null;
  } | null = null;
  const dispatchEvents = captureControlDispatchEvents();
  let released = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({ context: makePrContext() }),
    resolveGithubToken: async () => "review-token",
    fetchPrLiveness: async () => ({ alive: false, reason: "pr_closed" }),
    createPrReviewCheckRun: async () => {
      checkRunCreated = true;
      return { id: 9001, htmlUrl: "https://github.com/acme/widgets/runs/9001" };
    },
    persistJobCancelled: async (input) => {
      persistedCancelled = {
        reason: input.reason,
        cancelError: input.cancelError,
      };
      return null;
    },
    persistJobFailure: async () => {
      persistedFailure = true;
      return true;
    },
    recordControlDispatchEvent: dispatchEvents.record,
    releaseQueuedJobs: async () => {
      released = true;
      return [];
    },
  });

  const result = await workflow(makeInput("job-pr-superseded-preflight"));

  assert.deepEqual(result, { success: false, error: JOB_RUN_CANCELLED });
  assert.equal(checkRunCreated, false);
  assert.equal(persistedFailure, false);
  assert.deepEqual(persistedCancelled, {
    reason: "PR #42 was closed before the review completed",
    cancelError: null,
  });
  assert.equal(dispatchEvents.get()?.outcome, "cancelled");
  assert.equal(dispatchEvents.get()?.reason, "PR_REVIEW_SUPERSEDED");
  assert.equal(released, true);
});

test("createAutomationJobTask supersedes a PR review when the clone fails because the head branch vanished", async () => {
  const { createAutomationJobTask, JOB_RUN_CANCELLED } =
    await loadAutomationJobWorkflowModule();

  let persistedFailure = false;
  let persistedCancelled: { reason: string } | null = null;
  const dispatchEvents = captureControlDispatchEvents();
  const completedCheckRuns: Array<{
    checkRunId: number;
    conclusion: string;
  }> = [];

  let livenessChecks = 0;
  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({ context: makePrContext() }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 9001,
      htmlUrl: "https://github.com/acme/widgets/runs/9001",
    }),
    completePrReviewCheckRun: async (input) => {
      completedCheckRuns.push({
        checkRunId: input.checkRunId,
        conclusion: input.conclusion,
      });
      return {
        id: input.checkRunId,
        htmlUrl: "https://github.com/acme/widgets/runs/9001",
      };
    },
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error(
        "Vercel rejected the sandbox request: bad_request: git clone failed"
      );
    },
    // Alive at pre-flight, dead by the failure-path re-check — the PR's head
    // branch was deleted while the run was executing.
    fetchPrLiveness: async () =>
      ++livenessChecks === 1
        ? { alive: true }
        : { alive: false, reason: "head_branch_deleted" },
    persistJobCancelled: async (input) => {
      persistedCancelled = { reason: input.reason };
      return null;
    },
    persistJobFailure: async () => {
      persistedFailure = true;
      return true;
    },
    getDurationMs: async () => 10,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: dispatchEvents.record,
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow(makeInput("job-pr-superseded-clone-failed"));

  assert.deepEqual(result, { success: false, error: JOB_RUN_CANCELLED });
  assert.equal(persistedFailure, false);
  assert.deepEqual(persistedCancelled, {
    reason: `PR head branch ${HEAD_REF} was deleted`,
  });
  assert.deepEqual(completedCheckRuns, [
    { checkRunId: 9001, conclusion: "neutral" },
  ]);
  assert.equal(dispatchEvents.get()?.outcome, "cancelled");
  assert.equal(dispatchEvents.get()?.reason, "PR_REVIEW_SUPERSEDED");
});

test("createAutomationJobTask keeps a clone failure as a failure while the PR is still alive", async () => {
  const { createAutomationJobTask, JOB_RUN_CANCELLED } =
    await loadAutomationJobWorkflowModule();

  let persistedCancelled = false;
  let persistedFailureError: string | null = null;
  const dispatchEvents = captureControlDispatchEvents();

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({ context: makePrContext() }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 9001,
      htmlUrl: "https://github.com/acme/widgets/runs/9001",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/9001",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 224,
      htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-224",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error(
        "Vercel rejected the sandbox request: bad_request: git clone failed"
      );
    },
    fetchPrLiveness: async () => ({ alive: true }),
    persistJobCancelled: async () => {
      persistedCancelled = true;
      return null;
    },
    persistJobFailure: async (input) => {
      persistedFailureError = input.error;
      return true;
    },
    getDurationMs: async () => 10,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: dispatchEvents.record,
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow(makeInput("job-pr-clone-failed-alive"));

  assert.equal(result.success, false);
  assert.notEqual("error" in result ? result.error : null, JOB_RUN_CANCELLED);
  assert.equal(persistedCancelled, false);
  assert.match(persistedFailureError ?? "", /git clone failed/i);
  assert.equal(dispatchEvents.get()?.outcome, "failed");
});

test("createAutomationJobTask keeps non-clone failures as failures even when the PR is dead", async () => {
  const { createAutomationJobTask, JOB_RUN_CANCELLED } =
    await loadAutomationJobWorkflowModule();

  let persistedCancelled = false;
  let persistedFailureError: string | null = null;
  const dispatchEvents = captureControlDispatchEvents();
  let livenessChecks = 0;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({ context: makePrContext() }),
    resolveGithubToken: async () => "review-token",
    createPrReviewCheckRun: async () => ({
      id: 9001,
      htmlUrl: "https://github.com/acme/widgets/runs/9001",
    }),
    completePrReviewCheckRun: async (input) => ({
      id: input.checkRunId,
      htmlUrl: "https://github.com/acme/widgets/runs/9001",
    }),
    upsertPrReviewTimelineComment: async () => ({
      id: 224,
      htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-224",
      created: true,
    }),
    resolveAutomationModel: async () => ({
      model: "openai/gpt-5.4",
      effectiveModelId: "openai/gpt-5.4",
    }),
    runAutomationAgent: async () => {
      throw new Error("Sandbox provisioning timed out");
    },
    // Alive at pre-flight, dead by the failure-path re-check.
    fetchPrLiveness: async () =>
      ++livenessChecks === 1
        ? { alive: true }
        : { alive: false, reason: "pr_closed" },
    persistJobCancelled: async () => {
      persistedCancelled = true;
      return null;
    },
    persistJobFailure: async (input) => {
      persistedFailureError = input.error;
      return true;
    },
    getDurationMs: async () => 10,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: dispatchEvents.record,
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  const result = await workflow(makeInput("job-pr-timeout-dead-pr"));

  assert.equal(result.success, false);
  assert.notEqual("error" in result ? result.error : null, JOB_RUN_CANCELLED);
  assert.equal(persistedCancelled, false);
  assert.match(persistedFailureError ?? "", /Sandbox provisioning timed out/);
  assert.equal(dispatchEvents.get()?.outcome, "failed");
});
