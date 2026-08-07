import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

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
