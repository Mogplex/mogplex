/**
 * Utility functions for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import type {
  AutomationSandboxRef,
  RepoVariant,
  AutomationAgentResult,
} from "@/lib/workflows/automation-job-types";
import type { ReviewFinding, SandboxRecord } from "@/lib/types";

export function sumNullableNumbers(
  values: Array<number | null | undefined>
): number | null {
  const defined = values.filter(
    (value): value is number => typeof value === "number"
  );
  if (defined.length === 0) return null;
  return defined.reduce((total, value) => total + value, 0);
}

export function splitRepoFullName(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function extractSandboxRef(
  record: unknown
): AutomationSandboxRef | null {
  if (!record || typeof record !== "object") return null;
  const sandbox = record as Partial<SandboxRecord> & {
    runtime_summary?: { sandbox_id?: string | null };
  };
  if (typeof sandbox.id !== "string") return null;
  return {
    recordId: sandbox.id,
    sandboxId:
      typeof sandbox.sandbox_id === "string"
        ? sandbox.sandbox_id
        : (sandbox.runtime_summary?.sandbox_id ?? null),
    rootDirectory:
      typeof sandbox.root_directory === "string"
        ? sandbox.root_directory
        : null,
  };
}

export function parseSseDataEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");
  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data) {
      events.push(JSON.parse(data));
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

export async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export function pickPreferredRepoVariant(repos: RepoVariant[]) {
  return (
    repos.find((repo) => !repo.root_directory && !repo.parent_repo_id) ||
    repos.find((repo) => !repo.root_directory) ||
    repos[0] ||
    null
  );
}

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

export function toPositiveInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
    ? value
    : null;
}

export function toReviewFindingSeverity(
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

export function normalizeAutomationAssignmentType(type: string) {
  switch (type) {
    case "pr_opened":
      return "pr_review";
    case "issue_opened":
      return "issue_triage";
    case "push":
      return "push_review";
    default:
      return type;
  }
}

export function coercePositivePrNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function formatAutomationTimeoutScopeLabel(assignmentType: string) {
  switch (normalizeAutomationAssignmentType(assignmentType)) {
    case "pr_review":
      return "PR review";
    case "push_review":
      return "push review";
    case "issue_triage":
      return "issue triage";
    case "pr_fix":
      return "PR fix";
    default:
      return "automation run";
  }
}

export function formatAutomationStateScopeLabel(assignmentType: string) {
  return formatAutomationTimeoutScopeLabel(assignmentType);
}

export function formatFailureDurationLabel(durationMs: number) {
  if (durationMs % 1000 === 0) {
    return `${durationMs / 1000}s`;
  }

  return `${durationMs}ms`;
}

export function hasToolCall(result: AutomationAgentResult, toolName: string) {
  return result.steps.some((step) =>
    (step.toolCalls || []).some((toolCall) => toolCall.toolName === toolName)
  );
}

/**
 * Extracts the automation team ID from job metadata.
 * Returns null when the field is missing, wrong shape, or empty — solo jobs
 * (and any legacy rows from before team scope existed) flow through unchanged.
 */
export function readAutomationTeamId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  const raw = (metadata as Record<string, unknown>).team_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
