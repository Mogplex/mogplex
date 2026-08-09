import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  JobRunRetryVersionError,
  type JobRunRetryContext,
} from "../../lib/job-run-retry";
import type { MogplexApiRepo } from "../../lib/mogplex-api/repos";

const REPO_ID = "11111111-1111-4111-8111-111111111111";

const VALID_AUTH = {
  ok: true as const,
  auth: {
    userId: "user-123",
    keyId: "key-1",
    scopes: ["read", "write"],
  },
};

const REPO: MogplexApiRepo = {
  id: REPO_ID,
  full_name: "octocat/hello",
  installation_id: 123,
  default_branch: "main",
  root_directory: null,
};

function buildRetryContext(
  overrides: Partial<JobRunRetryContext> = {}
): JobRunRetryContext {
  return {
    run: { id: "job-orig-1" } as unknown as JobRunRetryContext["run"],
    userId: "user-123",
    sourceType: "pull_request",
    assignmentId: null,
    triggerId: null,
    flowId: "flow-1",
    flowVersionId: "flow-version-1",
    repoId: REPO_ID,
    installationId: 123,
    metadata: null,
    ...overrides,
  };
}

type EnqueueInput = {
  retryContext: JobRunRetryContext;
  idempotencyKeyPrefix: string;
  idempotencyKey?: string;
  versionMode: string;
  metadataPatch?: Record<string, unknown>;
};

function createHandler(
  overrides: Record<string, unknown> = {},
  calls?: { enqueue: EnqueueInput[] }
) {
  const enqueueCalls = calls ?? { enqueue: [] };
  return import("../../app/api/v1/mogplex/pr-reviews/rerun/route").then(
    ({ createMogplexApiPrReviewRerunPostHandler }) =>
      createMogplexApiPrReviewRerunPostHandler({
        resolveApiKey: async () => VALID_AUTH,
        loadRepo: async () => REPO,
        loadGithubAccessToken: async () => "ghs_token",
        getPullRequestHeadSha: async () => "head-sha-1",
        getLatestPrReviewCheckRun: async () => ({
          id: 987,
          externalId: "job-orig-1",
        }),
        loadJobRunRetryContext: async () => buildRetryContext(),
        enqueueJobRunRetry: async (input) => {
          enqueueCalls.enqueue.push(input);
          return { jobRunId: "job-new-1", outcome: "queued", reason: null };
        },
        startAutomationJobRun: async () => ({
          started: true,
          status: "running",
        }),
        ...overrides,
      })
  );
}

function buildRequest(body: unknown) {
  return new NextRequest(
    "https://mogplex.example/api/v1/mogplex/pr-reviews/rerun",
    {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
}

function configureEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

test("pr review rerun queues a retry without an idempotency key and starts it", async () => {
  configureEnv();
  const calls = { enqueue: [] as EnqueueInput[] };
  const handler = await createHandler({}, calls);

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      queued: true,
      jobRunId: "job-new-1",
      prNumber: 42,
      repoId: REPO_ID,
      started: true,
      deferred: false,
      reason: null,
      status: "running",
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
      versionFallbackUsed: false,
    },
  });
  assert.equal(calls.enqueue.length, 1);
  const enqueue = calls.enqueue[0];
  assert.equal(enqueue.idempotencyKey, undefined);
  assert.equal(enqueue.idempotencyKeyPrefix, "pr-review-rerun:987");
  assert.equal(enqueue.versionMode, "latest_published");
  assert.deepEqual(enqueue.metadataPatch, {
    review_check_run_id: 987,
    review_check_run_rerun_requested: true,
    review_check_run_external_job_run_id: "job-orig-1",
    review_check_run_rerun_source: "api",
  });
});

test("pr review rerun falls back to same_version when latest published is unavailable", async () => {
  configureEnv();
  const calls = { enqueue: [] as EnqueueInput[] };
  const handler = await createHandler(
    {
      enqueueJobRunRetry: async (input: EnqueueInput) => {
        calls.enqueue.push(input);
        if (calls.enqueue.length === 1) {
          throw new JobRunRetryVersionError();
        }
        return { jobRunId: "job-new-1", outcome: "queued", reason: null };
      },
    },
    calls
  );

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { versionFallbackUsed: boolean; jobRunId: string };
  };
  assert.equal(body.data.versionFallbackUsed, true);
  assert.equal(body.data.jobRunId, "job-new-1");
  assert.equal(calls.enqueue.length, 2);
  assert.equal(calls.enqueue[1]?.versionMode, "same_version");
  assert.equal(
    calls.enqueue[1]?.metadataPatch?.["retry_latest_published_unavailable"],
    true
  );
});

test("pr review rerun rejects invalid bodies", async () => {
  configureEnv();
  const handler = await createHandler();

  for (const body of [
    { prNumber: 42 },
    { repoId: REPO_ID },
    { repoId: REPO_ID, prNumber: 0 },
    { repoId: REPO_ID, prNumber: 1.5 },
    { repoId: "  ", prNumber: 42 },
  ]) {
    const response = await handler(buildRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    const parsed = (await response.json()) as {
      error: { code: string };
    };
    assert.equal(parsed.error.code, "BAD_REQUEST");
  }

  const invalidJson = await handler(buildRequest("not-json"));
  assert.equal(invalidJson.status, 400);
});

test("pr review rerun returns 404 when the repo is not owned by the user", async () => {
  configureEnv();
  let githubCalled = false;
  const handler = await createHandler({
    loadRepo: async () => null,
    getPullRequestHeadSha: async () => {
      githubCalled = true;
      return "head-sha-1";
    },
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "NOT_FOUND", message: "Repository not found" },
  });
  assert.equal(githubCalled, false);
});

test("pr review rerun returns 404 when no review check run exists for the PR", async () => {
  configureEnv();
  const handler = await createHandler({
    getLatestPrReviewCheckRun: async () => null,
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No Mogplex PR Review check run found for PR #42",
    },
  });
});

test("pr review rerun returns 409 when the check run has no linked Mogplex run", async () => {
  configureEnv();
  const handler = await createHandler({
    getLatestPrReviewCheckRun: async () => ({ id: 987, externalId: null }),
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 409);
  const parsed = (await response.json()) as { error: { code: string } };
  assert.equal(parsed.error.code, "CONFLICT");
});

test("pr review rerun returns 404 when the retry context is missing", async () => {
  configureEnv();
  const handler = await createHandler({
    loadJobRunRetryContext: async () => null,
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Job run does not belong to this repository",
    },
  });
});

test("pr review rerun returns 404 when the job run belongs to another repo", async () => {
  configureEnv();
  let enqueued = false;
  const handler = await createHandler({
    loadJobRunRetryContext: async () =>
      buildRetryContext({ repoId: "22222222-2222-4222-8222-222222222222" }),
    enqueueJobRunRetry: async () => {
      enqueued = true;
      return { jobRunId: "job-new-1", outcome: "queued", reason: null };
    },
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 404);
  assert.equal(enqueued, false);
});

test("pr review rerun returns 409 when the retry is suppressed", async () => {
  configureEnv();
  const handler = await createHandler({
    enqueueJobRunRetry: async () => ({
      jobRunId: null,
      outcome: "suppressed",
      reason: "ACTIVE_RUN_EXISTS",
    }),
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 409);
  const parsed = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(parsed.error.code, "CONFLICT");
  assert.match(parsed.error.message, /ACTIVE_RUN_EXISTS/);
});

test("pr review rerun requires the write scope", async () => {
  configureEnv();
  const handler = await createHandler({
    resolveApiKey: async () => ({
      ok: true as const,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
  });

  const response = await handler(
    buildRequest({ repoId: REPO_ID, prNumber: 42 })
  );

  assert.equal(response.status, 403);
  const parsed = (await response.json()) as { error: { code: string } };
  assert.equal(parsed.error.code, "FORBIDDEN");
});
