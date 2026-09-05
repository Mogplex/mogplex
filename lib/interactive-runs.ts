import {
  redactSecretsInText,
  sanitizeTelemetryRecord,
} from "@/lib/ai-telemetry";
import type { AiCall, AiCallEvent, AiToolCall } from "@/lib/types";
import type { AiCallType } from "@/lib/ai-call-types";

export const AI_CALL_STATUSES = [
  "pending",
  "streaming",
  "success",
  "failed",
  "cancelled",
] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

export const AI_CALL_EVENT_TYPES = [
  "started",
  "status_changed",
  "tool_started",
  "tool_finished",
  "cancel_requested",
  "cancelled",
  "finished",
  "failed",
  "log",
] as const;
export type AiCallEventType = (typeof AI_CALL_EVENT_TYPES)[number];

export const ACTIVE_CHAT_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
export const PREPARED_HARNESS_STALE_THRESHOLD_MS = 2 * 60 * 1000;

type AiCallUpdate = Partial<
  Pick<
    AiCall,
    | "model"
    | "status"
    | "error"
    | "cancel_requested_at"
    | "control_state"
    | "input_tokens"
    | "output_tokens"
    | "cache_read_input_tokens"
    | "cache_creation_input_tokens"
    | "reasoning_tokens"
    | "gateway_generation_id"
    | "duration_ms"
    | "completed_at"
    | "runtime_command_id"
    | "tool_calls_count"
    | "tool_calls"
    | "metadata"
  >
>;

type ConditionalAiCallUpdateOptions = {
  expectedStatuses?: AiCallStatus[];
  expectedControlStates?: AiCall["control_state"][];
};

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

export async function createAiCall(input: {
  userId: string;
  type: AiCallType;
  model: string;
  conversationId?: string | null;
  jobRunId?: string | null;
  repoId?: string | null;
  limitClaimId?: string | null;
  runtimeCommandId?: string | null;
  metadata?: Record<string, unknown>;
  status?: AiCallStatus;
  startedAt?: string;
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  const payload = {
    user_id: input.userId,
    type: input.type,
    model: input.model,
    started_at: input.startedAt ?? new Date().toISOString(),
    status: input.status ?? "pending",
    control_state: "active",
    cancel_requested_at: null,
    conversation_id: input.conversationId ?? null,
    job_run_id: input.jobRunId ?? null,
    repo_id: input.repoId ?? null,
    limit_claim_id: input.limitClaimId ?? null,
    runtime_command_id: input.runtimeCommandId ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .insert(payload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create ai_call");
  }

  return data as AiCall;
}

export async function updateAiCall(aiCallId: string, update: AiCallUpdate) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("ai_calls")
    .update(update)
    .eq("id", aiCallId);

  if (error) {
    throw new Error(`Failed to update ai_call ${aiCallId}: ${error.message}`);
  }
}

/**
 * Returns null when no matching ai_call row is found (not-found or ownership
 * mismatch). Callers must handle the null case.
 */
export async function mergeAiCallMetadata(input: {
  userId: string;
  aiCallId: string;
  metadata: Record<string, unknown>;
}): Promise<AiCall | null> {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.rpc("merge_ai_call_metadata", {
    p_user_id: input.userId,
    p_ai_call_id: input.aiCallId,
    p_metadata_patch: input.metadata,
  });

  if (error) {
    throw new Error(
      `Failed to merge ai_call metadata ${input.aiCallId}: ${error.message}`
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row as AiCall | null | undefined) ?? null;
}

async function updateAiCallConditionally(
  aiCallId: string,
  update: AiCallUpdate,
  options: ConditionalAiCallUpdateOptions = {}
) {
  const supabaseAdmin = await getSupabaseAdmin();
  let query = supabaseAdmin.from("ai_calls").update(update).eq("id", aiCallId);

  if (options.expectedStatuses?.length) {
    query = query.in("status", options.expectedStatuses);
  }

  if (options.expectedControlStates?.length) {
    query = query.in("control_state", options.expectedControlStates);
  }

  const { data, error } = await query.select("*").maybeSingle();

  if (error) {
    throw new Error(
      `Failed to conditionally update ai_call ${aiCallId}: ${error.message}`
    );
  }

  return (data as AiCall | null) ?? null;
}

export async function requestAiCallCancellation(aiCallId: string) {
  await updateAiCall(aiCallId, {
    control_state: "cancel_requested",
    cancel_requested_at: new Date().toISOString(),
  });
}

export async function requestAiCallCancellationIfActive(
  aiCallId: string,
  cancelRequestedAt = new Date().toISOString()
) {
  return updateAiCallConditionally(
    aiCallId,
    {
      control_state: "cancel_requested",
      cancel_requested_at: cancelRequestedAt,
    },
    {
      expectedStatuses: ["pending", "streaming"],
      expectedControlStates: ["active", "cancel_requested"],
    }
  );
}

export async function updateAiCallIfActive(
  aiCallId: string,
  update: AiCallUpdate
) {
  return updateAiCallConditionally(aiCallId, update, {
    expectedStatuses: ["pending", "streaming"],
    expectedControlStates: ["active"],
  });
}

export const finalizeAiCallIfNotCancelled = updateAiCallIfActive;

export async function finalizeAiCallAsCancelledIfActive(
  aiCallId: string,
  update: AiCallUpdate
) {
  return updateAiCallConditionally(aiCallId, update, {
    expectedStatuses: ["pending", "streaming"],
    expectedControlStates: ["active", "cancel_requested"],
  });
}

export function sanitizeAiCallEventInput(
  input: Parameters<typeof appendAiCallEvent>[0]
) {
  return {
    ...input,
    message: input.message ? redactSecretsInText(input.message) : null,
    payload: sanitizeTelemetryRecord(input.payload),
  };
}

export async function appendAiCallEvent(input: {
  aiCallId: string;
  userId: string;
  conversationId?: string | null;
  repoId?: string | null;
  eventType: AiCallEventType;
  toolName?: string | null;
  message?: string | null;
  payload?: Record<string, unknown>;
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  const sanitizedInput = sanitizeAiCallEventInput(input);
  const { data, error } = await supabaseAdmin
    .from("ai_call_events")
    .insert({
      ai_call_id: input.aiCallId,
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      repo_id: input.repoId ?? null,
      event_type: input.eventType,
      tool_name: input.toolName ?? null,
      message: sanitizedInput.message,
      payload: sanitizedInput.payload,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to append ai_call_event");
  }

  return data as AiCallEvent;
}

export async function safeAppendAiCallEvent(
  input: Parameters<typeof appendAiCallEvent>[0]
) {
  try {
    return await appendAiCallEvent(input);
  } catch (error) {
    console.error("[interactive-runs] failed to append ai_call_event", {
      input: sanitizeAiCallEventInput(input),
      error,
    });
    return null;
  }
}

export async function safeUpdateAiCall(aiCallId: string, update: AiCallUpdate) {
  try {
    await updateAiCall(aiCallId, update);
  } catch (error) {
    console.error("[interactive-runs] failed to update ai_call", {
      aiCallId,
      update,
      error,
    });
  }
}

export function buildAiCallCompletionUpdate(input: {
  startedAt: string;
  status: Extract<AiCallStatus, "success" | "failed" | "cancelled">;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  reasoningTokens?: number | null;
  gatewayGenerationId?: string | null;
  error?: string | null;
  cancelRequestedAt?: string | null;
  controlState?: AiCall["control_state"];
  runtimeCommandId?: string | null;
  toolCalls?: AiToolCall[];
  metadata?: Record<string, unknown>;
}) {
  const completedAt = new Date().toISOString();
  const toolCalls = input.toolCalls ?? [];

  return {
    status: input.status,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    cache_read_input_tokens: input.cacheReadInputTokens ?? null,
    cache_creation_input_tokens: input.cacheCreationInputTokens ?? null,
    reasoning_tokens: input.reasoningTokens ?? null,
    gateway_generation_id: input.gatewayGenerationId ?? null,
    duration_ms: Date.now() - new Date(input.startedAt).getTime(),
    completed_at: completedAt,
    error: input.error ?? null,
    cancel_requested_at: input.cancelRequestedAt,
    control_state:
      input.controlState ??
      (input.status === "cancelled" ? "cancelled" : "active"),
    runtime_command_id: input.runtimeCommandId ?? null,
    tool_calls_count: toolCalls.length,
    tool_calls: toolCalls,
    metadata: input.metadata,
  } satisfies AiCallUpdate;
}

export async function loadOwnedAiCall(userId: string, aiCallId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("*")
    .eq("id", aiCallId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ai_call ${aiCallId}: ${error.message}`);
  }

  return (data as AiCall | null) ?? null;
}

export function isStaleLiveInteractiveCall(
  call: Pick<AiCall, "type" | "status" | "started_at"> &
    Partial<Pick<AiCall, "metadata">>,
  now = Date.now()
) {
  if (call.status !== "pending" && call.status !== "streaming") {
    return false;
  }

  const startedAt = new Date(call.started_at).getTime();
  if (!Number.isFinite(startedAt)) {
    return false;
  }

  // Chat streams are bounded by the serverless streaming timeout (max ~5 min
  // on Vercel Pro), so the chat threshold applies uniformly regardless of
  // anchor presence. This keeps stale chat rows out of live-run UI.
  //
  // Non-chat interactive runs (agent jobs via Trigger.dev) can legitimately
  // run for hours. They keep the longer threshold whether or not they have
  // a runtime anchor yet — an agent run that has not yet received its
  // runtime_command_id callback is still legitimately live and must not be
  // hidden from the UI within minutes.
  const threshold =
    call.metadata?.prepared === true
      ? PREPARED_HARNESS_STALE_THRESHOLD_MS
      : call.type === "chat"
        ? ACTIVE_CHAT_STALE_THRESHOLD_MS
        : ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS;

  return now - startedAt >= threshold;
}

export async function loadOwnedAiCallEvents(userId: string, aiCallId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("ai_call_events")
    .select("*")
    .eq("ai_call_id", aiCallId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load ai_call_events for ${aiCallId}: ${error.message}`
    );
  }

  return (data ?? []) as AiCallEvent[];
}
