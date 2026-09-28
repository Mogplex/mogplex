import type { ReviewFinding } from "@/lib/types";
import type {
  PrReviewConclusion,
  PrReviewFailureDetails,
  PrReviewHarnessResult,
  ReviewOutcome,
  PrAutofixOutcome,
} from "./pr-review-harness-types";
import { toOptionalString } from "./pr-review-harness-utils";
import {
  buildAutofixSection,
  buildPrReviewContractNote,
  buildPrReviewFailureMessage,
  buildPrReviewStatusHeading,
  buildReviewFindingsSections,
  demoteAgentMarkdownHeadings,
  formatInlineCode,
  formatReviewFindingSeverityLabel,
  isInlinePublishableReviewFinding,
} from "./pr-review-harness-formatting";

// Re-export types from split modules
export type {
  ReviewOutcome,
  PrAutofixCommit,
  PrAutofixOutcome,
  PrReviewContractSource,
  PrReviewHarnessResult,
  PrReviewConclusion,
  PrReviewFailureDetails,
} from "./pr-review-harness-types";

// Re-export utilities from split modules
export {
  isRecord,
  toOptionalString,
  toStringArray,
  toReviewFindings,
} from "./pr-review-harness-utils";

// Re-export extraction functions from split modules
export {
  extractPrReviewHarnessResult,
  isPrReviewVerdictMissing,
} from "./pr-review-harness-extraction";

// Re-export formatting functions from split modules
export {
  demoteAgentMarkdownHeadings,
  buildPrReviewStatusHeading,
  buildPrReviewCheckTitle,
} from "./pr-review-harness-formatting";

export function buildPrReviewInlineComments(findings: ReviewFinding[]) {
  return findings.flatMap((finding) => {
    if (!finding.path || finding.line == null) {
      return [];
    }

    return [
      {
        path: finding.path,
        line: finding.line,
        body: [
          `**${formatReviewFindingSeverityLabel(finding.severity)}:** ${finding.title}`,
          demoteAgentMarkdownHeadings(finding.body),
        ].join("\n\n"),
      },
    ];
  });
}

/**
 * The published narrative of a structured report comes only from the report.
 * The model's closing chat message is not part of it: it restates the review
 * as one paragraph and can mention suggestions it never filed.
 */
function buildStructuredReviewNarrative(reviewOutcome: ReviewOutcome | null) {
  const summary = toOptionalString(reviewOutcome?.summary);
  // With findings, the sections below carry the full review, so a
  // commentBody that restates them would double-report.
  if ((reviewOutcome?.findings.length ?? 0) > 0) {
    return summary ?? toOptionalString(reviewOutcome?.commentBody);
  }
  const commentBody = toOptionalString(reviewOutcome?.commentBody);
  if (!commentBody) return summary;
  if (!summary || commentBody.includes(summary)) return commentBody;
  return `${summary}\n\n${commentBody}`;
}

export function buildPrReviewCheckText(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  failureDetails?: PrReviewFailureDetails | null;
}) {
  if (input.conclusion === "failure") {
    return buildPrReviewFailureMessage(input.failureDetails);
  }
  const parts: string[] = [];
  const reviewOutcome = input.harnessResult?.reviewOutcome ?? null;
  const fallbackText =
    input.harnessResult?.fallbackText ?? toOptionalString(input.fallbackText);
  const contractNote = input.harnessResult
    ? buildPrReviewContractNote(input.harnessResult.source)
    : null;

  if (contractNote) {
    parts.push(contractNote);
  }

  const narrative =
    input.harnessResult?.source === "structured"
      ? buildStructuredReviewNarrative(reviewOutcome)
      : (toOptionalString(reviewOutcome?.commentBody) ??
        toOptionalString(fallbackText));
  if (narrative) {
    parts.push(demoteAgentMarkdownHeadings(narrative));
  }

  if ((reviewOutcome?.affectedFiles.length ?? 0) > 0) {
    parts.push(
      [
        "**Affected files**",
        ...reviewOutcome!.affectedFiles.map(
          (file) => `- ${formatInlineCode(file)}`
        ),
      ].join("\n")
    );
  }

  if ((reviewOutcome?.findings.length ?? 0) > 0) {
    parts.push(...buildReviewFindingsSections(reviewOutcome!.findings));
  }

  const autofixSection = buildAutofixSection(input.harnessResult?.autofix);
  if (autofixSection) {
    parts.push(autofixSection);
  }

  return parts.join("\n\n").trim();
}

export function buildPrReviewCheckSummary(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  failureDetails?: PrReviewFailureDetails | null;
}) {
  if (input.conclusion === "failure") {
    return buildPrReviewFailureMessage(input.failureDetails);
  }
  return demoteAgentMarkdownHeadings(
    input.harnessResult?.reviewOutcome.summary ??
      input.harnessResult?.fallbackText ??
      toOptionalString(input.fallbackText) ??
      "Mogplex completed the pull request review."
  );
}

export function buildPrReviewTimelineCommentBody(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  checkRunUrl?: string | null;
  failureDetails?: PrReviewFailureDetails | null;
}) {
  const detail = buildPrReviewCheckText({
    harnessResult: input.harnessResult,
    fallbackText: input.fallbackText,
    conclusion: input.conclusion,
    failureDetails: input.failureDetails,
  });
  const parts = ["## Mogplex PR Review", buildPrReviewStatusHeading(input)];

  if (detail) {
    parts.push(detail);
  }

  if (input.checkRunUrl?.trim()) {
    parts.push(`[View check run](${input.checkRunUrl.trim()})`);
  }

  return parts.join("\n\n").trim();
}

export function buildPrReviewGithubReviewBody(input: {
  reviewOutcome: ReviewOutcome;
  conclusion: PrReviewConclusion;
  checkRunUrl?: string | null;
  inlineCommentCount: number;
  autofix?: PrAutofixOutcome | null;
}) {
  const summary =
    toOptionalString(input.reviewOutcome.summary) ??
    toOptionalString(input.reviewOutcome.commentBody);
  const parts = [
    "## Mogplex PR Review",
    buildPrReviewStatusHeading({
      harnessResult: {
        source: "structured",
        fallbackText: null,
        reviewOutcome: input.reviewOutcome,
      },
      conclusion: input.conclusion,
    }),
  ];
  const findingsForBody =
    input.inlineCommentCount > 0
      ? input.reviewOutcome.findings.filter(
          (finding) => !isInlinePublishableReviewFinding(finding)
        )
      : input.reviewOutcome.findings;

  if (summary) {
    parts.push(demoteAgentMarkdownHeadings(summary));
  }

  if (input.inlineCommentCount > 0) {
    parts.push(
      input.inlineCommentCount === 1
        ? "1 finding was added inline."
        : `${input.inlineCommentCount} findings were added inline.`
    );
  }

  if (findingsForBody.length > 0) {
    parts.push(...buildReviewFindingsSections(findingsForBody));
  }

  const autofixSection = buildAutofixSection(input.autofix);
  if (autofixSection) {
    parts.push(autofixSection);
  }

  if (input.checkRunUrl?.trim()) {
    parts.push(`[View check run](${input.checkRunUrl.trim()})`);
  }

  return parts.join("\n\n").trim();
}

export function shouldRetryPrReviewWithoutInlineComments(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /GitHub PR review publish failed \(422\):/i.test(error.message);
}
