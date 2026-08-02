import type {
  FlowAgentHarness,
  FlowAgentNodeRole,
  FlowConditionOperator,
  FlowDelayNodeData,
  FlowGraph,
  FlowNodeType,
  TriggerEvent,
} from "@/lib/types";

export const CONDITION_HANDLE_IDS = {
  true: "true",
  false: "false",
} as const;

// Marks an outbound edge as the failure-recovery branch from a node whose
// execution can fail. Mirrors how condition nodes overload sourceHandle for
// then/else routing — no schema change required.
export const FAILURE_HANDLE_ID = "error" as const;

export type FlowFailureTokenPayload = {
  error: string;
  failed_node_id: string;
  failed_node_label: string;
  failed_node_type: FlowNodeType;
};

export function isFailureTokenPayload(
  value: unknown
): value is FlowFailureTokenPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.error === "string" &&
    typeof record.failed_node_id === "string" &&
    typeof record.failed_node_label === "string" &&
    typeof record.failed_node_type === "string"
  );
}

export function getFailureEdges(graph: FlowGraph, nodeId: string) {
  return graph.edges.filter(
    (edge) => edge.source === nodeId && edge.sourceHandle === FAILURE_HANDLE_ID
  );
}

export const FLOW_AGENT_ROLE_OPTIONS = ["review", "edit", "triage"] as const;

export function isFlowAgentNodeRole(
  value: unknown
): value is FlowAgentNodeRole {
  return FLOW_AGENT_ROLE_OPTIONS.includes(value as FlowAgentNodeRole);
}

export function isFlowAgentHarness(value: unknown): value is FlowAgentHarness {
  return value === "mogplex" || value === "claude-code" || value === "codex";
}

export function flowAgentHarnessLabel(harness: FlowAgentHarness) {
  switch (harness) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "mogplex":
    default:
      return "Mogplex";
  }
}

export function flowAgentRoleLabel(role: FlowAgentNodeRole) {
  switch (role) {
    case "review":
      return "Review";
    case "edit":
      return "Fix";
    case "triage":
      return "Respond";
  }
}

// Comment-based start events that can carry pull request context inline (the
// comment body itself is the "finding"), so a fix node triggered by one of
// these does not need an upstream Review-role agent to feed it findings.
//
// `issue_comment` is intentionally excluded: the webhook router only emits it
// for true issue comments (`is_pr === false`); PR conversation comments come
// through as `pr_comment`. A fix node triggered by `issue_comment` could never
// resolve a PR number to commit against, so we keep the validator strict for
// that event rather than letting users save a flow that always dead-ends at
// runtime.
const COMMENT_TRIGGER_EVENTS: ReadonlySet<TriggerEvent> = new Set([
  "mention",
  "pr_comment",
]);

export function isCommentTriggerEvent(
  event: TriggerEvent | null | undefined
): boolean {
  return event != null && COMMENT_TRIGGER_EVENTS.has(event);
}

export function getDefaultFlowAgentRole(
  event?: TriggerEvent
): FlowAgentNodeRole {
  switch (event) {
    case "mention":
    case "issue_opened":
    case "issue_comment":
      return "triage";
    case "pr_opened":
    case "pr_comment":
    case "push":
    case "ci_failure":
    case "labeled":
    case "tag_push":
    default:
      return "review";
  }
}

export function eventLabel(event: TriggerEvent) {
  switch (event) {
    case "mention":
      return "@mogplex";
    case "pr_opened":
      return "PR opened";
    case "issue_opened":
      return "Issue opened";
    case "pr_comment":
      return "PR comment";
    case "issue_comment":
      return "Issue comment";
    case "push":
      return "Push";
    case "ci_failure":
      return "CI failure";
    case "labeled":
      return "Label added";
    case "tag_push":
      return "Tag pushed";
    case "schedule":
      return "Schedule";
    case "webhook":
      return "Webhook";
    case "slack_mention":
      return "Slack mention";
  }
}

export function conditionOperatorLabel(operator: FlowConditionOperator) {
  switch (operator) {
    case "exists":
      return "exists";
    case "equals":
      return "equals";
    case "not_equals":
      return "does not equal";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
    case "starts_with":
      return "starts with";
    case "ends_with":
      return "ends with";
    case "greater_than":
      return "is greater than";
    case "less_than":
      return "is less than";
    case "in":
      return "is one of";
    case "not_in":
      return "is none of";
    case "is_empty":
      return "is empty";
    case "is_not_empty":
      return "is not empty";
  }
}

export const CONDITION_OPERATORS: ReadonlyArray<FlowConditionOperator> = [
  "exists",
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "less_than",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
];

// Operators that ignore their value field. UI hides the value input for these,
// and validation does not require a non-empty value.
export const VALUE_LESS_CONDITION_OPERATORS: ReadonlySet<FlowConditionOperator> =
  new Set(["exists", "is_empty", "is_not_empty"]);

export function isConditionOperator(
  value: unknown
): value is FlowConditionOperator {
  return CONDITION_OPERATORS.includes(value as FlowConditionOperator);
}

// Field presets surfaced in the inspector for `If` nodes. These cover the
// metadata routinely set by the dispatch layer plus the per-node output
// channels the runtime exposes during evaluation.
export const FLOW_CONDITION_FIELD_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "metadata.source_type", label: "metadata.source_type" },
  { value: "metadata.pr_number", label: "metadata.pr_number" },
  { value: "metadata.head_ref", label: "metadata.head_ref" },
  { value: "metadata.base_ref", label: "metadata.base_ref" },
  { value: "metadata.sender_login", label: "metadata.sender_login" },
  { value: "metadata.labels", label: "metadata.labels" },
  { value: "metadata.label_name", label: "metadata.label_name" },
  { value: "metadata.tag_name", label: "metadata.tag_name" },
  { value: "repo.full_name", label: "repo.full_name" },
  { value: "repo.default_branch", label: "repo.default_branch" },
  { value: "previous_outputs", label: "previous_outputs" },
];

export function getDelayNodeMs(data: FlowDelayNodeData) {
  const duration = Number(data.duration);
  if (!Number.isFinite(duration) || duration <= 0) return 0;

  const unitMultiplier =
    data.unit === "hours"
      ? 60 * 60 * 1000
      : data.unit === "minutes"
        ? 60 * 1000
        : 1000;

  return Math.round(duration * unitMultiplier);
}

export function hasUpstreamAgentRole(
  graph: FlowGraph,
  nodeId: string,
  role: FlowAgentNodeRole
) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const existing = incoming.get(edge.target) ?? [];
    existing.push(edge.source);
    incoming.set(edge.target, existing);
  }

  const visited = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = nodesById.get(currentId);
    if (node?.type === "agent" && (node.data.role ?? "review") === role) {
      return true;
    }

    stack.push(...(incoming.get(currentId) ?? []));
  }

  return false;
}
