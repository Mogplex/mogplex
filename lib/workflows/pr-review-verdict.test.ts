import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/lib/types";
import {
  buildPrReviewCheckSummary,
  buildPrReviewCheckText,
  buildPrReviewCheckTitle,
  buildPrReviewStatusHeading,
  prReviewVerdict,
  prReviewVerdictConclusion,
  type PrReviewHarnessResult,
} from "./pr-review-harness";

const finding = (severity: ReviewFinding["severity"]): ReviewFinding => ({
  severity,
  title: `A ${severity}`,
  body: "Body.",
  path: "src/a.ts",
  line: 1,
});

const report = (
  findings: ReviewFinding[],
  hasIssues = findings.length > 0
): PrReviewHarnessResult => ({
  source: "structured",
  fallbackText: null,
  reviewOutcome: {
    hasIssues,
    summary: "One-line verdict.",
    commentBody: null,
    affectedFiles: [],
    findings,
  },
});

describe("prReviewVerdict", () => {
  it("should decide from finding severity rather than the model's flag", () => {
    expect(prReviewVerdict(report([finding("warning")], false))).toBe(
      "blocking"
    );
    expect(prReviewVerdict(report([finding("critical")]))).toBe("blocking");
    expect(prReviewVerdict(report([finding("suggestion")], true))).toBe(
      "suggestions"
    );
    expect(prReviewVerdict(report([]))).toBe("clean");
    expect(prReviewVerdict(report([], true))).toBe("blocking");
  });

  it("should pass the check only for a clear verdict", () => {
    expect(prReviewVerdictConclusion("blocking")).toBe("neutral");
    expect(prReviewVerdictConclusion("incomplete")).toBe("neutral");
    expect(prReviewVerdictConclusion("suggestions")).toBe("success");
    expect(prReviewVerdictConclusion("clean")).toBe("success");
  });

  it("should label a suggestions-only review as non-blocking", () => {
    const harnessResult = report([finding("suggestion")], true);

    expect(
      buildPrReviewStatusHeading({ harnessResult, conclusion: "success" })
    ).toBe("**Status:** No blocking issues, suggestions only");
    expect(
      buildPrReviewCheckTitle({ harnessResult, conclusion: "success" })
    ).toBe("Suggestions only");
  });
});

describe("buildPrReviewCheckText", () => {
  it("should not repeat the summary the check already shows above its text", () => {
    const harnessResult = report([finding("warning")]);
    const text = buildPrReviewCheckText({
      harnessResult,
      fallbackText: null,
      conclusion: "neutral",
      shownSummary: "One-line verdict.",
    });

    expect(text).not.toContain("One-line verdict.");
    expect(text).toContain("**Warnings**");
  });

  it("should not repeat a summary that starts with a markdown heading", () => {
    const base = report([finding("warning")]);
    const harnessResult: PrReviewHarnessResult = {
      ...base,
      reviewOutcome: {
        ...base.reviewOutcome,
        summary: "## Verdict\n\nThe guard is missing.",
      },
    };
    const shownSummary = buildPrReviewCheckSummary({
      harnessResult,
      fallbackText: null,
      conclusion: "neutral",
    });

    const text = buildPrReviewCheckText({
      harnessResult,
      fallbackText: null,
      conclusion: "neutral",
      shownSummary,
    });

    expect(text).not.toContain("The guard is missing.");
  });
});
