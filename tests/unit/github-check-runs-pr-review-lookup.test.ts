import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestPrReviewCheckRun,
  getPullRequestHeadSha,
} from "../../lib/github-check-runs";

test("getPullRequestHeadSha returns the PR head sha", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | null = null;

  try {
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ head: { sha: "abc123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    assert.equal(result, "abc123");
    assert.ok(request);
    const capturedRequest = request as {
      url: string;
      init: RequestInit | undefined;
    };
    assert.equal(
      capturedRequest.url,
      "https://api.github.com/repos/acme/widgets/pulls/12"
    );
    const headers = new Headers(capturedRequest.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getPullRequestHeadSha returns null when the PR is not found", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 999,
    });

    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getPullRequestHeadSha returns null when the head sha is missing", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ head: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getPullRequestHeadSha surfaces GitHub lookup failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    await assert.rejects(
      () =>
        getPullRequestHeadSha({
          githubToken: "token",
          repoFullName: "acme/widgets",
          prNumber: 12,
        }),
      /GitHub pull request lookup failed \(403\): Forbidden/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getLatestPrReviewCheckRun returns the latest review check run", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | null = null;

  try {
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(
        JSON.stringify({
          check_runs: [{ id: 42, external_id: "job-1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    assert.deepEqual(result, { id: 42, externalId: "job-1" });
    assert.ok(request);
    const capturedRequest = request as {
      url: string;
      init: RequestInit | undefined;
    };
    assert.equal(
      capturedRequest.url,
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?check_name=Mogplex%20PR%20Review&per_page=1"
    );
    const headers = new Headers(capturedRequest.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getLatestPrReviewCheckRun returns null when no review check run exists", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ check_runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getLatestPrReviewCheckRun returns a null externalId when none is linked", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ check_runs: [{ id: 42, external_id: "" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof globalThis.fetch;

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    assert.deepEqual(result, { id: 42, externalId: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getLatestPrReviewCheckRun surfaces GitHub lookup failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    await assert.rejects(
      () =>
        getLatestPrReviewCheckRun({
          githubToken: "token",
          repoFullName: "acme/widgets",
          headSha: "abc123",
        }),
      /GitHub check runs lookup failed \(403\): Forbidden/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
