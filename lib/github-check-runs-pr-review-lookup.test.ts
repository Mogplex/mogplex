import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOGPLEX_PR_REVIEW_TIMELINE_MARKER,
  getLatestPrReviewCheckRun,
  getPullRequestHeadSha,
  readPrReviewTimelineComments,
  upsertPrReviewTimelineComment,
} from "./github-check-runs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPullRequestHeadSha", () => {
  it("returns the PR head sha", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ head: { sha: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(result).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/widgets/pulls/12"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer token"
    );
  });

  it("returns null when the PR is not found", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 999,
    });

    expect(result).toBeNull();
  });

  it("returns null when the head sha is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ head: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(result).toBeNull();
  });

  it("surfaces GitHub lookup failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getPullRequestHeadSha({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 12,
      })
    ).rejects.toThrow(/GitHub pull request lookup failed \(403\): Forbidden/);
  });

  it("falls back to the status text when the error payload has no message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/plain" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getPullRequestHeadSha({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 12,
      })
    ).rejects.toThrow(/GitHub pull request lookup failed \(502\): Bad Gateway/);
  });
});

describe("getLatestPrReviewCheckRun", () => {
  it("returns the latest review check run", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ check_runs: [{ id: 42, external_id: "job-1" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toEqual({ id: 42, externalId: "job-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?check_name=Mogplex%20PR%20Review&per_page=1"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer token"
    );
  });

  it("returns null when no review check run exists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ check_runs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toBeNull();
  });

  it("returns a null externalId when none is linked", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ check_runs: [{ id: 42, external_id: "" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toEqual({ id: 42, externalId: null });
  });

  it("surfaces GitHub lookup failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getLatestPrReviewCheckRun({
        githubToken: "token",
        repoFullName: "acme/widgets",
        headSha: "abc123",
      })
    ).rejects.toThrow(/GitHub check runs lookup failed \(403\): Forbidden/);
  });

  it("falls back to the status text when the error payload has no message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/plain" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getLatestPrReviewCheckRun({
        githubToken: "token",
        repoFullName: "acme/widgets",
        headSha: "abc123",
      })
    ).rejects.toThrow(/GitHub check runs lookup failed \(502\): Bad Gateway/);
  });
});

describe("readPrReviewTimelineComments", () => {
  it("returns every comment carrying the review marker, oldest first", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          id: 1,
          body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nOld review`,
          user: { login: "mogplex[bot]" },
        },
        { id: 2, body: "A person's comment" },
        {
          id: 3,
          body: `> ${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nA quoted copy`,
          user: { login: "someone" },
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const bodies = await readPrReviewTimelineComments({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(bodies).toEqual([
      {
        body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nOld review`,
        author: "mogplex[bot]",
      },
      {
        body: `> ${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nA quoted copy`,
        author: "someone",
      },
    ]);
  });

  it("reads every page of comments", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ id: 1, body: "first page" }], {
          headers: {
            link: '<https://api.github.com/repos/acme/widgets/issues/12/comments?per_page=100&page=2>; rel="last"',
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json([
          { id: 2, body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nReview` },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const bodies = await readPrReviewTimelineComments({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(bodies).toEqual([
      { body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\nReview`, author: null },
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("page=2");
  });
});

describe("upsertPrReviewTimelineComment", () => {
  it("posts a new comment when the marked comment belongs to someone else", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          { id: 9, body: `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER} spoof` },
        ])
      )
      .mockResolvedValueOnce(
        Response.json({ message: "Forbidden" }, { status: 403 })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            id: 10,
            html_url: "https://github.com/acme/widgets/pull/12#issuecomment-10",
          },
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertPrReviewTimelineComment({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
      body: "Review",
    });

    expect(result).toEqual({
      id: 10,
      htmlUrl: "https://github.com/acme/widgets/pull/12#issuecomment-10",
      created: true,
    });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("still fails on other edit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json([{ id: 9, body: MOGPLEX_PR_REVIEW_TIMELINE_MARKER }])
        )
        .mockResolvedValueOnce(
          Response.json({ message: "Boom" }, { status: 500 })
        )
    );

    await expect(
      upsertPrReviewTimelineComment({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 12,
        body: "Review",
      })
    ).rejects.toThrow();
  });
});
