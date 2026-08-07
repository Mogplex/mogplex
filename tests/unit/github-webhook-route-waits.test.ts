import assert from "node:assert/strict";
import test from "node:test";
import { loadGithubWebhookRoute } from "./helpers/github-webhook-route-fixtures";

test("tryResumeFlowWaitsForLabeledEvent skips non-labeled events", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();

  const result = await tryResumeFlowWaitsForLabeledEvent({
    context: {
      event: "push",
      deliveryId: "d-1",
      signature: "",
      globalSecret: null,
      payload: "{}",
      body: { action: "labeled" },
      installationId: 99,
      repoGithubId: null,
      repoFullName: null,
      accountType: "User",
    },
    repoRows: [],
  });
  assert.equal(result, null);
});

test("tryResumeFlowWaitsForLabeledEvent skips labeled events without a label name", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();
  const result = await tryResumeFlowWaitsForLabeledEvent({
    context: {
      event: "pull_request",
      deliveryId: "d-2",
      signature: "",
      globalSecret: null,
      payload: "{}",
      body: { action: "labeled", label: null },
      installationId: 99,
      repoGithubId: null,
      repoFullName: null,
      accountType: "User",
    },
    repoRows: [],
  });
  assert.equal(result, null);
});

test("tryResumeFlowWaitsForLabeledEvent routes a pull_request labeled event with no candidates to a zero-match outcome", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };
  try {
    const result = await tryResumeFlowWaitsForLabeledEvent({
      context: {
        event: "pull_request",
        deliveryId: "d-3",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: {
          action: "labeled",
          label: { name: "ready-to-merge" },
          pull_request: { number: 42 },
        },
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "User",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });
    assert.ok(result);
    assert.equal(result?.matched, 0);
    assert.equal(result?.resumed, 0);
    assert.equal(result?.alreadyResumed, 0);
    assert.equal(result?.completeFailed, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tryResumeFlowWaitsForGithubEvent routes completed CI events", async () => {
  const { tryResumeFlowWaitsForGithubEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      assert.match(url, /wait_kind=eq\.ci_workflow_completed/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context: {
        event: "workflow_run",
        deliveryId: "delivery-ci",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: {
          action: "completed",
          workflow_run: {
            name: "CI / test",
            conclusion: "success",
            head_sha: "abc123",
          },
        },
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "Organization",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });

    assert.deepEqual(result, {
      matched: 0,
      resumed: 0,
      alreadyResumed: 0,
      completeFailed: 0,
      failures: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tryResumeFlowWaitsForGithubEvent routes new GitHub comments and ignores Mogplex output", async () => {
  const { tryResumeFlowWaitsForGithubEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  let waitQueries = 0;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      waitQueries += 1;
      assert.match(url, /wait_kind=eq\.github_comment_added/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  const context = {
    event: "issue_comment",
    deliveryId: "delivery-comment",
    signature: "",
    globalSecret: null,
    payload: "{}",
    body: {
      action: "created",
      issue: { number: 42, pull_request: { url: "https://api.github.test" } },
      comment: {
        body: "Approved",
        user: { login: "alice", type: "User" },
      },
    },
    installationId: 99,
    repoGithubId: 12345,
    repoFullName: "acme/widgets",
    accountType: "Organization" as const,
  };
  const repoRows = [
    {
      id: "repo-1",
      user_id: "user-1",
      full_name: "acme/widgets",
      github_installation_id: 99,
      root_directory: null,
      parent_repo_id: null,
    },
  ];

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context,
      repoRows,
    });
    assert.deepEqual(result, {
      matched: 0,
      resumed: 0,
      alreadyResumed: 0,
      completeFailed: 0,
      failures: [],
    });
    assert.equal(waitQueries, 1);

    const ignored = await tryResumeFlowWaitsForGithubEvent({
      context: {
        ...context,
        body: {
          ...context.body,
          comment: {
            body: "Automated response\n\n<!-- mogplex:automated -->",
            user: { login: "connected-user", type: "User" },
          },
        },
      },
      repoRows,
    });
    assert.equal(ignored, null);
    assert.equal(waitQueries, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel preview waits only accept successful Vercel deployment statuses", async () => {
  const { isVercelDeploymentStatus, tryResumeFlowWaitsForGithubEvent } =
    await loadGithubWebhookRoute();
  const vercelBody = {
    deployment: {
      sha: "abc123",
      environment: "Preview",
      creator: { login: "vercel[bot]" },
    },
    deployment_status: {
      state: "success",
      environment: "Preview",
      environment_url: "https://acme-git-branch.vercel.app",
    },
  };
  assert.equal(isVercelDeploymentStatus(vercelBody), true);
  assert.equal(
    isVercelDeploymentStatus({
      deployment: { creator: { login: "other-bot" } },
      deployment_status: {
        environment_url: "https://preview.example.com",
      },
    }),
    false
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      assert.match(url, /wait_kind=eq\.vercel_preview_ready/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context: {
        event: "deployment_status",
        deliveryId: "delivery-preview",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: vercelBody,
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "Organization",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });
    assert.equal(result?.matched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
