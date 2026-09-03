/**
 * Observability types for job runs, flow runs, and automation events.
 */

import type { JobRunSourceKind } from "@/lib/job-runs";
import type { AiCall, AiCallEvent } from "./ai";
import type { FlowNodeRun, FlowRunDispatchEvent, FlowWait } from "./flow";
import type { JobRun, JobRunReviewFinding } from "./job-run";

export type FlowRunDispatchTimelineEvent = FlowRunDispatchEvent & {
  id: string;
  event_kind: "enqueue" | "start" | "control";
  metadata: Record<string, unknown> | null;
};

export type FlowRunAiCallDetail = AiCall & {
  events: AiCallEvent[];
};

export type ObservabilityJob = JobRun & {
  // Agent runs started via the API, MCP, CLI or Slack are listed as jobs too.
  source_kind: JobRunSourceKind | "agent_run";
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
