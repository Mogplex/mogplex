/**
 * Flow graph, node, and runtime types.
 */

import type { TriggerEvent } from "./common";
import type { FlowActionNodeData } from "./flow-action";
import type { FlowConditionNodeData } from "./flow-condition";
import type {
  FlowSetVariableNodeData,
  FlowTransformNodeData,
} from "./flow-transform";
import type { JobRunSummary } from "./job-run";

// Re-export imported types for convenience
export type {
  FlowActionNodeData,
  FlowActionOperation,
  FlowGithubCommitStatusState,
  FlowGithubReviewEvent,
} from "./flow-action";
export type {
  FlowConditionNodeData,
  FlowConditionOperator,
  FlowConditionRule,
  FlowConditionRuleMode,
} from "./flow-condition";
export type {
  FlowSetVariableAssignment,
  FlowSetVariableNodeData,
  FlowTransformAssignment,
  FlowTransformNodeData,
  FlowTransformOperation,
} from "./flow-transform";

export type FlowNodeType =
  | "start"
  | "agent"
  | "action"
  | "condition"
  | "parallel"
  | "join"
  | "delay"
  | "await_event"
  | "set_variable"
  | "transform"
  | "end";

export type FlowAwaitEventKind =
  | "github_label_added"
  | "github_comment_added"
  | "ci_workflow_completed"
  | "vercel_preview_ready"
  | "manual_approval";

export type FlowAwaitEventTimeoutUnit = "minutes" | "hours" | "days";

export type FlowNodePosition = {
  x: number;
  y: number;
};

export type FlowStartFilterScope = "all" | "org" | "personal";

export type FlowStartAuthorFilter =
  | "any"
  | "humans_only"
  | "exclude_dependabot"
  | "dependabot_only";

export type FlowStartFilter = {
  scope: FlowStartFilterScope;
  installationIds?: number[];
  repos?: string[];
  authorFilter?: FlowStartAuthorFilter;
};

export type FlowStartNodeData = {
  label: string;
  event: TriggerEvent;
  isDefault?: boolean;
  filter?: FlowStartFilter;
  // `labeled` event only, mirroring FlowAwaitEventConfig: the exact label name
  // that starts the flow (empty/absent = any label) and whether to fire only
  // when the label lands on a pull request rather than an issue.
  labelName?: string;
  labelPrOnly?: boolean;
  // `tag_push` event only: minimal glob over the tag name (`*` matches any run
  // of characters, everything else is literal; empty/absent = any tag).
  tagPattern?: string;
  // `schedule` event only. Trigger.dev evaluates this five-field cron in the
  // selected IANA timezone and passes the scheduled timestamp into the flow.
  scheduleCron?: string;
  scheduleTimezone?: string;
  // `slack_mention` event only. Both values identify one connected workspace
  // channel; channelName is display-only and may be absent on older drafts.
  slackTeamId?: string;
  slackChannelId?: string;
  slackChannelName?: string | null;
};

export type FlowAgentNodeData = {
  label: string;
  agentId: string | null;
  harness?: FlowAgentHarness;
  role?: FlowAgentNodeRole;
  autofix?: boolean;
  autofixSandbox?: boolean;
  autoMerge?: boolean;
  // ci_failure flows only: expose a revert tool that can open a revert PR for
  // the commit that broke CI. Never a direct push; the agent decides whether
  // to call it.
  autoRevert?: boolean;
  // Pause before every tool call and wait for a human approve/deny decision.
  // Waits share a bounded budget per node run; unanswered requests are denied
  // and the run continues -- it never hangs. Gates every tool loop this node
  // executes, including autofix and sandbox-tool fixes.
  requireApproval?: boolean;
  modelOverride?: string | null;
  // User-picked fallback model: when the primary provider has upstream issues
  // mid-run, AI Gateway routing retries on this model instead of the shared
  // env/default pool. Optional; the pool applies when unset.
  fallbackModelOverride?: string | null;
  maxStepsOverride?: number | null;
  timeoutMsOverride?: number | null;
  systemPromptOverride?: string | null;
};

export type FlowAgentHarness = "mogplex" | "claude-code" | "codex";

export type FlowAgentNodeRole = "review" | "edit" | "triage";

export type FlowParallelNodeData = {
  label: string;
};

export type FlowJoinPolicy = "wait_for_all" | "wait_for_any" | "quorum";

export type FlowJoinNodeData = {
  label: string;
  policy?: FlowJoinPolicy;
  quorum?: number | null;
};

export type FlowDelayNodeData = {
  label: string;
  duration: number;
  unit: "seconds" | "minutes" | "hours";
};

export type FlowCiWorkflowConclusion =
  | "any"
  | "success"
  | "failure"
  | "cancelled";

// Await configs are persisted in published graph JSON and copied into
// flow_waits at runtime. expectedSha is runtime-only correlation state: the
// operator fills it from the triggering event when matchTriggerSha is enabled.
export type FlowAwaitEventConfig =
  | {
      kind: "github_label_added";
      labelName: string;
      // When true, only fire if the labeled event came from a pull request
      // (the GitHub `labeled` action carries `pull_request` for PRs, `issue`
      // for issues).
      prOnly?: boolean;
    }
  | {
      kind: "github_comment_added";
      // Optional case-insensitive substring and exact-login filters. Empty
      // values match any comment/author.
      bodyContains: string;
      authorLogin: string;
      prOnly?: boolean;
      // By default, wait on the issue or PR that started this run. The
      // operator resolves expectedIssueNumber at runtime from event metadata.
      matchTriggerIssue?: boolean;
      expectedIssueNumber?: number | null;
    }
  | {
      kind: "ci_workflow_completed";
      workflowName: string;
      conclusion: FlowCiWorkflowConclusion;
      matchTriggerSha?: boolean;
      expectedSha?: string | null;
    }
  | {
      kind: "vercel_preview_ready";
      environment: string;
      matchTriggerSha?: boolean;
      expectedSha?: string | null;
    }
  | {
      kind: "manual_approval";
      prompt: string;
    };

// Mid-run tool-call approval: an agent node with requireApproval pauses before
// each tool call and records the pending call here. Resolved by a human via
// the approvals API, or denied automatically when the wait budget runs out.
export type FlowToolApprovalWaitConfig = {
  kind: "tool_approval";
  toolName: string;
  toolCallId: string;
  // JSON-serialized tool input, truncated for display only -- never fed back
  // into the run.
  toolInput: string;
  nodeId: string;
  nodeLabel: string | null;
  agentName: string | null;
  repoFullName: string | null;
};

// flow_waits rows span await_event nodes (resumed by webhooks or the approvals
// API) and tool approvals (also resumed by the approvals API). Node configs
// stay narrow on FlowAwaitEventConfig; only the wait store speaks the wider
// union.
export type FlowWaitKind = FlowAwaitEventKind | "tool_approval";
export type FlowWaitConfig = FlowAwaitEventConfig | FlowToolApprovalWaitConfig;

export type FlowAwaitEventTimeout = {
  value: number;
  unit: FlowAwaitEventTimeoutUnit;
};

export type FlowAwaitEventNodeData = {
  label: string;
  config: FlowAwaitEventConfig;
  // Optional wait timeout. When omitted, no timeout is applied (Trigger.dev
  // wait tokens still honor the platform's hard ceiling).
  timeout?: FlowAwaitEventTimeout | null;
};

export type FlowEndNodeData = {
  label: string;
};

export type FlowNode =
  | {
      id: string;
      type: "start";
      position: FlowNodePosition;
      data: FlowStartNodeData;
    }
  | {
      id: string;
      type: "agent";
      position: FlowNodePosition;
      data: FlowAgentNodeData;
    }
  | {
      id: string;
      type: "action";
      position: FlowNodePosition;
      data: FlowActionNodeData;
    }
  | {
      id: string;
      type: "condition";
      position: FlowNodePosition;
      data: FlowConditionNodeData;
    }
  | {
      id: string;
      type: "parallel";
      position: FlowNodePosition;
      data: FlowParallelNodeData;
    }
  | {
      id: string;
      type: "join";
      position: FlowNodePosition;
      data: FlowJoinNodeData;
    }
  | {
      id: string;
      type: "delay";
      position: FlowNodePosition;
      data: FlowDelayNodeData;
    }
  | {
      id: string;
      type: "await_event";
      position: FlowNodePosition;
      data: FlowAwaitEventNodeData;
    }
  | {
      id: string;
      type: "set_variable";
      position: FlowNodePosition;
      data: FlowSetVariableNodeData;
    }
  | {
      id: string;
      type: "transform";
      position: FlowNodePosition;
      data: FlowTransformNodeData;
    }
  | {
      id: string;
      type: "end";
      position: FlowNodePosition;
      data: FlowEndNodeData;
    };

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};

export type FlowVersion = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: FlowGraph;
  created_at: string;
};

export type Flow = {
  id: string;
  user_id: string;
  installation_id: number;
  name: string;
  description: string | null;
  notes: string | null;
  source_kind: "github" | "schedule" | "webhook" | "slack";
  status: "active" | "inactive";
  draft_graph: FlowGraph;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
  trigger_schedule_id?: string | null;
  webhook_configured?: boolean;
  published_version?: FlowVersion | null;
} & Partial<JobRunSummary>;

export type PersonalFlowTemplateReconnect = "agent" | "slack" | "webhook";

export type PersonalFlowTemplate = {
  id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description: string | null;
  source_flow_id: string | null;
  trigger_event: TriggerEvent;
  reconnect: PersonalFlowTemplateReconnect[];
  requires_repository: boolean;
  created_at: string;
  updated_at: string;
};

export type PersonalFlowTemplatePage = {
  templates: PersonalFlowTemplate[];
  next_cursor: string | null;
  can_write?: boolean;
};

export type FlowWaitStatus = "waiting" | "resumed" | "expired" | "cancelled";

export type FlowWait = {
  id: string;
  user_id: string;
  job_run_id: string;
  flow_id: string;
  flow_version_id: string | null;
  installation_id: number | null;
  repo_id: string | null;
  node_id: string;
  wait_kind: FlowWaitKind;
  wait_config: FlowWaitConfig;
  resume_token: string;
  status: FlowWaitStatus;
  expires_at: string | null;
  created_at: string;
  resumed_at: string | null;
  resume_payload: Record<string, unknown> | null;
  resume_delivery_id: string | null;
};

export type FlowNodeRun = {
  id: string;
  user_id: string;
  job_run_id: string;
  flow_id: string;
  flow_version_id: string | null;
  node_id: string;
  node_type: FlowNodeType;
  node_label: string | null;
  status:
    | "pending"
    | "running"
    | "success"
    | "failed"
    | "skipped"
    | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  output: Record<string, unknown> | null;
  created_at: string;
};

export type FlowRunDispatchEvent = {
  outcome:
    | "queued"
    | "suppressed"
    | "started"
    | "deferred"
    | "start_failed"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "cancel_failed"
    | "reconciled";
  reason: string | null;
  created_at: string;
};
