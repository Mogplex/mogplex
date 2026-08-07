import type { AiCallType } from "@/lib/ai-call-types";
import type { RepoGithubAccessState } from "@/lib/github-state";
import type { JobRunSourceKind, JobRunStartSource } from "@/lib/job-runs";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";
import type {
  RepoSandboxBillingModeOverride,
  SandboxBillingMode,
} from "@/lib/sandbox/billing";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";

export type Profile = {
  id: string;
  github_username: string | null;
  github_auth_mode?: "oauth" | "app" | null;
  created_at: string;
};

export type Workspace = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description?: string | null;
  is_default?: boolean;
  sandbox_billing_mode?: SandboxBillingMode;
  sandbox_timeout_ms?: number | null;
  sandbox_idle_timeout_ms?: number | null;
  sandbox_vercel_team_id?: string | null;
  sandbox_vercel_project_id?: string | null;
  vercel_link_status?:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at?: string | null;
  vercel_link_error_code?: string | null;
  vercel_link_message?: string | null;
  repo_count?: number;
  created_at: string;
  updated_at: string;
};

export type Repo = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  workspace_id?: string | null;
  github_id?: number;
  github_installation_id?: number | null;
  github_has_app_installation?: boolean;
  github_app_covered?: boolean;
  github_triggerable?: boolean;
  github_access_state?: RepoGithubAccessState;
  github_coverage_label?: string;
  github_coverage_detail?: string;
  full_name: string;
  owner?: string;
  name?: string;
  default_branch?: string;
  is_favorite?: boolean;
  is_hidden?: boolean;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  vercel_link_status?:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at?: string | null;
  vercel_link_error_code?: string | null;
  vercel_link_message?: string | null;
  sandbox_billing_target?: "personal" | "team";
  sandbox_billing_mode_override?: RepoSandboxBillingModeOverride;
  env_sync_mode?: "sandbox-only" | "sandbox-and-preview" | "vercel-project";
  root_directory?: string | null;
  is_monorepo?: boolean;
  parent_repo_id?: string | null;
  install_command?: string | null;
  dev_command?: string | null;
  dev_port?: number;
  dev_port_auto?: boolean;
  sandbox_timeout_ms?: number | null;
  sandbox_idle_timeout_ms?: number | null;
  sandbox_env_vars?: Record<string, string> | null;
  runtime?: string | null;
  webhook_secret?: string | null;
  snapshot_id?: string | null;
  snapshot_lockfile_hash?: string | null;
  snapshot_created_at?: string | null;
  snapshot_commit_sha?: string | null;
  snapshot_billing_source?: SandboxBillingMode | null;
  snapshot_billing_team_id?: string | null;
  snapshot_billing_project_id?: string | null;
  workspace?: Workspace | null;
  created_at: string;
};

export type Agent = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  model: string;
  system_prompt: string | null;
  description?: string | null;
  category?: string | null;
  source_template?: string | null;
  is_preset?: boolean;
  has_fork?: boolean;
  created_at: string;
};

export type AgentCategoryRow = {
  id: string;
  slug: string;
  label: string;
  created_at: string;
};

export type Assignment = {
  id: string;
  repo_id: string;
  agent_id: string;
  type:
    | "pr_review"
    | "cron_refactor"
    | "cron"
    | "push_review"
    | "issue_triage"
    | "ci_failure";
  cron_schedule: string | null;
  skill_id: string | null;
  enabled: boolean;
  created_at: string;
} & Partial<JobRunSummary>;

export type TriggerEvent =
  | "mention"
  | "pr_opened"
  | "issue_opened"
  | "pr_comment"
  | "issue_comment"
  | "push"
  | "ci_failure"
  | "labeled"
  | "tag_push"
  | "schedule"
  | "webhook"
  | "slack_mention";

export type Trigger = {
  id: string;
  user_id: string;
  installation_id: number;
  agent_id: string;
  event: TriggerEvent;
  is_default: boolean;
  enabled: boolean;
  created_at: string;
} & Partial<JobRunSummary>;

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

export type FlowConditionOperator =
  | "exists"
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty";

export type FlowConditionRuleMode = "all" | "any";

export type FlowConditionRule = {
  field: string;
  operator: FlowConditionOperator;
  value: string;
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
  // and the run continues — it never hangs. Gates every tool loop this node
  // executes, including autofix and sandbox-tool fixes.
  requireApproval?: boolean;
  modelOverride?: string | null;
  maxStepsOverride?: number | null;
  timeoutMsOverride?: number | null;
  systemPromptOverride?: string | null;
};

export type FlowAgentHarness = "mogplex" | "claude-code" | "codex";

export type FlowAgentNodeRole = "review" | "edit" | "triage";

export type FlowGithubCommitStatusState =
  | "pending"
  | "success"
  | "failure"
  | "error";

export type FlowGithubReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export type FlowActionOperation =
  | "sandbox.run_command"
  | "slack.send_message"
  | "github.post_comment"
  | "github.create_issue"
  | "github.update_labels"
  | "github.set_status"
  | "github.submit_review"
  | "github.merge_pull_request";

export type FlowActionNodeData =
  | {
      label: string;
      operation: "sandbox.run_command";
      command: string;
      workingDirectory: string | null;
    }
  | {
      label: string;
      operation: "slack.send_message";
      destination?: "channel" | "trigger_thread";
      teamId: string;
      channelId: string;
      channelName: string | null;
      message: string;
      unfurlLinks?: boolean;
    }
  | {
      label: string;
      operation: "github.post_comment";
      targetNumber: string | null;
      body: string;
    }
  | {
      label: string;
      operation: "github.create_issue";
      title: string;
      body: string;
      labels: string[];
    }
  | {
      label: string;
      operation: "github.update_labels";
      targetNumber: string | null;
      addLabels: string[];
      removeLabels: string[];
    }
  | {
      label: string;
      operation: "github.set_status";
      commitSha: string | null;
      state: FlowGithubCommitStatusState;
      context: string;
      description: string | null;
      targetUrl: string | null;
    }
  | {
      label: string;
      operation: "github.submit_review";
      pullRequestNumber: string | null;
      event: FlowGithubReviewEvent;
      body: string;
    }
  | {
      label: string;
      operation: "github.merge_pull_request";
      pullRequestNumber: string | null;
      commitTitle: string | null;
    };

export type FlowConditionNodeData = {
  label: string;
  mode: FlowConditionRuleMode;
  rules: FlowConditionRule[];
};

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
  // JSON-serialized tool input, truncated for display only — never fed back
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

export type FlowSetVariableAssignment = {
  // Variable name. Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. Persisted into the
  // run's flow state map and exposed to downstream conditions as `state.<key>`.
  key: string;
  // Mustache-style template. Whole-string single-substitution preserves the
  // resolved value's native type (number stays number, array stays array).
  // Mixed text interpolates resolved values as strings.
  template: string;
};

export type FlowSetVariableNodeData = {
  label: string;
  assignments: FlowSetVariableAssignment[];
};

export type FlowTransformOperation =
  | "copy"
  | "string_contains"
  | "string_split"
  | "array_join"
  | "array_length"
  | "array_includes"
  | "files_match_glob"
  | "cast_boolean"
  | "cast_number";

export type FlowTransformAssignment = {
  // Variable name written into per-run state and exposed downstream as
  // `state.<key>`.
  key: string;
  // Dot-path into metadata, repo, outputs, outputs_by_label,
  // previous_outputs, or state.
  source: string;
  operation: FlowTransformOperation;
  // Operation-specific input: substring, delimiter, array value, or glob.
  // Copy, length, and cast operations do not use it.
  argument?: string;
};

export type FlowTransformNodeData = {
  label: string;
  assignments: FlowTransformAssignment[];
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

export type JobRun = {
  id: string;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id?: string | null;
  flow_version_id?: string | null;
  runtime_provider?: BackgroundRuntimeProvider | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
  retry_of_job_run_id?: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error: string | null;
  start_attempts: number;
  last_start_attempt_at?: string | null;
  last_start_error?: string | null;
  last_start_source?: JobRunStartSource | null;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  cancel_error?: string | null;
  metadata: Record<string, unknown> | null;
};

export type JobRunSummary = {
  last_job_run_id: string | null;
  last_run_status: JobRun["status"] | null;
  last_run_started_at: string | null;
  last_run_error: string | null;
  running_count: number;
  pending_count: number;
  failed_24h: number;
  suppressed_24h: number;
  deferred_24h: number;
  start_failed_24h: number;
  last_pressure_reason: string | null;
  last_pressure_at: string | null;
  last_run_repairable: boolean;
  last_run_requeueable: boolean;
  last_run_cancelable: boolean;
};

export type ReviewFindingSeverity = "critical" | "warning" | "suggestion";

export type ReviewFinding = {
  severity: ReviewFindingSeverity;
  title: string;
  body: string;
  path: string | null;
  line: number | null;
};

export type JobRunReviewFindingStatus =
  | "open"
  | "issue_creating"
  | "issue_created"
  | "dismissed";

export type JobRunReviewFinding = ReviewFinding & {
  id: string;
  user_id: string;
  job_run_id: string;
  repo_id: string | null;
  repo_full_name: string | null;
  pr_number: number | null;
  head_sha: string | null;
  ordinal: number;
  fingerprint: string;
  status: JobRunReviewFindingStatus;
  issue_number: number | null;
  issue_url: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ObservabilityJob = JobRun & {
  source_kind: JobRunSourceKind;
  source_type: string;
  repo: {
    id: string | null;
    full_name: string | null;
  };
  agent: {
    id: string | null;
    name: string | null;
    slug: string | null;
  };
  latest_ai_call: Pick<
    AiCall,
    | "id"
    | "status"
    | "model"
    | "total_tokens"
    | "tool_calls_count"
    | "started_at"
  > | null;
  latest_dispatch_event: FlowRunDispatchTimelineEvent | null;
  repairable: boolean;
  requeueable: boolean;
  cancelable: boolean;
};

export type ObservabilityJobDetail = ObservabilityJob & {
  dispatch_events: FlowRunDispatchTimelineEvent[];
  ai_calls: FlowRunAiCallDetail[];
  review_findings: JobRunReviewFinding[];
};

export type FlowRunRecord = ObservabilityJob & {
  latest_dispatch_event: FlowRunDispatchEvent | null;
  node_runs: FlowNodeRun[];
  active_wait_count?: number;
};

export type FlowRunDispatchTimelineEvent = FlowRunDispatchEvent & {
  id: string;
  event_kind: "enqueue" | "start" | "control";
  metadata: Record<string, unknown> | null;
};

export type FlowRunAiCallDetail = AiCall & {
  events: AiCallEvent[];
};

export type FlowRunDetail = FlowRunRecord & {
  dispatch_events: FlowRunDispatchTimelineEvent[];
  ai_calls: FlowRunAiCallDetail[];
  review_findings: JobRunReviewFinding[];
  waits?: FlowWait[];
};

export type AutomationDispatchEvent = {
  id: string;
  job_run_id: string | null;
  assignment_id: string | null;
  trigger_id: string | null;
  repo_id: string | null;
  installation_id: number | null;
  source_kind: "assignment" | "trigger" | "flow" | "manual_retry";
  source_type: string;
  event_kind: "enqueue" | "start" | "control";
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
  metadata: Record<string, unknown> | null;
  created_at: string;
  repo: {
    id: string | null;
    full_name: string | null;
  };
  agent: {
    id: string | null;
    name: string | null;
    slug: string | null;
  };
};

export type ToolCall = {
  id: string;
  job_run_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
};

export type AIModel = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing_input?: number | null;
  pricing_output?: number | null;
  capabilities: string[];
  is_available: boolean;
  is_hidden?: boolean | null;
  is_recommended?: boolean;
  recommendation_bucket?: "open" | "frontier" | null;
  recommendation_rank?: number | null;
  recommendation_reason?: string | null;
  recommended_at?: string | null;
  /** Per-user enabled flag from user_model_preferences (joined at query time) */
  is_enabled?: boolean;
};

export type Connection = {
  id: string;
  user_id: string;
  name: string;
  type: "rest_api" | "mcp_server";
  base_url: string | null;
  auth_type: "none" | "api_key" | "bearer" | "basic" | "oauth" | null;
  auth_header: string | null;
  mcp_transport: "sse" | "http" | null;
  mcp_url: string | null;
  description: string | null;
  is_enabled: boolean;
  health_status: import("@/lib/connections/health-status").ConnectionHealthStatus;
  scope: "global" | "project";
  repo_id: string | null;
  oauth_client_id: string | null;
  oauth_authorize_url: string | null;
  oauth_token_url: string | null;
  oauth_scopes: string | null;
  oauth_authorized_at: string | null;
  oauth_token_expires_at: string | null;
  source_preset: string | null;
  last_tested_at: string | null;
  last_test_error: string | null;
  last_test_http_status: number | null;
  last_test_tool_count: number | null;
  created_at: string;
  updated_at: string;
};

export type ConnectionOverride = {
  id: string;
  repo_id: string;
  connection_id: string | null;
  excluded: boolean;
  created_at: string;
};

export type AiCall = {
  id: string;
  user_id: string;
  type: AiCallType;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  reasoning_tokens: number | null;
  gateway_generation_id: string | null;
  cost_source: "trigger" | "gateway" | "manual" | null;
  total_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  status: "pending" | "streaming" | "success" | "failed" | "cancelled";
  error: string | null;
  conversation_id: string | null;
  job_run_id: string | null;
  repo_id: string | null;
  limit_claim_id: string | null;
  cancel_requested_at: string | null;
  control_state: "active" | "cancel_requested" | "cancelled";
  runtime_command_id: string | null;
  tool_calls_count: number;
  tool_calls: AiToolCall[];
  metadata: Record<string, unknown>;
  sandbox_context?: SandboxCallContext | null;
};

export type AiCallEvent = {
  id: string;
  ai_call_id: string;
  user_id: string;
  conversation_id: string | null;
  repo_id: string | null;
  event_type:
    | "started"
    | "status_changed"
    | "tool_started"
    | "tool_finished"
    | "cancel_requested"
    | "cancelled"
    | "finished"
    | "failed"
    | "log";
  tool_name: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AiToolCall = {
  name: string;
  input_preview?: string;
  output_preview?: string;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
};

export type SandboxCallContext = {
  sandbox_record_id: string;
  sandbox_id: string;
  compute_billing_source: SandboxBillingMode;
  billing_project_id: string | null;
  billing_team_id: string | null;
  preview_url: string | null;
};

export type SandboxBillingSummary = {
  source: SandboxBillingMode;
  label: string;
  project_id: string | null;
  team_id: string | null;
  team_label: string;
};

export type SandboxRuntimeSummary = {
  sandbox_id: string;
  status: string;
  health_status: SandboxHealthStatus | string;
  preview_url: string | null;
  last_health_check_at: string | null;
  last_preview_http_status: number | null;
  boot_attempts: number;
  last_boot_started_at: string | null;
  last_boot_completed_at: string | null;
  effective_timeout_ms?: number | null;
  persistent?: boolean | null;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
};

export type SandboxErrorSummary = {
  current_error: string | null;
  last_preview_error: string | null;
  last_boot_error: string | null;
  display_error: string | null;
  has_errors: boolean;
};

export type SandboxLifecycleStatus =
  | "creating"
  | "installing"
  | "running"
  | "pausing"
  | "stopped"
  | "paused"
  | "error";

export type StopReason =
  | "idle_timeout"
  | "lifetime_timeout"
  | "manual"
  | "stuck_boot"
  | "vm_gone"
  | "auto_pause"
  | "billing_depleted"
  | "unknown";

export type SandboxRecordRow = {
  id: string;
  user_id: string;
  product_team_id?: string | null;
  actor_user_id?: string | null;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  limit_claim_id: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  sandbox_billing_target?: "personal" | "team";
  billing_source?: SandboxBillingMode | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  status: SandboxLifecycleStatus;
  stop_reason?: StopReason | null;
  preview_url: string | null;
  snapshot_id: string | null;
  snapshot_billing_project_id?: string | null;
  snapshot_billing_team_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  health_status?: SandboxHealthStatus;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  root_directory?: string | null;
  exec_lock_token?: string | null;
  exec_lock_started_at?: string | null;
  error: string | null;
  created_at: string;
  last_active_at: string;
};

export type SandboxClientRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  snapshot_id: string | null;
  stop_reason: StopReason | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  /**
   * Per-launch working subdirectory snapshot; decoupled from
   * `repos.root_directory`. Three-way semantics:
   *   - `undefined` → field omitted from the response by a legacy
   *                    SELECT; client should treat as "use repo default"
   *   - `null`      → explicit "repo root" launch override
   *   - `string`    → relative path inside the repo (e.g. "apps/web")
   *
   * Front-end consumers should NOT fall back to `repo.root_directory`
   * when this is `null` — see lib/sandbox/route-context.ts for the
   * canonical resolution logic.
   */
  root_directory?: string | null;
  created_at: string;
  last_active_at: string;
  billing_summary: SandboxBillingSummary;
  runtime_summary: SandboxRuntimeSummary;
  error_summary: SandboxErrorSummary;
};

export type SandboxRecord = SandboxClientRecord;
