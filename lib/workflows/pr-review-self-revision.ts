import type { ReviewFormatProblem } from "@/lib/decisions/definitions";
import type { AutomationAgentResult } from "./automation-job-types";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";
import type { ReviewFinding } from "@/lib/types";
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
    "Call reportReview again with the corrected review. Keep your verdict (hasIssues) and every finding with its severity, path, and line; add any you referred to without stating. Do not start a new review and do not call any other tool.",
  ].join("\n");
}

/** Null when the check did not judge the text; that is never a pass. */
export type ReviewFormatJudge = (
  harnessResult: PrReviewHarnessResult
) => Promise<readonly ReviewFormatProblem[] | null>;

/** What identifies a finding across a formatting fix, which may reword its title and body. */
function findingKey(finding: ReviewFinding) {
  return JSON.stringify([finding.severity, finding.path, finding.line]);
}

function keepsEveryFinding(draft: ReviewFinding[], revised: ReviewFinding[]) {
  const remaining = revised.map(findingKey);
  return draft.every((finding) => {
    const index = remaining.indexOf(findingKey(finding));
    if (index === -1) return false;
    remaining.splice(index, 1);
    return true;
  });
}

/**
 * The revision replaces the draft only if it is a report the pipeline
 * trusts, keeps the verdict, and keeps every finding. It may add findings:
 * that is how a draft that mentioned suggestions without stating them gets
 * fixed.
 */
function acceptsRevision(
  draft: PrReviewHarnessResult,
  revised: PrReviewHarnessResult
): boolean {
  return (
    revised.source === "structured" &&
    revised.reviewOutcome.hasIssues === draft.reviewOutcome.hasIssues &&
    keepsEveryFinding(
      draft.reviewOutcome.findings,
      revised.reviewOutcome.findings
    )
  );
}

/**
 * Checks a native review's report before it leaves the run, while the
 * reviewer's conversation still exists. When the format check flags it, the
 * reviewer that wrote it is told what is wrong and files it again. Only the
 * author can fix some problems: a review that mentions suggestions without
 * stating them needs the suggestions, which no rewrite of the text can
 * supply. A result whose report the check judged and passed, as drafted or
 * as revised, carries `reviewFormatPassed` so publishing does not judge it
 * again.
 *
 * Never fails the review: a check that did not run, a revision that fails,
 * or a revision that loses the verdict or a finding leaves the draft
 * unmarked, and publishing checks it again and can still rewrite it.
 */
export async function reviseFlaggedReview(
  input: ReviewerFollowUp & { judge: ReviewFormatJudge }
): Promise<AutomationAgentResult> {
  const state = readReviewReportState(input.result.steps);
  if (state.kind !== "filed") return input.result;
  const draft = extractPrReviewHarnessResult(input.result);

  try {
    const problems = await input.judge(draft);
    if (!problems) return input.result;
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
    return remaining?.length === 0
      ? { ...revision, reviewFormatPassed: true }
      : revision;
  } catch (error) {
    console.warn("[pr-review] review revision failed open", { error });
    return input.result;
  }
}

/**
 * Asks for a missing report, then has the reviewer fix what the format check
 * flags. Both follow-ups continue the review's own transcript; a repair turn
 * is not in it, so the revision request quotes the report the reviewer filed.
 */
export async function finishPrReview(
  input: ReviewerFollowUp & { judge: ReviewFormatJudge }
): Promise<AutomationAgentResult> {
  const reported = await fileMissingReviewReport(input);
  return reviseFlaggedReview({ ...input, result: reported });
}
