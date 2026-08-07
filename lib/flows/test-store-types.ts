import type {
  AiCall,
  AiCallEvent,
  FlowGraph,
  FlowNodeRun,
  PersonalFlowTemplate,
  TriggerEvent,
} from "@/lib/types";
import type { AutomationDispatchEventOutcome } from "@/lib/automation-dispatch";

export type TestInstallation = {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string | null;
};

export type TestAgent = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  model: string;
  system_prompt: string | null;
};

export type TestFlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  name: string;
  description: string | null;
  notes: string | null;
  source_kind: "github";
  status: "active" | "inactive";
  draft_graph: FlowGraph;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TestFlowVersionRow = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: FlowGraph;
  created_at: string;
};

export type TestPersonalFlowTemplateRow = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description: string | null;
  graph: FlowGraph;
  source_flow_id: string | null;
  trigger_event: PersonalFlowTemplate["trigger_event"];
  reconnect: PersonalFlowTemplate["reconnect"];
  requires_repository: boolean;
  created_at: string;
  updated_at: string;
};

export type TestTriggerRow = {
  id: string;
  user_id: string;
  installation_id: number;
  agent_id: string | null;
  event: TriggerEvent;
  is_default: boolean;
  enabled: boolean;
};

export type TestJobRunRow = {
  id: string;
  assignment_id?: string | null;
  trigger_id?: string | null;
  flow_id: string | null;
  flow_version_id?: string | null;
  runtime_provider?: string | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
  retry_of_job_run_id?: string | null;
  status: string | null;
  error: string | null;
  started_at: string | null;
  created_at: string | null;
  completed_at?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  duration_ms?: number | null;
  start_attempts?: number;
  last_start_attempt_at: string | null;
  last_start_error?: string | null;
  last_start_source?:
    | "webhook"
    | "cron"
    | "repair"
    | "manual_retry"
    | "queue_release"
    | null;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  cancel_error?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type TestDispatchEventRow = {
  id: string;
  job_run_id?: string | null;
  trigger_id: string | null;
  flow_id?: string | null;
  flow_version_id?: string | null;
  event_kind?: "enqueue" | "start" | "control";
  outcome: AutomationDispatchEventOutcome;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type TestAiCallRow = Omit<
  AiCall,
  "type" | "status" | "control_state" | "tool_calls" | "metadata"
> & {
  type: AiCall["type"];
  status: AiCall["status"];
  control_state?: AiCall["control_state"];
  tool_calls?: AiCall["tool_calls"];
  metadata?: AiCall["metadata"];
};

export type TestAiCallEventRow = Omit<AiCallEvent, "event_type" | "payload"> & {
  event_type: AiCallEvent["event_type"];
  payload?: AiCallEvent["payload"];
};

export type TestAssistantState = {
  nextResult: { summary: string; graph: FlowGraph } | null;
  nextError: string | null;
};

export type TestFaultState = {
  failNextFlowDelete: string | null;
};

export type FlowsE2ETestState = {
  installations: TestInstallation[];
  agents: TestAgent[];
  flows: TestFlowRow[];
  flowVersions: TestFlowVersionRow[];
  flowTemplates: TestPersonalFlowTemplateRow[];
  triggers: TestTriggerRow[];
  jobRuns: TestJobRunRow[];
  flowNodeRuns: FlowNodeRun[];
  dispatchEvents: TestDispatchEventRow[];
  aiCalls: TestAiCallRow[];
  aiCallEvents: TestAiCallEventRow[];
  assistant: TestAssistantState;
  faults: TestFaultState;
};

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nowIso() {
  return new Date().toISOString();
}
