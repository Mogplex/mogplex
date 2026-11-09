import { expect, it } from "vitest";
import type { DecisionId } from "@/lib/decisions/types";
import { polishPrReviewForPublish } from "./pr-review-format-check";
import type { PrReviewHarnessResult } from "./pr-review-harness-types";

const review: PrReviewHarnessResult = {
  source: "structured",
  fallbackText: "Approve with suggestions.",
  reviewOutcome: {
    hasIssues: false,
    summary: "Approve-ready. The claim path preserves credentials.",
    commentBody: null,
    affectedFiles: [],
    findings: [],
  },
};

it("does not publish a rewrite approved only in advise mode", async () => {
  const decide = async (id: DecisionId) => ({
    id,
    mode: id === "review_format" ? ("enforce" as const) : ("advise" as const),
    status: "ok" as const,
    verdict: "act" as const,
    act: true,
    escalated: false,
    answers: {
      denseParagraph: { type: "boolean" as const, probability: 0.95 },
    },
    commit: async () => {},
  });

  const published = await polishPrReviewForPublish(
    review,
    { surface: "pr_review", userId: "user-1", teamId: "team-1" },
    {},
    {
      available: () => true,
      decide,
      rewrite: async () => ({
        rewrite: {
          summary: "Rewritten by the evaluation model",
          commentBody: null,
          findingBodies: [],
        },
        usage: {},
      }),
    }
  );

  expect(published).toBe(review);
});
