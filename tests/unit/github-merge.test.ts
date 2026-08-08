import assert from "node:assert/strict";
import test from "node:test";
import { mergePullRequestIfSafe } from "../../lib/github-merge";

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function invalidJsonResponse(status: number): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Invalid JSON");
    },
    text: async () => "Bad gateway",
  };
}

function makeFetch(responses: FakeResponse[]) {
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

const baseInput = {
  githubToken: "token",
  owner: "webrenew",
  repo: "vmotif",
  prNumber: 42,
};

const cleanPr = {
  state: "open",
  draft: false,
  mergeable: true,
  mergeable_state: "clean",
  node_id: "PR_kwDOAutoMerge42",
  head: { sha: "abc123" },
};

test("merges a clean open PR via squash and pins the evaluated head sha", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(cleanPr),
    jsonResponse({ merged: true, sha: "merged-sha" }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, true);
  assert.equal(outcome.sha, "merged-sha");
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.url ?? "", /\/pulls\/42\/merge$/);
  const mergeBody = JSON.parse(String(calls[1]?.init?.body));
  assert.equal(mergeBody.merge_method, "squash");
  assert.equal(mergeBody.sha, "abc123");
});

test("refuses to merge a draft PR", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...cleanPr, draft: true }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /draft/i);
  assert.equal(calls.length, 1);
});

test("refuses to merge a closed PR", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, state: "closed" }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /closed/);
});

test("refuses to merge when checks are not clean", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "unstable" }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /unstable/);
  assert.equal(calls.length, 1);
});

test("refuses to merge when the PR has conflicts", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable: false }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /conflict/i);
});

test("enables GitHub auto-merge while mergeability is still computing", async () => {
  const pending = { ...cleanPr, mergeable: null };
  const { fetchImpl, calls } = makeFetch([
    jsonResponse(pending),
    jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: {
            autoMergeRequest: { enabledAt: "2026-07-31T16:00:00Z" },
          },
        },
      },
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.equal(outcome.queued, true);
  assert.match(outcome.reason, /auto-merge enabled/i);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api.github.com/graphql");
  const body = JSON.parse(String(calls[1]?.init?.body));
  assert.deepEqual(body.variables.input, {
    pullRequestId: "PR_kwDOAutoMerge42",
    mergeMethod: "SQUASH",
    expectedHeadOid: "abc123",
  });
});

test("refuses to merge when the head moved past the reviewed sha", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...cleanPr, head: { sha: "newer-sha" } }),
  ]);

  const outcome = await mergePullRequestIfSafe({
    ...baseInput,
    expectedHeadSha: "abc123",
    fetchImpl,
  });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /head moved since the review/i);
  assert.equal(calls.length, 1);
});

test("merges when the head still matches the reviewed sha", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse(cleanPr),
    jsonResponse({ merged: true, sha: "merged-sha" }),
  ]);

  const outcome = await mergePullRequestIfSafe({
    ...baseInput,
    expectedHeadSha: "abc123",
    fetchImpl,
  });

  assert.equal(outcome.merged, true);
});

test("enables GitHub auto-merge when required checks are still blocked", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "blocked" }),
    jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: {
            autoMergeRequest: { enabledAt: "2026-07-31T16:00:00Z" },
          },
        },
      },
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.equal(outcome.queued, true);
  assert.equal(calls.length, 2);
});

test("reports GraphQL errors when GitHub rejects auto-merge", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "blocked" }),
    jsonResponse({
      errors: [{ message: "Pull request is not in the correct state" }],
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.equal(outcome.queued, undefined);
  assert.match(outcome.reason, /not in the correct state/);
});

test("reports a non-JSON GraphQL failure", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "blocked" }),
    invalidJsonResponse(502),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.deepEqual(outcome, {
    merged: false,
    reason: "GitHub auto-merge failed (502)",
  });
});

test("treats already-enabled auto-merge as queued", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "blocked" }),
    jsonResponse({
      errors: [{ message: "Pull request auto-merge is already enabled" }],
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.deepEqual(outcome, {
    merged: false,
    queued: true,
    reason: "GitHub auto-merge was already enabled",
  });
});

test("explains when auto-merge is waiting for a behind branch", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse({ ...cleanPr, mergeable_state: "behind" }),
    jsonResponse({
      data: {
        enablePullRequestAutoMerge: {
          pullRequest: {
            autoMergeRequest: { enabledAt: "2026-07-31T16:00:00Z" },
          },
        },
      },
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.queued, true);
  assert.match(outcome.reason, /behind the base branch/);
});

test("refuses to enable auto-merge without a pull request node id", async () => {
  const { node_id: _nodeId, ...prWithoutNodeId } = cleanPr;
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({ ...prWithoutNodeId, mergeable_state: "blocked" }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /enough pull request data/);
  assert.equal(calls.length, 1);
});

test("refuses to enable auto-merge without a head sha", async () => {
  const { fetchImpl, calls } = makeFetch([
    jsonResponse({
      ...cleanPr,
      mergeable_state: "blocked",
      head: {},
    }),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /enough pull request data/);
  assert.equal(calls.length, 1);
});

test("reports a failed merge call without throwing", async () => {
  const { fetchImpl } = makeFetch([
    jsonResponse(cleanPr),
    jsonResponse({ message: "Base branch was modified" }, 405),
  ]);

  const outcome = await mergePullRequestIfSafe({ ...baseInput, fetchImpl });

  assert.equal(outcome.merged, false);
  assert.match(outcome.reason, /405/);
});
