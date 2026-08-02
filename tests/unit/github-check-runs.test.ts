import assert from "node:assert/strict";
import test from "node:test";

import {
  MOGPLEX_PR_REVIEW_RERUN_ACTION,
  MOGPLEX_PR_REVIEW_TIMELINE_MARKER,
  clearPrReviewTimelineComment,
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  createPrReviewCheckRun,
  isMogplexPrReviewCheckName,
  isMogplexPrReviewRerunEvent,
  upsertPrReviewTimelineComment,
} from "../../lib/github-check-runs";

test("createPrReviewCheckRun posts an in-progress GitHub check run", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | null = null;

  try {
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(
        JSON.stringify({
          id: 42,
          html_url: "https://github.com/acme/widgets/runs/42",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await createPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
      externalId: "job-1",
      detailsUrl: "https://app.example.com/observability",
    });

    assert.deepEqual(result, {
      id: 42,
      htmlUrl: "https://github.com/acme/widgets/runs/42",
    });
    assert.ok(request);
    const capturedRequest = request as {
      url: string;
      init: RequestInit | undefined;
    };
    assert.equal(
      capturedRequest.url,
      "https://api.github.com/repos/acme/widgets/check-runs"
    );
    assert.equal(capturedRequest.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedRequest.init?.body)), {
      name: "Mogplex PR Review",
      head_sha: "abc123",
      status: "in_progress",
      external_id: "job-1",
      details_url: "https://app.example.com/observability",
      output: {
        title: "Review in progress",
        summary: "Mogplex is reviewing this pull request.",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completePrReviewCheckRun posts the rerun action on completion", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | null = null;

  try {
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(
        JSON.stringify({
          id: 42,
          html_url: "https://github.com/acme/widgets/runs/42",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await completePrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      checkRunId: 42,
      conclusion: "neutral",
      title: "Review found issues",
      summary: "Reviewer found one issue.",
      text: "The query needs a null guard.",
    });

    assert.deepEqual(result, {
      id: 42,
      htmlUrl: "https://github.com/acme/widgets/runs/42",
    });
    assert.ok(request);
    const capturedRequest = request as {
      url: string;
      init: RequestInit | undefined;
    };
    assert.equal(
      capturedRequest.url,
      "https://api.github.com/repos/acme/widgets/check-runs/42"
    );
    assert.equal(capturedRequest.init?.method, "PATCH");
    const body = JSON.parse(String(capturedRequest.init?.body));
    assert.equal(body.status, "completed");
    assert.equal(body.conclusion, "neutral");
    assert.equal(body.output.title, "Review found issues");
    assert.equal(body.output.summary, "Reviewer found one issue.");
    assert.equal(body.output.text, "The query needs a null guard.");
    assert.deepEqual(body.actions, [
      {
        label: "Re-run review",
        description: "Queue another Mogplex review.",
        identifier: MOGPLEX_PR_REVIEW_RERUN_ACTION,
      },
    ]);
    assert.ok(body.actions[0].description.length <= 40);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createPrReviewGithubReview posts a review summary with inline comments", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | null = null;

  try {
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(
        JSON.stringify({
          id: 44,
          html_url:
            "https://github.com/acme/widgets/pull/12#pullrequestreview-44",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await createPrReviewGithubReview({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
      commitId: "abc123",
      body: "## Mogplex PR Review\n\n**Status:** Attention needed",
      comments: [
        {
          path: "src/widget.ts",
          body: "**Warning:** Guard nullable lookup\n\nThis access can throw.",
          line: 18,
        },
      ],
    });

    assert.deepEqual(result, {
      id: 44,
      htmlUrl: "https://github.com/acme/widgets/pull/12#pullrequestreview-44",
    });
    assert.ok(request);
    const capturedRequest = request as {
      url: string;
      init: RequestInit | undefined;
    };
    assert.equal(
      capturedRequest.url,
      "https://api.github.com/repos/acme/widgets/pulls/12/reviews"
    );
    assert.equal(capturedRequest.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedRequest.init?.body)), {
      commit_id: "abc123",
      body: "## Mogplex PR Review\n\n**Status:** Attention needed",
      event: "COMMENT",
      comments: [
        {
          path: "src/widget.ts",
          body: "**Warning:** Guard nullable lookup\n\nThis access can throw.",
          line: 18,
          side: "RIGHT",
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("check run helpers recognize Mogplex review runs and rerun events", () => {
  assert.equal(isMogplexPrReviewCheckName("Mogplex PR Review"), true);
  assert.equal(
    isMogplexPrReviewRerunEvent({
      action: "requested_action",
      checkRunName: "Mogplex PR Review",
      requestedActionIdentifier: "rerun-pr-review",
    }),
    true
  );
  assert.equal(
    isMogplexPrReviewRerunEvent({
      action: "rerequested",
      checkRunName: "Mogplex PR Review",
      requestedActionIdentifier: null,
    }),
    true
  );
  assert.equal(
    isMogplexPrReviewRerunEvent({
      action: "requested_action",
      checkRunName: "Other Check",
      requestedActionIdentifier: "rerun-pr-review",
    }),
    false
  );
});

test("upsertPrReviewTimelineComment creates a PR timeline comment when none exists", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

  try {
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });

      if (requests.length === 1) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          id: 77,
          html_url: "https://github.com/acme/widgets/pull/12#issuecomment-77",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await upsertPrReviewTimelineComment({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
      body: "## Mogplex PR Review\n\nWarning details.",
    });

    assert.deepEqual(result, {
      id: 77,
      htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-77",
      created: true,
    });
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=1"
    );
    assert.equal(requests[0]?.init?.method, "GET");
    assert.equal(
      requests[1]?.url,
      "https://api.github.com/repos/acme/widgets/issues/12/comments"
    );
    assert.equal(requests[1]?.init?.method, "POST");
    const body = JSON.parse(String(requests[1]?.init?.body));
    assert.equal(
      String(body.body).includes(MOGPLEX_PR_REVIEW_TIMELINE_MARKER),
      true
    );
    assert.match(body.body, /Warning details\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upsertPrReviewTimelineComment surfaces GitHub create failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await assert.rejects(
      () =>
        upsertPrReviewTimelineComment({
          githubToken: "token",
          repoFullName: "acme/widgets",
          prNumber: 12,
          body: "## Mogplex PR Review\n\nWarning details.",
        }),
      /GitHub PR timeline comment create failed \(403\): Forbidden/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upsertPrReviewTimelineComment searches newest comment pages first when updating", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

  try {
    const linkHeader =
      '<https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=3>; rel="last"';
    const firstResponse = new Response(
      JSON.stringify([
        {
          id: 11,
          body: "regular comment",
          html_url: "https://github.com/acme/widgets/pull/12#issuecomment-11",
        },
      ]),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: linkHeader,
        },
      }
    );

    let callCount = 0;
    globalThis.fetch = (async (url, init) => {
      callCount += 1;
      requests.push({ url: String(url), init });

      if (callCount === 1) {
        return firstResponse;
      }

      if (callCount === 2) {
        return new Response(
          JSON.stringify([
            {
              id: 12,
              body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nold body`,
              html_url:
                "https://github.com/acme/widgets/pull/12#issuecomment-12",
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          id: 12,
          html_url: "https://github.com/acme/widgets/pull/12#issuecomment-12",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;

    const result = await upsertPrReviewTimelineComment({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
      body: "## Mogplex PR Review\n\nUpdated body.",
    });

    assert.deepEqual(result, {
      id: 12,
      htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-12",
      created: false,
    });
    assert.equal(requests.length, 3);
    assert.equal(
      requests[1]?.url,
      "https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=3"
    );
    assert.equal(
      requests[2]?.url,
      "https://api.github.com/repos/acme/widgets/issues/comments/12"
    );
    assert.equal(requests[2]?.init?.method, "PATCH");
    const body = JSON.parse(String(requests[2]?.init?.body));
    assert.match(body.body, /Updated body\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("clearPrReviewTimelineComment deletes an existing canonical timeline comment", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

  try {
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });

      if (requests.length === 1) {
        return new Response(
          JSON.stringify([
            {
              id: 19,
              body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nold body`,
              html_url:
                "https://github.com/acme/widgets/pull/12#issuecomment-19",
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    const result = await clearPrReviewTimelineComment({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    assert.deepEqual(result, {
      deleted: true,
      id: 19,
      htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-19",
    });
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=1"
    );
    assert.equal(
      requests[1]?.url,
      "https://api.github.com/repos/acme/widgets/issues/comments/19"
    );
    assert.equal(requests[1]?.init?.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
