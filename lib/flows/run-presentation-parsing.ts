import type { FlowAgentNodeRole } from "@/lib/types";

export function toOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readNodeRunRole(output: unknown): FlowAgentNodeRole | null {
  if (!isRecord(output)) return null;
  const role = output.role;
  return role === "review" || role === "edit" || role === "triage"
    ? role
    : null;
}

export function readNodeRunSummary(output: unknown) {
  if (!isRecord(output) || typeof output.text !== "string") return null;
  return output.text;
}

export function formatRunSourceType(sourceType: string) {
  const normalized = sourceType.trim().toLowerCase();
  if (normalized === "pr_opened") return "PR OPENED";
  return sourceType.trim().replaceAll("_", " ");
}
