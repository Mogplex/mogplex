import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  loadGithubWebhookRoute,
  buildCheckRunRetryResponseInput,
  buildCheckRunRetryContext,
} from "./helpers/github-webhook-route-fixtures";

test("handleCIEvent ignores Mogplex PR review check runs", async () => {
  const { handleCIEvent } = await loadGithubWebhookRoute();

  const results = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "Mogplex PR Review",
      head_sha: "abc123",
      details_url: "https://github.com/webrenew/credit-renew/runs/1",
    },
  });

  assert.deepEqual(results, []);
});

test("isPrReviewCheckRunRetryRequest recognizes requested actions and rerequests", async () => {
  const { isPrReviewCheckRunRetryRequest } = await loadGithubWebhookRoute();

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "requested_action",
      requested_action: {
        identifier: "rerun-pr-review",
      },
      check_run: {
        name: "Mogplex PR Review",
      },
    }),
    true
  );

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "rerequested",
      check_run: {
        name: "Mogplex PR Review",
      },
    }),
    true
  );

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "requested_action",
      requested_action: {
        identifier: "rerun-pr-review",
      },
      check_run: {
        name: "Some Other Check",
      },
    }),
    false
  );
});

test("doesCheckRunRetryContextMatchWebhookRepo requires an exact repo match when repoId is present", async () => {
  const { doesCheckRunRetryContextMatchWebhookRepo } =
    await loadGithubWebhookRoute();

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: "repo-b",
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    false
  );

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: "repo-a",
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    true
  );

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: null,
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    true
  );
});

test("check-run rerun redelivery reuses its job and retries a missed start", async () => {
  const { buildCheckRunRetryResponse } = await loadGithubWebhookRoute();
  const idempotencyKeys: string[] = [];
  const startedJobIds: string[] = [];
  let enqueueCall = 0;
  let startCall = 0;
  const input = buildCheckRunRetryResponseInput();
  const deps = {
    loadJobRunRetryContext: async () => buildCheckRunRetryContext(),
    enqueueJobRunRetry: async (enqueueInput: { idempotencyKey?: string }) => {
      enqueueCall += 1;
      idempotencyKeys.push(enqueueInput.idempotencyKey ?? "");
      return enqueueCall === 1
        ? { jobRunId: "job-2", outcome: "queued" as const, reason: null }
        : {
            jobRunId: "job-2",
            outcome: "suppressed" as const,
            reason: "IDEMPOTENT_DUPLICATE",
          };
    },
    startWebhookJobRun: async (jobRunId: string) => {
      startCall += 1;
      startedJobIds.push(jobRunId);
      return startCall === 1
        ? {
            started: false,
            deferred: false,
            runtimeProvider: null,
            runtimeRunId: null,
            workflowRunId: null,
            status: "pending",
            reason: null,
            error: "transient dispatch failure",
          }
        : {
            started: true,
            deferred: false,
            runtimeProvider: "trigger",
            runtimeRunId: "trigger-run-2",
            workflowRunId: null,
            status: "pending",
            reason: null,
            error: null,
          };
    },
  };

  await buildCheckRunRetryResponse(input, deps as never);
  const redeliveryResponse = await buildCheckRunRetryResponse(
    input,
    deps as never
  );
  const redelivery = await redeliveryResponse!.json();

  assert.deepEqual(idempotencyKeys, [
    "github-webhook:check-run-rerun:91:delivery-rerun-1",
    "github-webhook:check-run-rerun:91:delivery-rerun-1",
  ]);
  assert.deepEqual(startedJobIds, ["job-2", "job-2"]);
  assert.equal(redelivery.queued, false);
  assert.equal(redelivery.suppressed, true);
  assert.equal(redelivery.reused, true);
  assert.equal(redelivery.started, true);
});

test("check-run rerun falls back to the original version when latest is unavailable", async () => {
  const { buildCheckRunRetryResponse } = await loadGithubWebhookRoute();
  const { JobRunRetryVersionError } = await import("../../lib/job-run-retry");
  const enqueueInputs: Array<{
    versionMode: string;
    idempotencyKey: string | undefined;
    metadataPatch: Record<string, unknown> | undefined;
  }> = [];

  const response = await buildCheckRunRetryResponse(
    buildCheckRunRetryResponseInput(),
    {
      loadJobRunRetryContext: async () => buildCheckRunRetryContext(),
      enqueueJobRunRetry: async (input) => {
        enqueueInputs.push({
          versionMode: input.versionMode,
          idempotencyKey: input.idempotencyKey,
          metadataPatch: input.metadataPatch,
        });
        if (input.versionMode === "latest_published") {
          throw new JobRunRetryVersionError();
        }
        return { jobRunId: "job-2", outcome: "queued", reason: null };
      },
      startWebhookJobRun: async () => ({
        started: true,
        deferred: false,
        runtimeProvider: "trigger",
        runtimeRunId: "trigger-run-2",
        workflowRunId: null,
        status: "pending",
        reason: null,
        error: null,
      }),
    }
  );
  const body = await response!.json();

  assert.deepEqual(
    enqueueInputs.map((input) => input.versionMode),
    ["latest_published", "same_version"]
  );
  assert.equal(
    enqueueInputs[0]?.idempotencyKey,
    enqueueInputs[1]?.idempotencyKey
  );
  assert.equal(
    enqueueInputs[1]?.metadataPatch?.retry_latest_published_unavailable,
    true
  );
  assert.equal(body.versionFallbackUsed, true);
  assert.equal(body.started, true);
});

test("startWebhookJobRun catches start failures and returns a non-throwing payload", async () => {
  const { startWebhookJobRun } = await loadGithubWebhookRoute();
  const originalConsoleError = console.error;

  console.error = () => {};

  try {
    const started = await startWebhookJobRun(
      "job-123",
      "manual_retry",
      async () => {
        throw new Error("transient start failure");
      }
    );

    assert.deepEqual(started, {
      started: false,
      deferred: false,
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
      status: "pending",
      reason: null,
      error: "transient start failure",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("POST rejects invalid signatures before parsing malformed payloads when a global secret is configured", async () => {
  const { POST } = await loadGithubWebhookRoute();
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";

  try {
    const response = await POST(
      new Request("http://localhost/api/webhooks/github", {
        method: "POST",
        headers: {
          "x-github-event": "push",
          "x-github-delivery": crypto.randomUUID(),
          "x-hub-signature-256": "sha256=invalid",
          "content-type": "application/json",
        },
        body: "{",
      })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid signature" });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});

test("handleCIEvent carries the failing branch through check_run and workflow_run metadata", async () => {
  const { handleCIEvent } = await loadGithubWebhookRoute();

  const checkResults = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "build",
      head_sha: "abc123",
      details_url: "https://github.com/acme/widgets/runs/1",
      check_suite: { head_branch: "release/2.x" },
    },
  });
  assert.equal(checkResults.length, 1);
  assert.equal(checkResults[0]?.metadata.head_branch, "release/2.x");

  const workflowResults = handleCIEvent("workflow_run", {
    action: "completed",
    workflow_run: {
      conclusion: "failure",
      name: "CI",
      head_sha: "abc123",
      html_url: "https://github.com/acme/widgets/actions/runs/7",
      id: 7,
      head_branch: "release/2.x",
    },
  });
  assert.equal(workflowResults.length, 1);
  assert.equal(workflowResults[0]?.metadata.head_branch, "release/2.x");

  const noBranch = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "build",
      head_sha: "abc123",
      details_url: "https://github.com/acme/widgets/runs/2",
    },
  });
  assert.equal(noBranch[0]?.metadata.head_branch, null);
});
