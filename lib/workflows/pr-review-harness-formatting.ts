import type { ReviewFinding } from "@/lib/types";
import {
  formatAutomationInfrastructureFailureLabel,
  sanitizeAutomationInfrastructureText,
} from "@/lib/workflows/automation-infra-failures";
import type {
  PrAutofixCommit,
  PrAutofixOutcome,
  PrReviewContractSource,
  PrReviewConclusion,
  PrReviewFailureDetails,
  PrReviewHarnessResult,
} from "./pr-review-harness-types";
import { toOptionalString } from "./pr-review-harness-utils";

export function buildPrReviewContractNote(source: PrReviewContractSource) {
  switch (source) {
    case "legacy_post_comment":
      return "Note: Structured review output was missing, so Mogplex used the legacy review comment as fallback output.";
    case "legacy_text":
      return "Note: Structured review output was missing, so Mogplex used the agent summary text as fallback output.";
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

function formatFailureClassLabel(value: string | null | undefined) {
  switch (value) {
    case "timeout":
      return "Timeout";
    case "rate_limited":
      return "Rate limited";
    case "provider_unavailable":
      return "Provider unavailable";
    case "dependency_unavailable":
      return "Dependency unavailable";
    case "authentication":
      return "Authentication";
    case "configuration":
      return "Configuration";
    case "unknown":
      return "Unknown";
    default:
      return toOptionalString(value);
  }
}

function formatDurationLabel(durationMs: number) {
  if (durationMs % 1000 === 0) {
    return `${durationMs / 1000}s`;
  }

  return `${durationMs}ms`;
}

function stripPublicRuntimeHandle(value: string | null | undefined) {
  const text = toOptionalString(value);
  if (!text) {
    return null;
  }

  const stripped = text
    .replace(/\s*Runtime:\s*(?:[a-z][\w-]*:\s*)?\S+\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return stripped.length > 0 ? stripped : null;
}

function sanitizePrReviewFailureText(value: string | null | undefined) {
  return stripPublicRuntimeHandle(sanitizeAutomationInfrastructureText(value));
}

export function buildPrReviewFailureDiagnosticsSection(
  failureDetails: PrReviewFailureDetails | null | undefined
) {
  if (!failureDetails) {
    return null;
  }

  const lines: string[] = [];
  const reasonLabel = toOptionalString(failureDetails.reasonLabel);
  const infraFailureClass = formatAutomationInfrastructureFailureLabel(
    failureDetails.infraFailureClass
  );
  const infraFailureDetail = toOptionalString(
    failureDetails.infraFailureMessage
  );
  const failureClass = formatFailureClassLabel(
    failureDetails.modelFailureClass
  );
  const errorMessage = sanitizePrReviewFailureText(failureDetails.error);
  const providerDetail = stripPublicRuntimeHandle(
    failureDetails.modelFailureMessage
  );

  if (reasonLabel) {
    lines.push(`- Failure type: ${reasonLabel}`);
  }

  if (infraFailureClass) {
    lines.push(`- Infra failure: ${infraFailureClass}`);
  }

  if (failureClass) {
    lines.push(`- Model failure: ${failureClass}`);
  }

  if (
    typeof failureDetails.modelFailureStatusCode === "number" &&
    Number.isFinite(failureDetails.modelFailureStatusCode)
  ) {
    lines.push(`- HTTP status: ${failureDetails.modelFailureStatusCode}`);
  }

  if (
    typeof failureDetails.modelEffectiveTimeoutMs === "number" &&
    Number.isFinite(failureDetails.modelEffectiveTimeoutMs) &&
    failureDetails.modelEffectiveTimeoutMs > 0
  ) {
    lines.push(
      `- Timeout budget: ${formatDurationLabel(failureDetails.modelEffectiveTimeoutMs)}`
    );
  }

  if (
    typeof failureDetails.modelAttempts === "number" &&
    Number.isFinite(failureDetails.modelAttempts) &&
    failureDetails.modelAttempts > 0
  ) {
    lines.push(`- Attempts: ${failureDetails.modelAttempts}`);
  }

  if (typeof failureDetails.modelRetryAttempted === "boolean") {
    lines.push(
      `- Retry attempted: ${failureDetails.modelRetryAttempted ? "Yes" : "No"}`
    );
  }

  if (
    failureDetails.modelRetryAttempted === true &&
    typeof failureDetails.modelRetryCount === "number" &&
    Number.isFinite(failureDetails.modelRetryCount)
  ) {
    lines.push(`- Retry count: ${failureDetails.modelRetryCount}`);
  }

  if (
    infraFailureDetail &&
    infraFailureDetail !== errorMessage &&
    !errorMessage?.includes(infraFailureDetail)
  ) {
    lines.push(`- Infra detail: ${infraFailureDetail}`);
  }

  if (
    providerDetail &&
    providerDetail !== errorMessage &&
    !errorMessage?.includes(providerDetail)
  ) {
    lines.push(`- Provider detail: ${providerDetail}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return ["Diagnostics", ...lines].join("\n");
}

function shouldSanitizePrReviewFallbackText(input: {
  conclusion: PrReviewConclusion;
}) {
  return input.conclusion === "failure";
}

export function resolvePrReviewFallbackText(input: {
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
}) {
  const fallbackText = toOptionalString(input.fallbackText);
  if (!fallbackText) {
    return null;
  }

  return shouldSanitizePrReviewFallbackText(input)
    ? sanitizePrReviewFailureText(fallbackText)
    : fallbackText;
}

export function buildPrReviewStatusHeading(input: {
  harnessResult: PrReviewHarnessResult | null;
  conclusion: PrReviewConclusion;
}) {
  if (input.conclusion === "failure") {
    return "**Status:** Review failed";
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

  return input.harnessResult?.reviewOutcome.hasIssues
    ? "Review found issues"
    : "No issues found";
}

export function formatFailureClassLabelForSummary(
  failureDetails: PrReviewFailureDetails | null | undefined
) {
  const infraFailureClass = formatAutomationInfrastructureFailureLabel(
    failureDetails?.infraFailureClass
  );
  const failureClass = formatFailureClassLabel(
    failureDetails?.modelFailureClass
  );
  const reasonLabel = toOptionalString(failureDetails?.reasonLabel);
  const statusCode =
    typeof failureDetails?.modelFailureStatusCode === "number" &&
    Number.isFinite(failureDetails.modelFailureStatusCode)
      ? failureDetails.modelFailureStatusCode
      : null;

  const summaryDetail = infraFailureClass ?? failureClass;
  const summaryCore = summaryDetail
    ? reasonLabel
      ? `${reasonLabel}: ${summaryDetail}`
      : `Review failed: ${summaryDetail}`
    : reasonLabel;

  if (summaryCore) {
    return statusCode == null
      ? summaryCore
      : `${summaryCore} (HTTP ${statusCode})`;
  }

  return null;
}
