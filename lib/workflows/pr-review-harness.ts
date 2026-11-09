import type {
  PrReviewConclusion,
  PrReviewContractSource,
  PrReviewFailureDetails,
  PrReviewHarnessResult,
  ReviewOutcome,
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
  type InlineReviewFindings,
} from "./pr-review-harness-formatting";
import {
  describeReviewAnchor,
  type AnchoredReviewComment,
} from "./pr-review-anchors";

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
  prReviewVerdict,
  prReviewVerdictConclusion,
  type InlineReviewFindings,
  type PrReviewVerdict,
} from "./pr-review-harness-formatting";

/** GitHub review comments for findings anchored to the diff. */
export function buildPrReviewInlineComments(comments: AnchoredReviewComment[]) {
  return comments.map((comment) => ({
    path: comment.path,
    line: comment.line,
    body: [
      `**${formatReviewFindingSeverityLabel(comment.finding.severity)}:** ${comment.finding.title}`,
      describeReviewAnchor(comment),
      demoteAgentMarkdownHeadings(comment.finding.body),
    ]
      .filter(Boolean)
      .join("\n\n"),
  }));
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

function buildPrReviewNarrative(
  source: PrReviewContractSource | undefined,
  reviewOutcome: ReviewOutcome | null,
  fallbackText: string | null | undefined
) {
  if (source === "structured") {
    return buildStructuredReviewNarrative(reviewOutcome);
  }
  // The caller's fallback is the model's raw text, which a review that never
  // started must not publish; its authored summary is the whole message.
  if (source === "not_started") {
    return toOptionalString(reviewOutcome?.summary);
  }
  return (
    toOptionalString(reviewOutcome?.commentBody) ??
    toOptionalString(fallbackText)
  );
}

export function buildPrReviewCheckText(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  failureDetails?: PrReviewFailureDetails | null;
  /** Shown above this text (the check summary); not repeated in it. */
  shownSummary?: string | null;
  inline?: InlineReviewFindings | null;
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

  const narrative = buildPrReviewNarrative(
    input.harnessResult?.source,
    reviewOutcome,
    fallbackText
  );
  // The check summary is demoted too, so compare the demoted forms.
  const shownNarrative = narrative
    ? demoteAgentMarkdownHeadings(narrative)
    : "";
  if (shownNarrative && shownNarrative.trim() !== input.shownSummary?.trim()) {
    parts.push(shownNarrative);
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
    parts.push(
      ...buildReviewFindingsSections(reviewOutcome!.findings, input.inline)
    );
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

/**
 * The canonical review summary: one comment per pull request, updated in
 * place on every run. Findings that were posted inline are listed with a
 * link to their comment instead of being repeated.
 */
export function buildPrReviewTimelineCommentBody(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  checkRunUrl?: string | null;
  failureDetails?: PrReviewFailureDetails | null;
  inline?: InlineReviewFindings | null;
}) {
  const detail = buildPrReviewCheckText({
    harnessResult: input.harnessResult,
    fallbackText: input.fallbackText,
    conclusion: input.conclusion,
    failureDetails: input.failureDetails,
    inline: input.inline,
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

/**
 * The native review only carries the inline comments. Its body points at the
 * canonical summary comment rather than repeating the review.
 */
export function buildPrReviewGithubReviewBody(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
  checkRunUrl?: string | null;
  inlineCommentCount: number;
}) {
  const parts = [
    "## Mogplex PR Review",
    buildPrReviewStatusHeading(input),
    input.inlineCommentCount === 1
      ? "1 finding is on the changed lines below. The full review is in the Mogplex PR Review comment on this pull request."
      : `${input.inlineCommentCount} findings are on the changed lines below. The full review is in the Mogplex PR Review comment on this pull request.`,
  ];
  if (input.checkRunUrl?.trim()) {
    parts.push(`[View check run](${input.checkRunUrl.trim()})`);
  }
  return parts.join("\n\n").trim();
}
