import { afterEach, describe, expect, it, vi } from "vitest";
import { listPrReviewComments } from "@/lib/github-check-runs";
import type { ReviewFinding } from "@/lib/types";
import { publishInlinePrReview } from "./automation-job-pr-review-inline";
import type { PrReviewHarnessResult } from "./pr-review-harness";
import { createPrReviewLifecycle } from "./pr-review-lifecycle-runner";
import { createPrReviewReporterState } from "./pr-review-reporter-state";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const finding = (title: string, line: number): ReviewFinding => ({
  severity: "warning",
  title,
  body: `${title} body.`,
  path: "lib/a.ts",
  line,
});
const first = finding("First", 4);
const second = finding("Second", 9);

const harnessResult = {
  source: "structured",
  fallbackText: null,
  reviewOutcome: {
    hasIssues: true,
    summary: "Two findings.",
    findings: [first, second],
  },
} as unknown as PrReviewHarnessResult;

async function publish(
  listComments: (
    bodies: string[]
  ) => Promise<Array<{ body: string; htmlUrl: string }>>
) {
  const lifecycle = createPrReviewLifecycle({
    githubToken: "token",
    repoFullName: "acme/widgets",
    prNumber: 7,
    headSha: "head1234",
    deps: undefined,
  });
  lifecycle.planThreads([first, second], true);
  let posted: string[] = [];
  const state = createPrReviewReporterState();
  await publishInlinePrReview({
    deps: {
      createPrReviewGithubReview: async (input) => {
        posted = (input.comments ?? []).map((comment) => comment.body);
        return {
          id: 99,
          htmlUrl: "https://github.com/acme/widgets/pull/7#review-99",
        };
      },
      listPrReviewComments: () => listComments(posted),
    },
    githubToken: "token",
    repoFullName: "acme/widgets",
    prNumber: 7,
    headSha: "head1234",
    state,
    lifecycle,
    harnessResult,
    findings: [first, second],
    conclusion: "neutral",
  });
  return state;
}

describe("publishInlinePrReview comment links", () => {
  it("should link each finding to its own comment, whatever order GitHub returns", async () => {
    const state = await publish(async (bodies) => [
      { body: bodies[1], htmlUrl: "https://github.com/c/2" },
      { body: bodies[0], htmlUrl: "https://github.com/c/1" },
    ]);

    expect(state.reviewInlineCommentUrls.get(first)).toBe(
      "https://github.com/c/1"
    );
    expect(state.reviewInlineCommentUrls.get(second)).toBe(
      "https://github.com/c/2"
    );
  });

  it("should keep the review published and drop only the links when the lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const state = await publish(async () => {
      throw new Error("GitHub review comments lookup failed (502)");
    });

    expect(state.reviewGithubReviewPublished).toBe(true);
    expect(state.reviewInlineCommentUrls.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[automation-job] PR review comments lookup failed",
      expect.objectContaining({ prNumber: 7 })
    );
  });
});

describe("listPrReviewComments", () => {
  it("should read one review's comments with their links", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        { body: "One", html_url: "https://github.com/c/1" },
        { body: null, html_url: "https://github.com/c/x" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const comments = await listPrReviewComments({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 7,
      reviewId: 99,
    });

    expect(comments).toEqual([
      { body: "One", htmlUrl: "https://github.com/c/1" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/repos/acme/widgets/pulls/7/reviews/99/comments"
    );
  });

  it("should throw when GitHub refuses the lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: "Not Found" }, { status: 404 })
        )
    );

    await expect(
      listPrReviewComments({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 7,
        reviewId: 99,
      })
    ).rejects.toThrow("GitHub review comments lookup failed (404)");
  });
});
