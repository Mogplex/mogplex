export const ORCHESTRATION_RUN_STATUSES = [
  "drafting_master_spec",
  "awaiting_master_approval",
  "generating_sub_specs",
  "awaiting_task_approval",
  "launching_sandboxes",
  "running_tasks",
  "integrating",
  "conflict_resolution",
  "validating",
  "ready_for_pr",
  "pr_open",
  "completed",
  "failed",
  "cancelled",
] as const;

export type OrchestrationRunStatus =
  (typeof ORCHESTRATION_RUN_STATUSES)[number];

export const ORCHESTRATION_TASK_STATUSES = [
  "planned",
  "queued",
  "launching_sandbox",
  "running",
  "needs_user",
  "pushed",
  "merge_ready",
  "merged",
  "conflict",
  "failed",
  "cancelled",
] as const;

export type OrchestrationTaskStatus =
  (typeof ORCHESTRATION_TASK_STATUSES)[number];

export const ORCHESTRATION_SPEC_KINDS = [
  "master",
  "task",
  "integration",
] as const;

export type OrchestrationSpecKind = (typeof ORCHESTRATION_SPEC_KINDS)[number];

export const KNOWN_ORCHESTRATION_SPEC_STATUSES = ["draft", "approved"] as const;

export type KnownOrchestrationSpecStatus =
  (typeof KNOWN_ORCHESTRATION_SPEC_STATUSES)[number];

export const ORCHESTRATION_MERGE_EVENT_STATUSES = [
  "started",
  "merged",
  "conflict",
  "resolved",
  "failed",
] as const;

export type OrchestrationMergeEventStatus =
  (typeof ORCHESTRATION_MERGE_EVENT_STATUSES)[number];

export const ORCHESTRATION_EVENT_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type OrchestrationEventLevel =
  (typeof ORCHESTRATION_EVENT_LEVELS)[number];

export const ORCHESTRATION_APPROVAL_MODES = [
  "manual",
  "auto_dispatch",
  "trusted_autopilot",
] as const;

export type OrchestrationApprovalMode =
  (typeof ORCHESTRATION_APPROVAL_MODES)[number];

export const ORCHESTRATION_HARNESSES = ["codex", "claude-code"] as const;

export type OrchestrationHarness = (typeof ORCHESTRATION_HARNESSES)[number];

const TERMINAL_RUN_STATUSES = new Set<OrchestrationRunStatus>([
  "completed",
  "cancelled",
]);

const TERMINAL_TASK_STATUSES = new Set<OrchestrationTaskStatus>([
  "merged",
  "cancelled",
]);

const RETRYABLE_RUN_STATUSES = new Set<OrchestrationRunStatus>(["failed"]);

const NON_MERGE_BLOCKING_TASK_STATUSES = new Set<OrchestrationTaskStatus>([
  "pushed",
  "merge_ready",
  "merged",
  "cancelled",
]);

const RUN_STATUSES = new Set<string>(ORCHESTRATION_RUN_STATUSES);
const TASK_STATUSES = new Set<string>(ORCHESTRATION_TASK_STATUSES);
const KNOWN_SPEC_STATUSES = new Set<string>(KNOWN_ORCHESTRATION_SPEC_STATUSES);
const MERGE_EVENT_STATUSES = new Set<string>(
  ORCHESTRATION_MERGE_EVENT_STATUSES
);
const EVENT_LEVELS = new Set<string>(ORCHESTRATION_EVENT_LEVELS);
const APPROVAL_MODES = new Set<string>(ORCHESTRATION_APPROVAL_MODES);
const HARNESSES = new Set<string>(ORCHESTRATION_HARNESSES);

export function isOrchestrationRunStatus(
  value: unknown
): value is OrchestrationRunStatus {
  return typeof value === "string" && RUN_STATUSES.has(value);
}

export function isOrchestrationTaskStatus(
  value: unknown
): value is OrchestrationTaskStatus {
  return typeof value === "string" && TASK_STATUSES.has(value);
}

export function isOrchestrationMergeEventStatus(
  value: unknown
): value is OrchestrationMergeEventStatus {
  return typeof value === "string" && MERGE_EVENT_STATUSES.has(value);
}

export function isKnownOrchestrationSpecStatus(
  value: unknown
): value is KnownOrchestrationSpecStatus {
  return typeof value === "string" && KNOWN_SPEC_STATUSES.has(value);
}

export function isOrchestrationEventLevel(
  value: unknown
): value is OrchestrationEventLevel {
  return typeof value === "string" && EVENT_LEVELS.has(value);
}

export function isOrchestrationApprovalMode(
  value: unknown
): value is OrchestrationApprovalMode {
  return typeof value === "string" && APPROVAL_MODES.has(value);
}

export function isOrchestrationHarness(
  value: unknown
): value is OrchestrationHarness {
  return typeof value === "string" && HARNESSES.has(value);
}

export function isTerminalRunStatus(status: OrchestrationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function isTerminalTaskStatus(status: OrchestrationTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function isRetryableRunStatus(status: OrchestrationRunStatus): boolean {
  return RETRYABLE_RUN_STATUSES.has(status);
}

export function isRunnableTaskStatus(status: OrchestrationTaskStatus): boolean {
  return status === "queued" || status === "needs_user";
}

export function isRetryableTaskStatus(
  status: OrchestrationTaskStatus
): boolean {
  return (
    status === "needs_user" || status === "failed" || status === "conflict"
  );
}

export function isMergeBlockingTaskStatus(
  status: OrchestrationTaskStatus
): boolean {
  return !NON_MERGE_BLOCKING_TASK_STATUSES.has(status);
}
