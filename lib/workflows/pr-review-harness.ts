import type { ReviewFinding } from "@/lib/types";
import {
  formatAutomationInfrastructureFailureLabel,
  sanitizeAutomationInfrastructureText,
} from "@/lib/workflows/automation-infra-failures";

type AutomationAgentReviewResult = {
  text: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
};

export type ReviewOutcome = {
  hasIssues: boolean;
  summary: string;
  commentBody: string | null;
  affectedFiles: string[];
  findings: ReviewFinding[];
};

export type PrAutofixCommit = {
  path: string | null;
  branch: string | null;
  commitSha: string | null;
  commitUrl: string | null;
};

export type PrAutofixOutcome = {
  applied: boolean;
  summary: string | null;
  updatedFiles: string[];
  commits: PrAutofixCommit[];
};

export type PrReviewContractSource =
  | "structured"
  | "legacy_post_comment"
  | "legacy_text";

export type PrReviewHarnessResult = {
  source: PrReviewContractSource;
  reviewOutcome: ReviewOutcome;
  fallbackText: string | null;
  autofix?: PrAutofixOutcome | null;
};

export type PrReviewConclusion = "success" | "neutral" | "failure";

export type PrReviewFailureDetails = {
  reasonLabel?: string | null;
  error?: string | null;
  infraFailureClass?: string | null;
  infraFailureMessage?: string | null;
  modelFailureClass?: string | null;
  modelFailureMessage?: string | null;
  modelFailureStatusCode?: number | null;
  modelEffectiveTimeoutMs?: number | null;
  modelAttempts?: number | null;
  modelRetryAttempted?: boolean | null;
  modelRetryCount?: number | null;
  runtimeProvider?: string | null;
  runtimeRunId?: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
    )
    .slice(0, 20);
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
    ? value
    : null;
}

function toReviewFindingSeverity(
  value: unknown
): ReviewFinding["severity"] | null {
  return value === "critical" || value === "warning" || value === "suggestion"
    ? value
    : null;
}

export function toReviewFindings(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const severity = toReviewFindingSeverity(entry.severity);
    const title = toOptionalString(entry.title);
    const body = toOptionalString(entry.body);

    if (!severity || !title || !body) {
      return [];
    }

    return [
      {
        severity,
        title,
        body,
        path: toOptionalString(entry.path),
        line: toPositiveInteger(entry.line),
      },
    ];
  });
}

function extractLastToolInput(
  result: AutomationAgentReviewResult,
  toolName: string
) {
  for (
    let stepIndex = result.steps.length - 1;
    stepIndex >= 0;
    stepIndex -= 1
  ) {
    const toolCalls = result.steps[stepIndex]?.toolCalls || [];
    for (let callIndex = toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      const toolCall = toolCalls[callIndex];
      if (toolCall?.toolName !== toolName || !isRecord(toolCall.input)) {
        continue;
      }

      return toolCall.input;
    }
  }

  return null;
}

function extractToolInputs(
  result: AutomationAgentReviewResult,
  toolName: string
) {
  const inputs: Array<Record<string, unknown>> = [];

  for (const step of result.steps) {
    for (const toolCall of step.toolCalls || []) {
      if (toolCall?.toolName === toolName && isRecord(toolCall.input)) {
        inputs.push(toolCall.input);
      }
    }
  }

  return inputs;
}

function extractLastToolStringField(
  result: AutomationAgentReviewResult,
  toolName: string,
  fieldName: string
) {
  const toolInput = extractLastToolInput(result, toolName);
  return toolInput ? toOptionalString(toolInput[fieldName]) : null;
}

function appendUniqueString(values: string[], value: string | null) {
  if (!value || values.includes(value)) {
    return values;
  }

  return [...values, value];
}

function extractUpdateFileCommits(
  result: AutomationAgentReviewResult
): PrAutofixCommit[] {
  const commits: PrAutofixCommit[] = [];
  const seen = new Set<string>();

  for (const step of result.steps) {
    const toolCalls = step.toolCalls || [];
    const toolResults = step.toolResults || [];

    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      if (toolCall?.toolName !== "updateFile") {
        continue;
      }

      const toolResult = toolResults[index];
      const inputPath = isRecord(toolCall.input)
        ? toOptionalString(toolCall.input.path)
        : null;
      const output = isRecord(toolResult) ? toolResult : null;

      if (output?.success !== true) {
        continue;
      }

      const path = toOptionalString(output.path) ?? inputPath;
      const branch = toOptionalString(output.branch);
      const commitSha = toOptionalString(output.commitSha);
      const commitUrl = toOptionalString(output.commitUrl);
      const key = commitSha ?? commitUrl ?? `${branch ?? ""}:${path ?? ""}`;

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      commits.push({ path, branch, commitSha, commitUrl });
    }
  }

  return commits.slice(0, 20);
}

function extractPrAutofixOutcome(
  result: AutomationAgentReviewResult
): PrAutofixOutcome | null {
  const reports = extractToolInputs(result, "reportFix");
  const commits = extractUpdateFileCommits(result);

  if (reports.length === 0 && commits.length === 0) {
    return null;
  }

  let updatedFiles: string[] = [];
  const summaries: string[] = [];

  for (const report of reports) {
    for (const file of toStringArray(report.updatedFiles)) {
      updatedFiles = appendUniqueString(updatedFiles, file);
    }

    const summary = toOptionalString(report.summary);
    if (summary) {
      summaries.push(summary);
    }
  }

  for (const commit of commits) {
    updatedFiles = appendUniqueString(updatedFiles, commit.path);
  }

  const applied =
    commits.length > 0 || reports.some((report) => report.applied === true);

  return {
    applied,
    summary: summaries.length > 0 ? summaries.join("\n\n") : null,
    updatedFiles: updatedFiles.slice(0, 20),
    commits,
  };
}

function buildPrReviewContractNote(source: PrReviewContractSource) {
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

function buildReviewFindingsSections(findings: ReviewFinding[]) {
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

function buildAutofixSection(autofix: PrAutofixOutcome | null | undefined) {
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

function formatReviewFindingSeverityLabel(severity: ReviewFinding["severity"]) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "suggestion":
      return "Suggestion";
  }
}

function isInlinePublishableReviewFinding(finding: ReviewFinding) {
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

function buildPrReviewFailureDiagnosticsSection(
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

export function extractPrReviewHarnessResult(
  result: AutomationAgentReviewResult
): PrReviewHarnessResult {
  const report = extractLastToolInput(result, "reportReview");
  const autofix = extractPrAutofixOutcome(result);
  if (report) {
    return {
      source: "structured",
      fallbackText: toOptionalString(result.text),
      reviewOutcome: {
        hasIssues: report.hasIssues === true,
        summary: toOptionalString(report.summary) ?? result.text ?? "",
        commentBody: toOptionalString(report.commentBody),
        affectedFiles: toStringArray(report.affectedFiles),
        findings: toReviewFindings(report.findings),
      },
      ...(autofix ? { autofix } : {}),
    };
  }

  const legacyCommentBody = extractLastToolStringField(
    result,
    "postComment",
    "body"
  );
  if (legacyCommentBody) {
    return {
      source: "legacy_post_comment",
      fallbackText: legacyCommentBody,
      reviewOutcome: {
        hasIssues: true,
        summary: toOptionalString(result.text) ?? legacyCommentBody,
        commentBody: legacyCommentBody,
        affectedFiles: [],
        findings: [],
      },
      ...(autofix ? { autofix } : {}),
    };
  }

  const fallbackText = toOptionalString(result.text);
  return {
    source: "legacy_text",
    fallbackText,
    reviewOutcome: {
      hasIssues: false,
      summary: fallbackText ?? "Review completed without a structured report.",
      commentBody: null,
      affectedFiles: [],
      findings: [],
    },
    ...(autofix ? { autofix } : {}),
  };
}

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

function shouldSanitizePrReviewFallbackText(input: {
  conclusion: PrReviewConclusion;
}) {
  return input.conclusion === "failure";
}

function resolvePrReviewFallbackText(input: {
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

export function buildPrReviewCheckText(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  failureDetails?: PrReviewFailureDetails | null;
}) {
  const parts: string[] = [];
  const reviewOutcome = input.harnessResult?.reviewOutcome ?? null;
  const fallbackText = resolvePrReviewFallbackText({
    fallbackText:
      input.harnessResult?.fallbackText ?? toOptionalString(input.fallbackText),
    conclusion: input.conclusion,
  });
  const contractNote = input.harnessResult
    ? buildPrReviewContractNote(input.harnessResult.source)
    : null;

  if (contractNote) {
    parts.push(contractNote);
  }

  // With a structured report the findings sections below already carry the
  // full review, so a commentBody that restates them would double-report;
  // lead with the short summary instead.
  const preferSummaryNarrative =
    input.harnessResult?.source === "structured" &&
    (reviewOutcome?.findings.length ?? 0) > 0;
  const narrative = preferSummaryNarrative
    ? (toOptionalString(reviewOutcome?.summary) ??
      toOptionalString(reviewOutcome?.commentBody) ??
      toOptionalString(fallbackText))
    : (toOptionalString(reviewOutcome?.commentBody) ??
      toOptionalString(fallbackText));
  if (narrative) {
    parts.push(demoteAgentMarkdownHeadings(narrative));
  }

  if ((reviewOutcome?.affectedFiles.length ?? 0) > 0) {
    parts.push(
      [
        "Affected files:",
        ...reviewOutcome!.affectedFiles.map((file) => `- ${file}`),
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

  const failureDiagnostics = buildPrReviewFailureDiagnosticsSection(
    input.failureDetails
  );
  if (failureDiagnostics) {
    parts.push(failureDiagnostics);
  }

  return parts.join("\n\n").trim();
}

export function buildPrReviewCheckSummary(input: {
  harnessResult: PrReviewHarnessResult | null;
  fallbackText: string | null | undefined;
  conclusion: PrReviewConclusion;
  failureDetails?: PrReviewFailureDetails | null;
}) {
  const fallbackText = resolvePrReviewFallbackText({
    fallbackText:
      input.harnessResult?.fallbackText ?? toOptionalString(input.fallbackText),
    conclusion: input.conclusion,
  });

  if (input.conclusion !== "failure") {
    return demoteAgentMarkdownHeadings(
      input.harnessResult?.reviewOutcome.summary ??
        fallbackText ??
        "Mogplex completed the pull request review."
    );
  }

  const infraFailureClass = formatAutomationInfrastructureFailureLabel(
    input.failureDetails?.infraFailureClass
  );
  const failureClass = formatFailureClassLabel(
    input.failureDetails?.modelFailureClass
  );
  const reasonLabel = toOptionalString(input.failureDetails?.reasonLabel);
  const statusCode =
    typeof input.failureDetails?.modelFailureStatusCode === "number" &&
    Number.isFinite(input.failureDetails.modelFailureStatusCode)
      ? input.failureDetails.modelFailureStatusCode
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

  return fallbackText ?? "Mogplex could not complete the pull request review.";
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

export function shouldRetryPrReviewWithoutInlineComments(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /GitHub PR review publish failed \(422\):/i.test(error.message);
}
