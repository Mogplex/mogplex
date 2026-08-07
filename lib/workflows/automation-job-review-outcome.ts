import { isFlowAgentNodeRole } from "@/lib/flows/graph";
import type { FlowAgentNodeRole, FlowNode } from "@/lib/types";
import type { FlowExecutionToken } from "@/lib/workflows/automation-job-types";
import type { ReviewOutcome } from "@/lib/workflows/pr-review-harness";
import {
  isRecord,
  toOptionalString,
  toReviewFindings,
  toStringArray,
} from "@/lib/workflows/automation-job-utils";

export function resolveFlowAgentNodeRole(
  node: Extract<FlowNode, { type: "agent" }>
): FlowAgentNodeRole {
  return isFlowAgentNodeRole(node.data.role) ? node.data.role : "review";
}

export function synthesizeReviewOutcomeFromComment(
  metadata: Record<string, unknown>
): ReviewOutcome | null {
  const body = toOptionalString(metadata.comment_body)?.trim();
  if (!body) return null;

  // The comment body IS the user-supplied "finding" for comment-triggered fix
  // flows. Materialize it as a single-summary ReviewOutcome so the downstream
  // PR fix harness sees the same shape it would from an in-flow Review node.
  return {
    hasIssues: true,
    summary: body,
    commentBody: body,
    affectedFiles: [],
    findings: [],
  } satisfies ReviewOutcome;
}

export function extractFlowReviewOutcome(
  tokens: FlowExecutionToken[]
): ReviewOutcome | null {
  const activeTokens = tokens.filter((token) => !token.skipped);
  const reviewTokens = activeTokens.filter((token) => {
    const role = token.payload?.role;
    return role === undefined || role === "review";
  });
  const structuredReviews = reviewTokens
    .map((token) => token.payload?.review)
    .flatMap((review) => {
      if (
        !isRecord(review) ||
        typeof review.hasIssues !== "boolean" ||
        typeof review.summary !== "string"
      ) {
        return [];
      }

      return [
        {
          hasIssues: review.hasIssues,
          summary: review.summary,
          commentBody: toOptionalString(review.commentBody),
          affectedFiles: toStringArray(review.affectedFiles),
          findings: toReviewFindings(review.findings),
        } satisfies ReviewOutcome,
      ];
    });

  if (structuredReviews.length > 0) {
    return {
      hasIssues: structuredReviews.some((review) => review.hasIssues),
      summary: structuredReviews
        .map((review) => review.summary.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim(),
      commentBody:
        structuredReviews
          .map((review) => review.commentBody?.trim())
          .find(Boolean) ?? null,
      affectedFiles: Array.from(
        new Set(structuredReviews.flatMap((review) => review.affectedFiles))
      ),
      findings: Array.from(
        new Map(
          structuredReviews
            .flatMap((review) => review.findings)
            .map((finding) => [
              [
                finding.severity,
                finding.title,
                finding.body,
                finding.path ?? "",
                finding.line ?? "",
              ].join("::"),
              finding,
            ])
        ).values()
      ),
    };
  }

  const combinedSummary = reviewTokens
    .map((token) => token.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!combinedSummary) {
    return null;
  }

  return {
    hasIssues: true,
    summary: combinedSummary,
    commentBody: null,
    affectedFiles: [],
    findings: [],
  };
}
