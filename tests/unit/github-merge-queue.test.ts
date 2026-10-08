import assert from "node:assert/strict";
import test from "node:test";
import {
  mergePullRequestIfSafe,
  queuePullRequestForMerge,
} from "../../lib/github-merge";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(responses: ReturnType<typeof jsonResponse>[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than expected");
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const input = {
  githubToken: "token",
  owner: "Mogplex",
  repo: "mogplex",
  prNumber: 599,
};

const pr = {
  state: "open",
  draft: false,
  mergeable: true,
  mergeable_state: "clean",
  node_id: "PR_node599",
  head: { sha: "c3be68c067d693078b5983da4ca41113c4ffed13" },
  base: { ref: "main" },
};

const queueRules = jsonResponse([
  { type: "pull_request" },
  { type: "merge_queue" },
]);

function graphqlBody(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body)) as {
    query: string;
    variables: { input: Record<string, unknown> };
  };
}

test("a clean PR on a merge-queue branch joins the queue instead of merging directly", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(pr),
    queueRules,
    jsonResponse({
      data: { enqueuePullRequest: { mergeQueueEntry: { position: 2 } } },
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.deepEqual(outcome, {
    merged: false,
    queued: true,
    reason:
      "Added to the merge queue at position 2; GitHub merges it once the queue's checks pass",
  });
  assert.equal(
    calls[1].url,
    "https://api.github.com/repos/Mogplex/mogplex/rules/branches/main"
  );
  const body = graphqlBody(calls[2]);
  assert.match(body.query, /enqueuePullRequest/);
  assert.deepEqual(body.variables.input, {
    pullRequestId: "PR_node599",
    expectedHeadOid: pr.head.sha,
  });
  assert.equal(
    calls.some((call) => call.init?.method === "PUT"),
    false
  );
});

test("a PR still waiting on required checks arms auto-merge, which joins the queue later", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...pr, mergeable_state: "blocked" }),
    queueRules,
    jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: {
            autoMergeRequest: { enabledAt: "2026-10-08T23:00:00Z" },
          },
        },
      },
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.equal(outcome.queued, true);
  assert.match(graphqlBody(calls[2]).query, /enablePullRequestAutoMerge/);
});

test("a failing check that is not required is named as the reason", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...pr, mergeable_state: "unstable" }),
    queueRules,
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /a check that is not required is failing/);
  assert.equal(calls.length, 2);
});

test("a merge-queue rejection is reported, not thrown", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse(pr),
    queueRules,
    jsonResponse({ errors: [{ message: "Pull request is not mergeable" }] }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.equal(outcome.queued, undefined);
  assert.match(
    outcome.reason,
    /merge queue rejected the pull request \(200\): Pull request is not mergeable/
  );
});

test("branches without a merge queue keep the direct squash merge", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(pr),
    jsonResponse([{ type: "pull_request" }]),
    jsonResponse({ sha: "merged-sha", merged: true }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.equal(outcome.merged, true);
  assert.equal(calls[2].init?.method, "PUT");
});

test("an unreadable rules lookup keeps the direct squash merge", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(pr),
    jsonResponse({ message: "Not Found" }, 404),
    jsonResponse({ sha: "merged-sha", merged: true }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...input, fetchImpl });

  assert.equal(outcome.merged, true);
  assert.equal(calls[2].init?.method, "PUT");
});

test("queueing a clean PR on a merge-queue branch enqueues it", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(pr),
    queueRules,
    jsonResponse({
      data: { enqueuePullRequest: { mergeQueueEntry: { position: 1 } } },
    }),
  ]);

  const outcome = await queuePullRequestForMerge({ ...input, fetchImpl });

  assert.equal(outcome.queued, true);
  assert.match(graphqlBody(calls[2]).query, /enqueuePullRequest/);
});
