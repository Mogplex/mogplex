import assert from "node:assert/strict";
import test from "node:test";

import {
  MogplexApiClient,
  MogplexApiClientError,
} from "../../lib/mogplex-api/client";

test("MogplexApiClient delegates list calls with PAT auth and query params", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        ok: true,
        data: {
          repos: [
            {
              id: "repo-1",
              full_name: "webrenew/mogplex",
              default_branch: "main",
              root_directory: null,
            },
          ],
        },
      });
    },
  });

  const result = await client.listRepos({ query: "mog", limit: 12 });

  assert.equal(result.repos.length, 1);
  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/repos?q=mog&limit=12",
      authorization: "Bearer mog_test",
    },
  ]);
});

test("MogplexApiClient sends automation pagination parameters", async () => {
  const seen: string[] = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({
        ok: true,
        data: { automations: [], nextCursor: "next-page" },
      });
    },
  });

  const result = await client.listAutomations({
    limit: 25,
    cursor: "current-page",
  });

  assert.deepEqual(seen, [
    "https://app.example/api/v1/mogplex/automations?limit=25&cursor=current-page",
  ]);
  assert.equal(result.nextCursor, "next-page");
});

test("MogplexApiClient surfaces Mogplex API error envelopes", async () => {
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "Bearer mog_test",
    fetch: async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Run not found",
          },
        },
        { status: 404 }
      ),
  });

  await assert.rejects(
    () => client.getRun({ runId: "missing" }),
    (error) => {
      assert.ok(error instanceof MogplexApiClientError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.status, 404);
      assert.equal(error.message, "Run not found");
      return true;
    }
  );
});

test("MogplexApiClient sends automation triggers through the scoped API with idempotency", async () => {
  const seen: Array<{
    url: string;
    method: string | undefined;
    idempotencyKey: string | null;
    body: string | null;
  }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Response.json({
        ok: true,
        data: {
          run: {
            automationId: "automation-1",
            jobRunId: "job-1",
            outcome: "queued",
            reason: null,
            started: true,
            status: "running",
            runtime: { provider: "trigger", runId: "runtime-1" },
          },
        },
      });
    },
  });

  await client.triggerAutomation({
    automationId: "automation-1",
    repoId: "repo-1",
    input: { pull_request: { number: 42 } },
    idempotencyKey: "tool-call-1",
  });

  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/automations/automation-1/trigger",
      method: "POST",
      idempotencyKey: "tool-call-1",
      body: JSON.stringify({
        repoId: "repo-1",
        input: { pull_request: { number: 42 } },
      }),
    },
  ]);
});

test("MogplexApiClient posts PR review reruns to the scoped endpoint", async () => {
  const seen: Array<{
    url: string;
    method: string | undefined;
    body: string | null;
  }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Response.json({
        ok: true,
        data: {
          queued: true,
          jobRunId: "job-new-1",
          prNumber: 42,
          repoId: "repo-1",
          started: true,
          deferred: false,
          reason: null,
          status: "running",
          runtimeProvider: "trigger",
          runtimeRunId: "runtime-1",
          workflowRunId: "workflow-1",
          versionFallbackUsed: false,
        },
      });
    },
  });

  const result = await client.rerunPrReview({ repoId: "repo-1", prNumber: 42 });

  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/pr-reviews/rerun",
      method: "POST",
      body: JSON.stringify({ repoId: "repo-1", prNumber: 42 }),
    },
  ]);
  assert.equal(result.jobRunId, "job-new-1");
  assert.equal(result.queued, true);
});

test("MogplexApiClient sends env var mutations to the repo-scoped endpoint", async () => {
  const seen: Array<{
    url: string;
    method: string | undefined;
    body: string | null;
  }> = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Response.json({
        ok: true,
        data: { action: "created", key: "API_KEY", updatedCount: 1 },
      });
    },
  });

  await client.upsertRepoEnvVar({
    repoId: "repo-1",
    key: "API_KEY",
    value: "secret",
    target: ["production"],
  });

  assert.deepEqual(seen, [
    {
      url: "https://app.example/api/v1/mogplex/repos/repo-1/env-vars",
      method: "POST",
      body: JSON.stringify({
        key: "API_KEY",
        value: "secret",
        target: ["production"],
      }),
    },
  ]);
});
