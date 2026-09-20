import type { ReviewFinding } from "@/lib/types";
import { isPrReviewVerdictMissing } from "./pr-review-harness-extraction";
import type {
  PrAutofixCommit,
  PrAutofixOutcome,
  PrReviewContractSource,
  PrReviewConclusion,
  PrReviewFailureDetails,
  PrReviewHarnessResult,
} from "./pr-review-harness-types";

export function buildPrReviewContractNote(source: PrReviewContractSource) {
  switch (source) {
    case "legacy_post_comment":
      return "Note: Structured review output was missing, so Mogplex used the legacy review comment as fallback output.";
    case "legacy_text":
      return "Note: The reviewer finished without filing its structured report, so there is no verdict. The text below is its closing summary only. Rerun the review for a full result.";
    case "structured":
      return null;
  }
}

function formatReviewFindingLocation(finding: ReviewFinding) {
  if (finding.path) {
    return finding.line == null
      ? finding.path
      : `${finding.path}:L${finding.line}`;
  }

  return null;
}

/**
 * Agent-authored markdown gets embedded below Mogplex's own
 * "## Mogplex PR Review" heading, so any ATX headings the model emits would
 * render at the same visual weight as the comment title. Demote them to bold
 * text; leave fenced code blocks untouched.
 */
export function demoteAgentMarkdownHeadings(value: string) {
  let inFence = false;
  return value
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (!heading || heading[1].length === 0) {
        return line;
      }
      return `**${heading[1]}**`;
    })
    .join("\n");
}

export function buildReviewFindingsSections(findings: ReviewFinding[]) {
  const sections: string[] = [];
  const orderedSections: Array<{
    title: string;
    severity: ReviewFinding["severity"];
  }> = [
    { title: "Critical Issues", severity: "critical" },
    { title: "Warnings", severity: "warning" },
    { title: "Suggestions", severity: "suggestion" },
  ];

  for (const section of orderedSections) {
    const entries = findings.filter(
      (finding) => finding.severity === section.severity
    );
    if (entries.length === 0) {
      continue;
    }

    sections.push(
      [
        section.title,
        ...entries.flatMap((finding) => {
          const location = formatReviewFindingLocation(finding);
          const heading = location
            ? `- ${finding.title} (${location})`
            : `- ${finding.title}`;
          return [heading, `  ${demoteAgentMarkdownHeadings(finding.body)}`];
        }),
      ].join("\n")
    );
  }

  return sections;
}

function formatInlineCode(value: string) {
  return `\`${value.replaceAll("`", "'")}\``;
}

function formatCommitDiffLine(commit: PrAutofixCommit) {
  const shortSha = commit.commitSha ? commit.commitSha.slice(0, 7) : null;
  const commitLabel = shortSha ?? commit.commitUrl ?? "commit";
  const link = commit.commitUrl
    ? `[${commitLabel}](${commit.commitUrl})`
    : commitLabel;
  const path = commit.path ? ` ${formatInlineCode(commit.path)}` : "";

  return `- ${link}${path}`;
}

export function buildAutofixSection(
  autofix: PrAutofixOutcome | null | undefined
) {
  if (!autofix) {
    return null;
  }

  const lines = [autofix.applied ? "Autofix Applied" : "Autofix Not Applied"];

  if (autofix.summary) {
    lines.push(autofix.summary);
  }

  if (autofix.updatedFiles.length > 0) {
    lines.push(
      [
        "Updated files:",
        ...autofix.updatedFiles.map((file) => `- ${formatInlineCode(file)}`),
      ].join("\n")
    );
  }

  if (autofix.commits.length > 0) {
    lines.push(
      ["Commit diffs:", ...autofix.commits.map(formatCommitDiffLine)].join("\n")
    );
  }

  return lines.join("\n");
}

export function formatReviewFindingSeverityLabel(
  severity: ReviewFinding["severity"]
) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "suggestion":
      return "Suggestion";
  }
}

export function isInlinePublishableReviewFinding(finding: ReviewFinding) {
  return Boolean(finding.path) && finding.line != null;
}

/** Public failure output is authored here, never copied from provider diagnostics.
 * Raw messages and routing/billing metadata remain in the internal run record.
 */
export function buildPrReviewFailureMessage(
  failureDetails: PrReviewFailureDetails | null | undefined
) {
  if (failureDetails?.modelFailureClass === "timeout") {
    return "The review timed out before it completed. Please rerun the review. If the problem continues, contact Mogplex support.";
  }
  return "Mogplex could not complete this review. Please try again later. If the problem continues, contact Mogplex support.";
}

export function buildPrReviewStatusHeading(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
}) {
  if (input.conclusion === "failure") {
    return "**Status:** Review failed";
  }

  if (isPrReviewVerdictMissing(input.harnessResult)) {
    return "**Status:** Review incomplete";
  }

  return input.harnessResult?.reviewOutcome.hasIssues
    ? "**Status:** Attention needed"
    : "**Status:** No material issues found";
}

export function buildPrReviewCheckTitle(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
}) {
  if (input.conclusion === "failure") {
    return "Review failed";
  }

  if (isPrReviewVerdictMissing(input.harnessResult)) {
    return "Review incomplete";
  }

  return input.harnessResult?.reviewOutcome.hasIssues
    ? "Review found issues"
    : "No issues found";
}
