import type { ReviewFormatProblem } from "@/lib/decisions/definitions";
import type { AutomationAgentResult } from "./automation-job-types";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";
import type { PrReviewHarnessResult } from "./pr-review-harness-types";
import {
  askReviewerForReport,
  fileMissingReviewReport,
  type ReviewerFollowUp,
} from "./pr-review-report-repair";
import { readReviewReportState } from "./pr-review-report-state";

/** What the reviewer is told for each problem the format check can find. */
export const REVIEW_FORMAT_FEEDBACK: Readonly<
  Record<ReviewFormatProblem, string>
> = {
  denseParagraph:
    "A paragraph covers several separate checks or findings. Put them in a bullet list, one point per bullet.",
  processTalk:
    "The review names internal tools or report fields, such as reportReview, hasIssues, commentBody, or findings. Describe the code, not the report.",
  danglingReference:
    "The review says suggestions, notes, or details exist without stating them. State each one; file every suggestion as a finding with severity suggestion.",
  bareCode:
    "File paths, functions, or identifiers appear as plain text. Wrap each one in backticks.",
};

export function buildReviewRevisionRequest(
  problems: readonly ReviewFormatProblem[],
  report: Record<string, unknown>
): string {
  return [
    "Mogplex checked the review you filed before publishing it and found these problems:",
    ...problems.map((problem) => `- ${REVIEW_FORMAT_FEEDBACK[problem]}`),
    `The report you filed: ${JSON.stringify(report)}`,
    "Call reportReview again with the corrected review. Keep your verdict and every finding. Do not start a new review and do not call any other tool.",
  ].join("\n");
}

export type ReviewFormatJudge = (
  harnessResult: PrReviewHarnessResult
) => Promise<readonly ReviewFormatProblem[]>;

/** The revision replaces the draft only if it is a report the pipeline trusts and keeps every finding. */
function acceptsRevision(
  draft: PrReviewHarnessResult,
  revised: PrReviewHarnessResult
): boolean {
  return (
    revised.source === "structured" &&
    revised.reviewOutcome.findings.length >= draft.reviewOutcome.findings.length
  );
}

/**
 * Checks a native review's report before it leaves the run, while the
 * reviewer's conversation still exists. When the format check flags it, the
 * reviewer that wrote it is told what is wrong and files it again. Only the
 * author can fix some problems: a review that mentions suggestions without
 * stating them needs the suggestions, which no rewrite of the text can
 * supply. A result whose report passed, as drafted or as revised, carries
 * `reviewFormatPassed` so publishing does not judge it again.
 *
 * Never fails the review: a check or revision that fails, or a revision that
 * loses the verdict or a finding, leaves the draft as it was, and publishing
 * still runs the platform rewrite on it.
 */
export async function reviseFlaggedReview(
  input: ReviewerFollowUp & { judge: ReviewFormatJudge }
): Promise<AutomationAgentResult> {
  const state = readReviewReportState(input.result.steps);
  if (state.kind !== "filed") return input.result;
  const draft = extractPrReviewHarnessResult(input.result);

  try {
    const problems = await input.judge(draft);
    if (problems.length === 0) {
      return { ...input.result, reviewFormatPassed: true };
    }
    const revision = await askReviewerForReport({
      ...input,
      request: buildReviewRevisionRequest(problems, state.report),
    });
    if (!revision) return input.result;
    const revised = extractPrReviewHarnessResult(revision);
    if (!acceptsRevision(draft, revised)) return input.result;
    const remaining = await input.judge(revised);
    return remaining.length === 0
      ? { ...revision, reviewFormatPassed: true }
      : revision;
  } catch (error) {
    console.warn("[pr-review] review revision failed open", { error });
    return input.result;
  }
}

/** Asks for a missing report, then has the reviewer fix what the format check flags. */
export async function finishPrReview(
  input: ReviewerFollowUp & { judge: ReviewFormatJudge }
): Promise<AutomationAgentResult> {
  const reported = await fileMissingReviewReport(input);
  return reviseFlaggedReview({ ...input, result: reported });
}
