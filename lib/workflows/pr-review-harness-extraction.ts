import type {
  AutomationAgentReviewResult,
  PrAutofixCommit,
  PrAutofixOutcome,
  PrReviewHarnessResult,
} from "./pr-review-harness-types";
import {
  isRecord,
  toOptionalString,
  toReviewFindings,
  toStringArray,
} from "./pr-review-harness-utils";

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

export function extractToolInputs(
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

export function extractUpdateFileCommits(
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

export function extractPrAutofixOutcome(
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
