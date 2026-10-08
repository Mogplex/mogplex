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

// How long a live call may go without recorded progress (its start or its
// newest event) before it counts as dead. /api/control/chat lasts 800
// seconds, plus a minute for final persistence. Hosted continuations and
// agent workers have no duration cap, so these windows measure idleness,
// not age: a worker that keeps reporting progress is never stale.
export const ACTIVE_CONTROL_CHAT_STALE_THRESHOLD_MS = 800_000 + 60_000;
export const ACTIVE_CONTROL_BACKGROUND_STALE_THRESHOLD_MS = 1_800_000 + 60_000;
export const ACTIVE_CHAT_STALE_THRESHOLD_MS = 30 * 60 * 1000;
export const ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
export const PREPARED_HARNESS_STALE_THRESHOLD_MS = 2 * 60 * 1000;

// Heartbeat interval for long-running tool executions. This must be less than
// the background idle threshold minus the exec route timeout, so a heartbeat
// is recorded before the idle window expires for a valid tool execution.
// Currently: 15 minutes (half of exec timeout, leaves 16+ minutes buffer).
export const WORKER_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

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

export class AiCallPersistenceError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AiCallPersistenceError";
  }
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
    throw new AiCallPersistenceError(
      error?.message || "Failed to create ai_call",
      error?.code
    );
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

/**
 * Records a heartbeat event for a long-running worker execution. This prevents
 * the zombie reaper from killing workers that are validly executing a tool with
 * a bounded timeout (like run_command's 30-minute exec timeout). The heartbeat
 * uses the "log" event type, which the UI renders harmlessly.
 *
 * Heartbeats should only be recorded for tool executions that have their own
 * bounded timeout, so truly hung workers (without timeouts) are still reaped.
 */
export async function recordWorkerHeartbeat(input: {
  aiCallId: string;
  userId: string;
  conversationId?: string | null;
  repoId?: string | null;
  source: "control_continuation" | "agent_worker";
}): Promise<void> {
  await safeAppendAiCallEvent({
    aiCallId: input.aiCallId,
    userId: input.userId,
    conversationId: input.conversationId,
    repoId: input.repoId,
    eventType: "log",
    message: "Worker heartbeat",
    payload: {
      source: input.source,
      heartbeat: true,
      recorded_at: new Date().toISOString(),
    },
  });
}

/**
 * Creates a heartbeat timer that fires once after WORKER_HEARTBEAT_INTERVAL_MS.
 * Returns a cleanup function to cancel the timer. The heartbeat is only recorded
 * if the timer fires before cleanup is called, ensuring active workers aren't
 * marked as idle prematurely while still allowing truly hung workers to be reaped.
 */
export function createWorkerHeartbeatTimer(
  onHeartbeat: () => void | Promise<void>
): () => void {
  const timerId = setTimeout(() => {
    void Promise.resolve(onHeartbeat()).catch((error) => {
      console.warn("[interactive-runs] heartbeat callback failed", error);
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  return () => clearTimeout(timerId);
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

/** The idle window after which a live call of this kind counts as dead. */
export function liveCallIdleThresholdMs(
  call: Pick<AiCall, "type"> & Partial<Pick<AiCall, "metadata">>
) {
  // Control is identified by server-owned metadata, not call type: newer
  // coordinator calls are agents, while older calls were recorded as chats.
  // Hosted follow-ups get a longer window than the browser route. Unknown
  // legacy runtimes stay visible until the reaper resolves their saved ticket.
  return call.metadata?.prepared === true
    ? PREPARED_HARNESS_STALE_THRESHOLD_MS
    : call.metadata?.surface === "control"
      ? call.metadata.control_runtime === "request"
        ? ACTIVE_CONTROL_CHAT_STALE_THRESHOLD_MS
        : ACTIVE_CONTROL_BACKGROUND_STALE_THRESHOLD_MS
      : call.type === "chat"
        ? ACTIVE_CHAT_STALE_THRESHOLD_MS
        : ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS;
}

/**
 * Whether a pending or streaming call has gone quiet for its whole idle
 * window. Progress is its start or `lastActivityAt`, the newest event it
 * recorded; without that the call's age is all there is to go on.
 */
export function isStaleLiveInteractiveCall(
  call: Pick<AiCall, "type" | "status" | "started_at"> &
    Partial<Pick<AiCall, "metadata">>,
  now = Date.now(),
  lastActivityAt?: string | null
) {
  if (call.status !== "pending" && call.status !== "streaming") {
    return false;
  }

  const startedAt = new Date(call.started_at).getTime();
  if (!Number.isFinite(startedAt)) {
    return false;
  }
  const activityAt = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN;
  const lastProgress = Number.isFinite(activityAt)
    ? Math.max(startedAt, activityAt)
    : startedAt;

  return now - lastProgress >= liveCallIdleThresholdMs(call);
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
