import assert from "node:assert/strict";
import test from "node:test";

async function loadPrReviewer() {
  return import("../../lib/agents/pr-reviewer");
}

type RecordedRequest = {
  url: string;
  method: string;
  body: string | null;
};

function stubLifecycleFetch(
  handler: (request: RecordedRequest) => Response
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return requests;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LIFECYCLE_TOOL_NAMES = [
  "mergePullRequest",
  "queuePullRequestForMerge",
  "rebasePullRequest",
  "closePullRequest",
  "createIssue",
] as const;

type LifecycleToolName = (typeof LIFECYCLE_TOOL_NAMES)[number];

function getLifecycleExecutor(
  tools: unknown,
  name: LifecycleToolName
): (input: never) => Promise<Record<string, unknown>> {
  const execute = (tools as Record<string, { execute?: unknown }>)[name]
    ?.execute;
  assert.ok(execute);
  return execute as (input: never) => Promise<Record<string, unknown>>;
}

type BuildPRReviewTools = Awaited<
  ReturnType<typeof loadPrReviewer>
>["buildPRReviewTools"];

function buildLifecycleTools(buildPRReviewTools: BuildPRReviewTools) {
  return buildPRReviewTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
    allowPrLifecycle: true,
  });
}

test("buildPRReviewTools omits PR lifecycle tools by default", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const tools = buildPRReviewTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
  });

  for (const name of LIFECYCLE_TOOL_NAMES) {
    assert.equal(name in tools, false, `${name} should be omitted`);
  }
});

test("buildPRReviewTools includes PR lifecycle tools when allowPrLifecycle is true", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const tools = buildLifecycleTools(buildPRReviewTools);

  for (const name of LIFECYCLE_TOOL_NAMES) {
    assert.equal(name in tools, true, `${name} should be present`);
  }
});

test("mergePullRequest squash-merges a clean PR", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch((request) => {
    if (request.method === "GET") {
      return jsonResponse({
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        node_id: "PR_node_1",
        head: { sha: "head-sha-1" },
      });
    }
    return jsonResponse({ merged: true, sha: "merge-sha-1" });
  });

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "mergePullRequest"
    )({} as never);

    assert.equal(outcome.merged, true);
    const mergeCall = requests.find((request) => request.method === "PUT");
    assert.ok(mergeCall);
    assert.match(mergeCall.url, /\/pulls\/42\/merge$/);
    assert.equal(JSON.parse(mergeCall.body ?? "{}").merge_method, "squash");
    assert.equal(JSON.parse(mergeCall.body ?? "{}").sha, "head-sha-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mergePullRequest arms auto-merge when checks are still pending", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch((request) => {
    if (request.method === "GET") {
      return jsonResponse({
        state: "open",
        draft: false,
        mergeable: null,
        mergeable_state: "blocked",
        node_id: "PR_node_1",
        head: { sha: "head-sha-1" },
      });
    }
    return jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: { autoMergeRequest: { enabledAt: "2026-08-08" } },
        },
      },
    });
  });

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "mergePullRequest"
    )({} as never);

    assert.equal(outcome.merged, false);
    assert.equal(outcome.queued, true);
    const graphqlCall = requests.find((request) =>
      request.url.endsWith("/graphql")
    );
    assert.ok(graphqlCall);
    const payload = JSON.parse(graphqlCall.body ?? "{}");
    assert.equal(payload.variables.input.mergeMethod, "SQUASH");
    assert.equal(payload.variables.input.expectedHeadOid, "head-sha-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queuePullRequestForMerge enables auto-merge without merging directly", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch((request) => {
    if (request.method === "GET") {
      return jsonResponse({
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        node_id: "PR_node_1",
        head: { sha: "head-sha-1" },
      });
    }
    return jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: { autoMergeRequest: { enabledAt: "2026-08-08" } },
        },
      },
    });
  });

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "queuePullRequestForMerge"
    )({} as never);

    assert.equal(outcome.queued, true);
    assert.equal(
      requests.some((request) => request.url.endsWith("/merge")),
      false,
      "must not call the direct merge endpoint"
    );
    assert.ok(requests.some((request) => request.url.endsWith("/graphql")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queuePullRequestForMerge refuses when the PR is not open", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  stubLifecycleFetch(() => jsonResponse({ state: "closed" }));

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "queuePullRequestForMerge"
    )({} as never);

    assert.equal(outcome.merged, false);
    assert.equal(outcome.queued, undefined);
    assert.match(String(outcome.reason), /PR is closed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rebasePullRequest requests a branch update pinned to the current head", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch((request) => {
    if (request.method === "GET") {
      return jsonResponse({ state: "open", head: { sha: "head-sha-1" } });
    }
    return jsonResponse(
      {
        message: "Updating pull request branch.",
        url: "https://github.com/acme/widgets/pull/42",
      },
      202
    );
  });

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "rebasePullRequest"
    )({} as never);

    assert.equal(outcome.success, true);
    const updateCall = requests.find((request) => request.method === "PUT");
    assert.ok(updateCall);
    assert.match(updateCall.url, /\/pulls\/42\/update-branch$/);
    assert.equal(
      JSON.parse(updateCall.body ?? "{}").expected_head_sha,
      "head-sha-1"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rebasePullRequest surfaces update-branch failures without throwing", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  stubLifecycleFetch((request) => {
    if (request.method === "GET") {
      return jsonResponse({ state: "open", head: { sha: "head-sha-1" } });
    }
    return new Response(JSON.stringify({ message: "Merge conflict" }), {
      status: 422,
    });
  });

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "rebasePullRequest"
    )({} as never);

    assert.equal(outcome.success, false);
    assert.match(String(outcome.error), /422/);
    assert.match(String(outcome.error), /Merge conflict/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closePullRequest closes the PR without merging", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch(() =>
    jsonResponse({
      state: "closed",
      html_url: "https://github.com/acme/widgets/pull/42",
    })
  );

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "closePullRequest"
    )({} as never);

    assert.equal(outcome.success, true);
    assert.equal(outcome.state, "closed");
    const closeCall = requests.find((request) => request.method === "PATCH");
    assert.ok(closeCall);
    assert.match(closeCall.url, /\/pulls\/42$/);
    assert.equal(JSON.parse(closeCall.body ?? "{}").state, "closed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createIssue posts an issue with the automation marker", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  const requests = stubLifecycleFetch(() =>
    jsonResponse(
      { number: 7, html_url: "https://github.com/acme/widgets/issues/7" },
      201
    )
  );

  try {
    const tools = buildLifecycleTools(buildPRReviewTools);
    const outcome = await getLifecycleExecutor(
      tools,
      "createIssue"
    )({
      title: "Dependabot: zod 3.25.76 -> 4.4.3 blocked",
      body: "The upgrade breaks the schema refinement API.",
    } as never);

    assert.equal(outcome.success, true);
    assert.equal(outcome.issue_number, 7);
    const createCall = requests.find((request) => request.method === "POST");
    assert.ok(createCall);
    assert.match(createCall.url, /\/issues$/);
    const payload = JSON.parse(createCall.body ?? "{}");
    assert.match(payload.body, /breaks the schema refinement API/);
    assert.match(payload.body, /mogplex:automated/);
    assert.deepEqual(payload.labels, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
