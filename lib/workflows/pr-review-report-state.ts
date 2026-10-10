import type { AutomationAgentReviewResult } from "./pr-review-harness-types";
import { isRecord, toReviewFindings } from "./pr-review-harness-utils";

export const REPORT_REVIEW_TOOL_NAME = "reportReview";

/** Native reviews obtain their evidence through tools before filing a report. */
export function hasReviewToolCalls(
  steps: AutomationAgentReviewResult["steps"]
): boolean {
  return steps.some((step) => (step.toolCalls?.length ?? 0) > 0);
}

export type ReviewReportState =
  | { kind: "missing" }
  | { kind: "filed"; report: Record<string, unknown> }
  | { kind: "dropped_findings"; report: Record<string, unknown> };

/** A report that clears the review: no issues and nothing listed. */
export function clearsReviewWithoutFindings(
  report: Record<string, unknown>
): boolean {
  return (
    report.hasIssues !== true && toReviewFindings(report.findings).length === 0
  );
}

/**
 * The reviewer's report as the pipeline should trust it. Only calls the SDK
 * accepted count as filed; a call whose input failed the schema was never
 * recorded. A report that clears the review when any call in the run,
 * accepted or rejected, before or after it, said there were issues has lost
 * them: reviewers told that hasIssues=true needs findings sometimes flip
 * hasIssues to false instead of listing them, and that report would
 * otherwise publish as a clean verdict with its warnings gone. A report that
 * listed findings followed by one that clears them is treated the same way,
 * since nothing says the findings were wrong. The rule is about lost
 * findings, not the verdict: an accepted report that lists findings (say,
 * hasIssues=false with suggestions) has lost nothing, so a claim before or
 * after it leaves it filed. Steps are one review session's, including its
 * follow-ups; a flow's later review node is judged on its own steps.
 */
export function readReviewReportState(
  steps: AutomationAgentReviewResult["steps"]
): ReviewReportState {
  const calls = reportCalls(steps);
  const claimedIssues = calls.some((call) => call.input.hasIssues === true);
  const report = calls.findLast((call) => !call.invalid)?.input;
  if (!report) return { kind: "missing" };
  return claimedIssues && clearsReviewWithoutFindings(report)
    ? { kind: "dropped_findings", report }
    : { kind: "filed", report };
}

function reportCalls(steps: AutomationAgentReviewResult["steps"]) {
  return steps.flatMap((step) =>
    (step.toolCalls ?? []).flatMap((toolCall) =>
      toolCall.toolName === REPORT_REVIEW_TOOL_NAME && isRecord(toolCall.input)
        ? [{ input: toolCall.input, invalid: toolCall.invalid === true }]
        : []
    )
  );
}
