import type {
  FlowAgentNodeRole,
  FlowConditionOperator,
  FlowTransformOperation,
  TriggerEvent,
} from "@/lib/types";

export const TRIGGER_EVENTS = [
  "mention",
  "pr_opened",
  "issue_opened",
  "pr_comment",
  "issue_comment",
  "push",
  "ci_failure",
  "labeled",
  "tag_push",
  "schedule",
  "webhook",
  "slack_mention",
] as const satisfies ReadonlyArray<TriggerEvent>;

export const AGENT_ROLES = [
  "review",
  "edit",
  "triage",
] as const satisfies ReadonlyArray<FlowAgentNodeRole>;

export const CONDITION_OPERATORS = [
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
] as const satisfies ReadonlyArray<FlowConditionOperator>;

export const AWAIT_EVENT_KINDS = [
  "github_label_added",
  "github_comment_added",
  "ci_workflow_completed",
  "vercel_preview_ready",
  "manual_approval",
] as const;

export const AWAIT_TIMEOUT_UNITS = ["minutes", "hours", "days"] as const;

export const TRANSFORM_OPERATIONS = [
  "copy",
  "string_contains",
  "string_split",
  "array_join",
  "array_length",
  "array_includes",
  "files_match_glob",
  "cast_boolean",
  "cast_number",
] as const satisfies ReadonlyArray<FlowTransformOperation>;
