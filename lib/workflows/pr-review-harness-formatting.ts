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
    case "dropped_findings":
      return "Note: The reviewer said it found issues but its report did not list them, so there is no verdict. The text below is its summary only. Rerun the review for a full result.";
    case "legacy_text":
      return "Note: The reviewer finished without filing its structured report, so there is no verdict. The text below is its closing summary only. Rerun the review for a full result.";
    case "not_started":
      return null;
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

/**
 * Indent every line of a finding body so multi-paragraph bodies, lists, and
 * code fences stay inside their bullet instead of breaking out of the list.
 */
function indentListItemBody(body: string) {
  return demoteAgentMarkdownHeadings(body.trim())
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
}

/**
 * Findings that sit in inline threads, each with its thread's URL if known.
 * `carried` holds findings whose thread an earlier review opened: that
 * thread shows the earlier body, so this review's body (which may answer a
 * reply on it) stays in the summary.
 */
export type InlineReviewFindings = {
  links: ReadonlyMap<ReviewFinding, string | null>;
  carried?: ReadonlySet<ReviewFinding>;
};

export function buildReviewFindingsSections(
  findings: ReviewFinding[],
  inline?: InlineReviewFindings | null
) {
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
        `**${section.title}**`,
        entries
          .map((finding) => {
            const location = formatReviewFindingLocation(finding);
            const heading = location
              ? `- **${finding.title}** (${formatInlineCode(location)})`
              : `- **${finding.title}**`;
            if (inline?.links.has(finding)) {
              const url = inline.links.get(finding);
              const linked = url
                ? `${heading}: [inline comment](${url})`
                : `${heading}: inline comment`;
              return inline.carried?.has(finding)
                ? [linked, indentListItemBody(finding.body)]
                    .filter(Boolean)
                    .join("\n")
                : linked;
            }
            return [heading, indentListItemBody(finding.body)]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n"),
      ].join("\n\n")
    );
  }

  return sections;
}

export function formatInlineCode(value: string) {
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

  const lines = [
    autofix.applied ? "**Autofix Applied**" : "**Autofix Not Applied**",
  ];

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

/**
 * What a finished review concluded, from its findings rather than from the
 * model's own flag: any critical or warning finding needs attention; only
 * suggestions does not. A report without findings falls back to its flag.
 */
export type PrReviewVerdict =
  | "incomplete"
  | "blocking"
  | "suggestions"
  | "clean";

export function prReviewVerdict(
  harnessResult: PrReviewHarnessResult | null
): PrReviewVerdict {
  if (isPrReviewVerdictMissing(harnessResult)) return "incomplete";
  const outcome = harnessResult?.reviewOutcome;
  const findings = outcome?.findings ?? [];
  if (findings.some((finding) => finding.severity !== "suggestion"))
    return "blocking";
  if (findings.length > 0) return "suggestions";
  return outcome?.hasIssues ? "blocking" : "clean";
}

/** The check conclusion for a verdict: only a clear verdict is success. */
export function prReviewVerdictConclusion(
  verdict: PrReviewVerdict
): "success" | "neutral" {
  return verdict === "blocking" || verdict === "incomplete"
    ? "neutral"
    : "success";
}

const STATUS_LABELS: Record<PrReviewVerdict, string> = {
  incomplete: "Review incomplete",
  blocking: "Attention needed",
  suggestions: "No blocking issues, suggestions only",
  clean: "No material issues found",
};

const CHECK_TITLES: Record<PrReviewVerdict, string> = {
  incomplete: "Review incomplete",
  blocking: "Review found issues",
  suggestions: "Suggestions only",
  clean: "No issues found",
};

export function buildPrReviewStatusHeading(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
}) {
  if (input.conclusion === "failure") {
    return "**Status:** Review failed";
  }
  return `**Status:** ${STATUS_LABELS[prReviewVerdict(input.harnessResult)]}`;
}

export function buildPrReviewCheckTitle(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
}) {
  if (input.conclusion === "failure") {
    return "Review failed";
  }
  return CHECK_TITLES[prReviewVerdict(input.harnessResult)];
}
