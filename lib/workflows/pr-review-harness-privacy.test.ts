import { expect, it } from "vitest";
import {
  buildPrReviewCheckSummary,
  buildPrReviewCheckText,
  buildPrReviewTimelineCommentBody,
  type PrReviewFailureDetails,
} from "./pr-review-harness";

const raw =
  "A positive credit balance is required for all requests, including BYOK. Add credits at https://vercel.com/account/top-up.";

it.each([
  raw,
  "Provider rejected account private-account: secret diagnostic",
  "<html>internal outage</html>",
])("keeps failed review diagnostics private: %s", (error) => {
  const failureDetails: PrReviewFailureDetails = {
    error,
    reasonLabel: error,
    modelFailureClass: error,
    modelFailureMessage: error,
    modelFailureStatusCode: 402,
    infraFailureMessage: error,
    runtimeRunId: "private-runtime-id",
    modelAttempts: 1,
    modelEffectiveTimeoutMs: 750000,
  };
  const input = {
    harnessResult: null,
    fallbackText: error,
    conclusion: "failure" as const,
    failureDetails,
  };
  const expected =
    "Mogplex could not complete this review. Please try again later. If the problem continues, contact Mogplex support.";
  expect(buildPrReviewCheckText(input)).toBe(expected);
  expect(buildPrReviewCheckSummary(input)).toBe(expected);
  const body = buildPrReviewTimelineCommentBody({
    ...input,
    checkRunUrl: "https://github.com/example/repo/runs/123",
  });
  expect(body).toContain(expected);
  expect(body).toContain(
    "[View check run](https://github.com/example/repo/runs/123)"
  );
  expect(body).not.toMatch(/402|750|Diagnostics|private-runtime-id/);
  expect(failureDetails.error).toBe(error);
  expect(failureDetails.modelFailureMessage).toBe(error);
});

it("ignores partial model prose when a review failed", () => {
  expect(
    buildPrReviewCheckText({
      conclusion: "failure",
      fallbackText: null,
      harnessResult: {
        source: "structured",
        fallbackText: raw,
        reviewOutcome: {
          hasIssues: false,
          summary: raw,
          commentBody: raw,
          findings: [],
          affectedFiles: [],
        },
      },
    })
  ).not.toContain(raw);
});

it("gives a safe timeout explanation without provider details", () => {
  const input = {
    harnessResult: null,
    fallbackText: raw,
    conclusion: "failure" as const,
    failureDetails: { modelFailureClass: "timeout" },
  };
  expect(buildPrReviewCheckText(input)).toBe(
    "The review timed out before it completed. Please rerun the review. If the problem continues, contact Mogplex support."
  );
  expect(buildPrReviewCheckSummary(input)).toBe(buildPrReviewCheckText(input));
});
