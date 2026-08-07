/**
 * AI model and AI call types.
 */

import type { AiCallType } from "@/lib/ai-call-types";
import type { SandboxCallContext } from "./sandbox";

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

export type AiToolCall = {
  name: string;
  input_preview?: string;
  output_preview?: string;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
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
