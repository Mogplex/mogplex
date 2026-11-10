import { describe, expect, it, vi } from "vitest";
import { serializePrReviewState } from "./pr-review-history";
import {
  createPrReviewLifecycle,
  type PrReviewThreadsDeps,
} from "./pr-review-lifecycle-runner";
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
  findings: [],
};

const threadDeps = (
  overrides: Partial<PrReviewThreadsDeps> = {}
): PrReviewThreadsDeps => ({
  readPrReviewTimelineComments: async () => [],
  listPrReviewThreads: async () => [],
  comparePrCommits: async () => ({
    status: "ahead",
    files: [],
    complete: true,
  }),
  listPrConversationComments: async () => [],
  replyAndResolvePrReviewThread: vi.fn(async () => undefined),
  signingSecret: () => "test-secret",
  ...overrides,
});

describe("createPrReviewLifecycle.supersededByNewerReview", () => {
  it("should report a newer review that published after this run read the PR", async () => {
    const summary = (reviewedAt: string) => ({
      body: `review\n${serializePrReviewState({ ...previousState, reviewedAt }, signer)}`,
      author: "mogplex[bot]",
    });
    const readsThen = (later: string) => {
      let reads = 0;
      return threadDeps({
        readPrReviewTimelineComments: async () => {
          reads += 1;
          return reads === 1
            ? [summary(previousState.reviewedAt)]
            : [summary(previousState.reviewedAt), summary(later)];
        },
      });
    };
    const superseded = async (deps: PrReviewThreadsDeps) => {
      const lifecycle = createPrReviewLifecycle({ ...target, deps });
      await lifecycle.loadHistoryBlock();
      return lifecycle.supersededByNewerReview();
    };

    // This run read the PR at 12:00, when the 10:00 review was the latest.
    // A run that started later published first:
    await expect(
      superseded(readsThen("2026-11-09T12:05:00.000Z"))
    ).resolves.toBe(true);
    // A run that started earlier published after this run's read:
    await expect(
      superseded(readsThen("2026-11-09T11:55:00.000Z"))
    ).resolves.toBe(true);
    // Nothing published since:
    await expect(superseded(readsThen(previousState.reviewedAt))).resolves.toBe(
      false
    );

    // The first read failed, so only a later read time proves a newer review.
    const firstReadFails = (later: string) => {
      let reads = 0;
      return threadDeps({
        readPrReviewTimelineComments: async () => {
          reads += 1;
          if (reads === 1) throw new Error("rest");
          return [summary(previousState.reviewedAt), summary(later)];
        },
      });
    };
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      superseded(firstReadFails("2026-11-09T11:55:00.000Z"))
    ).resolves.toBe(false);
    await expect(
      superseded(firstReadFails("2026-11-09T12:05:00.000Z"))
    ).resolves.toBe(true);
    quiet.mockRestore();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let reads = 0;
    const failing = threadDeps({
      readPrReviewTimelineComments: async () => {
        reads += 1;
        if (reads > 1) throw new Error("rest");
        return [summary(previousState.reviewedAt)];
      },
    });
    await expect(superseded(failing)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[pr-review] newer-review check failed",
      expect.objectContaining({ prNumber: 7 })
    );
    warn.mockRestore();
  });
});
