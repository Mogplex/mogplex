import { describe, expect, it, vi } from "vitest";
import type { PrReviewThread } from "@/lib/github-pr-review-threads";
import type { ReviewFinding } from "@/lib/types";
import { publishInlinePrReview } from "./automation-job-pr-review-inline";
import type { PrReviewInlineState } from "./automation-job-pr-review-inline";
import {
  findingMarker,
  parsePrReviewState,
  serializePrReviewState,
} from "./pr-review-history";
import {
  createPrReviewLifecycle,
  type PrReviewThreadsDeps,
} from "./pr-review-lifecycle-runner";
import type { PrReviewHarnessResult } from "./pr-review-harness";
import { createPrReviewSigner } from "./pr-review-signing";

const signer = createPrReviewSigner("test-secret", {
  repoFullName: "acme/widgets",
  prNumber: 7,
});

const target = {
  githubToken: "token",
  repoFullName: "acme/widgets",
  prNumber: 7,
  headSha: "newhead1234",
  now: () => new Date("2026-11-09T12:00:00.000Z"),
};

const previousState = {
  sha: "oldhead1234",
  reviewedAt: "2026-11-09T10:00:00.000Z",
  findings: [
    {
      key: "aaaaaaaaaaaa",
      severity: "warning" as const,
      title: "Unchecked null",
      path: "lib/a.ts",
      line: 4,
      inline: true,
    },
    {
      key: "bbbbbbbbbbbb",
      severity: "warning" as const,
      title: "Leaked handle",
      path: "lib/b.ts",
      line: 9,
      inline: true,
    },
  ],
};

const thread = (key: string): PrReviewThread => ({
  id: `thread-${key}`,
  isResolved: false,
  path: "lib/a.ts",
  line: 4,
  url: `https://github.com/acme/widgets/pull/7#${key}`,
  comments: [
    {
      author: "mogplex",
      body: `**Warning:** x\n\n${findingMarker(key, signer)}`,
      createdAt: "t",
    },
  ],
});

const threadDeps = (
  overrides: Partial<PrReviewThreadsDeps> = {}
): PrReviewThreadsDeps => ({
  readPrReviewTimelineComment: async () =>
    `review\n${serializePrReviewState(previousState, signer)}`,
  listPrReviewThreads: async () => [
    thread("aaaaaaaaaaaa"),
    thread("bbbbbbbbbbbb"),
  ],
  comparePrCommits: async () => ({
    status: "ahead",
    files: ["lib/a.ts"],
    complete: true,
  }),
  listPrConversationComments: async () => [],
  replyAndResolvePrReviewThread: vi.fn(async () => undefined),
  signingSecret: () => "test-secret",
  ...overrides,
});

const stillThere: ReviewFinding = {
  severity: "warning",
  title: "Unchecked null, still",
  body: "Still unchecked.",
  path: "lib/a.ts",
  line: 5,
  priorId: "F1",
};
const brandNew: ReviewFinding = {
  severity: "suggestion",
  title: "New thing",
  body: "Consider it.",
  path: "lib/a.ts",
  line: 4,
};

describe("createPrReviewLifecycle", () => {
  it("should do nothing without thread deps, as a first review", async () => {
    const lifecycle = createPrReviewLifecycle({ ...target, deps: undefined });

    await expect(lifecycle.loadHistoryBlock()).resolves.toBeNull();
    lifecycle.planThreads([brandNew], true);
    await expect(lifecycle.resolveThreads()).resolves.toBe(0);
    expect(
      lifecycle.stateMarker({
        structured: true,
        findings: [brandNew],
        inline: new Set(),
      })
    ).toBeNull();
  });

  it("should stay off when there is no signing secret", async () => {
    const deps = threadDeps({ signingSecret: () => null });
    const lifecycle = createPrReviewLifecycle({ ...target, deps });

    await expect(lifecycle.loadHistoryBlock()).resolves.toBeNull();
    lifecycle.planThreads([], true);
    await expect(lifecycle.resolveThreads()).resolves.toBe(0);
    expect(lifecycle.markerFor(brandNew)).toBeNull();
    expect(deps.replyAndResolvePrReviewThread).not.toHaveBeenCalled();
  });

  it("should keep the reported finding's thread and resolve the dropped one", async () => {
    const deps = threadDeps();
    const lifecycle = createPrReviewLifecycle({ ...target, deps });

    const block = await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([stillThere, brandNew], true);
    const resolved = await lifecycle.resolveThreads();

    expect(block).toContain("- F1 (warning, open thread)");
    expect(lifecycle.keyOf(stillThere)).toBe("aaaaaaaaaaaa");
    expect(lifecycle.plan.existingThreads.get(stillThere)).toBe(
      "https://github.com/acme/widgets/pull/7#aaaaaaaaaaaa"
    );
    expect(resolved).toBe(1);
    expect(deps.replyAndResolvePrReviewThread).toHaveBeenCalledWith({
      githubToken: "token",
      threadId: "thread-bbbbbbbbbbbb",
      body: expect.stringContaining("No longer reported at `newhead`"),
    });
  });

  it("should count only the threads it managed to resolve", async () => {
    const lifecycle = createPrReviewLifecycle({
      ...target,
      deps: threadDeps({
        replyAndResolvePrReviewThread: async () => {
          throw new Error("forbidden");
        },
      }),
    });

    await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([], true);

    await expect(lifecycle.resolveThreads()).resolves.toBe(0);
  });

  it("should record this review's findings in the state marker", async () => {
    const lifecycle = createPrReviewLifecycle({
      ...target,
      deps: threadDeps(),
    });
    await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([stillThere, brandNew], true);

    const marker = lifecycle.stateMarker({
      structured: true,
      findings: [stillThere, brandNew],
      inline: new Set([brandNew]),
    });

    const state = parsePrReviewState(marker, signer);
    expect(state?.sha).toBe("newhead1234");
    expect(state?.reviewedAt).toBe("2026-11-09T12:00:00.000Z");
    expect(state?.findings.map((entry) => [entry.key, entry.inline])).toEqual([
      ["aaaaaaaaaaaa", true],
      [lifecycle.keyOf(brandNew), true],
    ]);
  });

  it("should carry the previous state forward when the review judged nothing", async () => {
    const lifecycle = createPrReviewLifecycle({
      ...target,
      deps: threadDeps(),
    });
    await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([], false);

    const marker = lifecycle.stateMarker({
      structured: false,
      findings: [],
      inline: new Set(),
    });

    expect(parsePrReviewState(marker, signer)).toEqual(previousState);
    expect(lifecycle.plan.resolve).toEqual([]);
  });
});

describe("publishInlinePrReview", () => {
  const harnessResult = {
    source: "structured",
    fallbackText: null,
    reviewOutcome: {
      hasIssues: true,
      summary: "Two findings.",
      findings: [stillThere, brandNew],
    },
  } as unknown as PrReviewHarnessResult;

  const freshState = (): PrReviewInlineState => ({
    reviewCheckRunUrl: null,
    reviewGithubReviewPublished: false,
    reviewGithubReviewId: null,
    reviewGithubReviewUrl: null,
    reviewGithubReviewError: null,
    reviewGithubInlineCommentCount: 0,
    reviewInlineFindings: new Set(),
  });

  it("should post only findings without a thread, each with its key marker", async () => {
    const lifecycle = createPrReviewLifecycle({
      ...target,
      deps: threadDeps(),
    });
    await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([stillThere, brandNew], true);
    const createPrReviewGithubReview = vi.fn(async () => ({
      id: 99,
      htmlUrl: "https://github.com/acme/widgets/pull/7#review-99",
    }));
    const state = freshState();

    const published = await publishInlinePrReview({
      deps: { createPrReviewGithubReview } as never,
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 7,
      headSha: "newhead1234",
      state,
      lifecycle,
      harnessResult,
      findings: [stillThere, brandNew],
      conclusion: "success",
    });

    expect(published).toBe(true);
    const [request] = createPrReviewGithubReview.mock.calls[0] as unknown as [
      { comments: Array<{ path: string; line: number; body: string }> },
    ];
    expect(request.comments).toHaveLength(1);
    expect(request.comments[0].body).toContain("New thing");
    expect(request.comments[0].body).toContain(
      findingMarker(lifecycle.keyOf(brandNew) ?? "", signer)
    );
    expect([...state.reviewInlineFindings]).toEqual([brandNew]);
  });

  it("should post no review when every finding already has a thread", async () => {
    const lifecycle = createPrReviewLifecycle({
      ...target,
      deps: threadDeps(),
    });
    await lifecycle.loadHistoryBlock();
    lifecycle.planThreads([stillThere], true);
    const createPrReviewGithubReview = vi.fn();

    const published = await publishInlinePrReview({
      deps: { createPrReviewGithubReview } as never,
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 7,
      headSha: "newhead1234",
      state: freshState(),
      lifecycle,
      harnessResult,
      findings: [stillThere],
      conclusion: "neutral",
    });

    expect(published).toBe(false);
    expect(createPrReviewGithubReview).not.toHaveBeenCalled();
  });
});
