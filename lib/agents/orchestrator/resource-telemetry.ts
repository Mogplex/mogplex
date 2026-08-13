const RESOURCE_TELEMETRY_SCHEMA_VERSION = 1;
const MAX_TELEMETRY_WORKTREES = 50;

export const RESOURCE_DECISION_SOURCES = [
  "none",
  "server_validated_request",
  "owned_control_session",
  "selected",
  "reused_running",
  "reused_pending",
  "created",
  "server_selected",
  "owned_route_validation",
  "persisted_worktree_binding",
] as const;

export type ResourceDecisionSource = (typeof RESOURCE_DECISION_SOURCES)[number];

const RESOURCE_REJECTION_REASONS = [
  "auth_unavailable",
  "mission_mismatch",
  "mission_not_linked",
  "multiple_sandboxes",
  "operation_failed",
  "repo_lookup_failed",
  "repo_mismatch",
  "repo_not_selected",
  "sandbox_inactive",
  "sandbox_lookup_failed",
  "sandbox_mismatch",
  "sandbox_not_found",
  "sandbox_not_selected",
  "sandbox_unavailable",
  "session_not_found",
  "stale_resource",
  "task_not_found",
  "tool_execution_failed",
  "worktree_invalid_state",
  "worktree_lookup_failed",
  "worktree_not_found",
] as const;

export type ResourceRejectionReason =
  (typeof RESOURCE_REJECTION_REASONS)[number];

export type ResourceContextScope = {
  repoId: string | null;
  missionId: string | null;
  orchestrationRunId: string | null;
  selectedSandboxId?: string | null;
};

export type ResourceContextTelemetryInput = {
  scope: ResourceContextScope;
  sandbox: {
    decisionSource: ResourceDecisionSource;
    rejectionReason: ResourceRejectionReason | null;
    recordId: string | null;
    runtimeId: string | null;
  };
  worktrees: {
    decisionSource: ResourceDecisionSource;
    rejectionReason: ResourceRejectionReason | null;
    total: number;
    items: Array<{
      worktreeId: string;
      taskId: string;
      sandboxRecordId: string;
      checkoutPath: string;
    }>;
  };
};

type ToolFinishEvent = {
  success: boolean;
  output?: unknown;
  error?: unknown;
  toolCall: { input?: unknown; toolName: string };
};

type ResourceAction =
  | "run_command"
  | "sandbox_start"
  | "sandbox_stop"
  | "worker_spawn"
  | "worktree_archive"
  | "worktree_diff"
  | "worktree_list"
  | "worktree_prune"
  | "worktree_rebase"
  | "worktree_spawn"
  | "write_file";

const RESOURCE_ACTIONS: Record<string, ResourceAction> = {
  archive_worktree: "worktree_archive",
  diff_worktree: "worktree_diff",
  list_worktrees: "worktree_list",
  prune_worktree: "worktree_prune",
  rebase_worktree: "worktree_rebase",
  run_command: "run_command",
  sandbox_start: "sandbox_start",
  sandbox_stop: "sandbox_stop",
  spawn_subagent: "worker_spawn",
  spawn_worktree: "worktree_spawn",
  write_file: "write_file",
};

const TOOL_DECISION_SOURCES = new Set<string>([
  "selected",
  "reused_running",
  "reused_pending",
  "created",
]);
const RESOURCE_REJECTION_REASON_SET = new Set<string>(
  RESOURCE_REJECTION_REASONS
);

export function isOrchestratorResourceTool(toolName: string) {
  return Object.hasOwn(RESOURCE_ACTIONS, toolName);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readDecisionSource(value: unknown): ResourceDecisionSource | null {
  return typeof value === "string" && TOOL_DECISION_SOURCES.has(value)
    ? (value as ResourceDecisionSource)
    : null;
}

function readRejectionReason(value: unknown): ResourceRejectionReason | null {
  if (typeof value !== "string") return null;
  return RESOURCE_REJECTION_REASON_SET.has(value)
    ? (value as ResourceRejectionReason)
    : null;
}

export function buildResourceContextTelemetry(
  input: ResourceContextTelemetryInput
) {
  const items = input.worktrees.items.slice(0, MAX_TELEMETRY_WORKTREES);
  return {
    schema_version: RESOURCE_TELEMETRY_SCHEMA_VERSION,
    kind: "orchestrator_resource_context" as const,
    repo_id: input.scope.repoId,
    mission_id: input.scope.missionId,
    orchestration_run_id: input.scope.orchestrationRunId,
    sandbox: {
      decision_source: input.sandbox.decisionSource,
      rejection_reason: input.sandbox.rejectionReason,
      record_id: input.sandbox.recordId,
      runtime_id: input.sandbox.runtimeId,
    },
    worktrees: {
      decision_source: input.worktrees.decisionSource,
      rejection_reason: input.worktrees.rejectionReason,
      total: input.worktrees.total,
      truncated: input.worktrees.total > items.length,
      items: items.map((worktree) => ({
        worktree_id: worktree.worktreeId,
        task_id: worktree.taskId,
        sandbox_record_id: worktree.sandboxRecordId,
        checkout_path: worktree.checkoutPath,
      })),
    },
  };
}

function defaultDecisionSource(action: ResourceAction): ResourceDecisionSource {
  if (action === "worktree_spawn" || action === "write_file") {
    return "server_selected";
  }
  if (action === "sandbox_stop") return "owned_route_validation";
  if (action.startsWith("worktree_") || action === "worker_spawn") {
    return "persisted_worktree_binding";
  }
  return "none";
}

function isRejectedToolResult(
  event: ToolFinishEvent,
  output: Record<string, unknown> | null
) {
  if (!event.success) return true;
  return output?.status === "error" || Boolean(output?.error);
}

function resolveRejectionReason(
  event: ToolFinishEvent,
  output: Record<string, unknown> | null
) {
  if (!isRejectedToolResult(event, output)) return null;
  const structured = readRejectionReason(output?.reason);
  if (structured) return structured;
  return event.success ? "operation_failed" : "tool_execution_failed";
}

function resolveSandboxRecordId(input: {
  action: ResourceAction;
  output: Record<string, unknown> | null;
  toolInput: Record<string, unknown> | null;
  worktree: Record<string, unknown> | null;
  selectedSandboxId?: string | null;
}) {
  const resultId =
    readString(input.output, "sandboxId") ??
    readString(input.worktree, "sandbox_id");
  if (resultId) return resultId;
  if (input.action === "worktree_spawn" || input.action === "write_file") {
    return input.selectedSandboxId ?? null;
  }
  return input.action === "sandbox_stop"
    ? readString(input.toolInput, "sandboxId")
    : null;
}

export function buildResourceDecisionTelemetry(
  event: ToolFinishEvent,
  scope: ResourceContextScope
) {
  const action = RESOURCE_ACTIONS[event.toolCall.toolName];
  if (!action) return null;

  const toolInput = asRecord(event.toolCall.input);
  const output = asRecord(event.output);
  const worktree = asRecord(output?.worktree);
  const toolRejected = isRejectedToolResult(event, output);
  const rejectionReason = resolveRejectionReason(event, output);
  const resolutionSource = readDecisionSource(output?.sandboxResolution);
  const decisionSource = resolutionSource ?? defaultDecisionSource(action);
  const sandboxRecordId = resolveSandboxRecordId({
    action,
    output,
    toolInput,
    worktree,
    selectedSandboxId: scope.selectedSandboxId,
  });
  const worktreeId =
    readString(worktree, "id") ?? readString(toolInput, "worktreeId");
  const taskId =
    readString(worktree, "task_id") ?? readString(toolInput, "taskId");

  return {
    schema_version: RESOURCE_TELEMETRY_SCHEMA_VERSION,
    kind: "orchestrator_resource_decision" as const,
    action,
    outcome: toolRejected ? ("rejected" as const) : ("accepted" as const),
    decision_source: decisionSource,
    rejection_reason: rejectionReason,
    repo_id: scope.repoId,
    mission_id: scope.missionId,
    orchestration_run_id: scope.orchestrationRunId,
    sandbox_record_id: sandboxRecordId,
    worktree_id: worktreeId,
    task_id: taskId,
    checkout_path: readString(worktree, "checkout_path"),
  };
}
