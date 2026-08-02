import {
  buildAiCallCompletionUpdate,
  finalizeAiCallAsCancelledIfActive,
  loadOwnedAiCall,
  requestAiCallCancellationIfActive,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import { sanitizeTelemetryRecord } from "@/lib/ai-telemetry";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import {
  presentMogplexApiRun,
  type ExternalAgentRunRow,
  type MogplexApiRunStatus,
} from "./runs";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";
import type { AiCall, AiCallEvent } from "@/lib/types";

export type PresentedAiCallEvent = {
  id: string;
  type: AiCallEvent["event_type"];
  toolName: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type RunControlErrorCode = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND";

type RunEventListDeps = {
  loadRun: (
    userId: string,
    runId: string
  ) => Promise<ExternalAgentRunRow | null>;
  listEvents: (aiCallId: string, limit: number) => Promise<AiCallEvent[]>;
};

type RunCancelDeps = {
  loadRun: (
    userId: string,
    runId: string
  ) => Promise<ExternalAgentRunRow | null>;
  updateRun: (
    userId: string,
    runId: string,
    update: Partial<Pick<ExternalAgentRunRow, "status" | "error">>
  ) => Promise<ExternalAgentRunRow | null>;
  loadAiCall: typeof loadOwnedAiCall;
  requestCancellation: typeof requestAiCallCancellationIfActive;
  finalizeCancelled: typeof finalizeAiCallAsCancelledIfActive;
  appendEvent: typeof safeAppendAiCallEvent;
  killRuntimeCommand: (
    input: Pick<ExternalAgentRunRow, "user_id" | "sandbox_record_id"> & {
      runtimeCommandId: string;
    }
  ) => Promise<void>;
  /**
   * Best-effort side effect once the run row reaches a terminal state — strips
   * the Slack "Cancel run" button if the run was started from Slack. This hook
   * may throw; callers must absorb failures so cancellation still completes.
   */
  notifyTerminal: (
    run: { id: string; metadata: unknown },
    status: MogplexApiRunStatus
  ) => Promise<void>;
};

const SANDBOX_CANCEL_ROUTE_SELECT =
  "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id";
const REDACTED_EVENT_VALUE = "[redacted]";
const EVENT_PAYLOAD_MAX_STRING_LENGTH = 2_000;
const EVENT_PAYLOAD_MAX_ITEMS = 25;
const EVENT_PAYLOAD_MAX_DEPTH = 3;
const EVENT_PAYLOAD_MAX_JSON_LENGTH = 20_000;
const SENSITIVE_EVENT_PAYLOAD_KEYS = new Set([
  "env",
  "environment",
  "envvars",
  "runtimeenv",
  "runtimeenvironment",
  "githubtoken",
  "ghtoken",
  "aibillingsource",
  "mogplexaibillingsource",
]);

export class MogplexApiRunControlError extends Error {
  code: RunControlErrorCode;
  status: number;

  constructor(code: RunControlErrorCode, message: string, status: number) {
    super(message);
    this.name = "MogplexApiRunControlError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, MogplexApiRunControlError.prototype);
  }
}

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

function normalizeEventPayloadKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function redactSensitiveEventPayloadFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSensitiveEventPayloadFields);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SENSITIVE_EVENT_PAYLOAD_KEYS.has(normalizeEventPayloadKey(key))
        ? REDACTED_EVENT_VALUE
        : redactSensitiveEventPayloadFields(nested),
    ])
  );
}

function sanitizeEventPayload(payload: Record<string, unknown>) {
  const sanitized = sanitizeTelemetryRecord(
    redactSensitiveEventPayloadFields(payload) as Record<string, unknown>,
    {
      maxStringLength: EVENT_PAYLOAD_MAX_STRING_LENGTH,
      maxItems: EVENT_PAYLOAD_MAX_ITEMS,
      maxDepth: EVENT_PAYLOAD_MAX_DEPTH,
    }
  );
  const json = JSON.stringify(sanitized);
  if (json.length <= EVENT_PAYLOAD_MAX_JSON_LENGTH) return sanitized;

  return {
    truncated: true,
    payloadPreview: json.slice(0, EVENT_PAYLOAD_MAX_JSON_LENGTH),
  };
}

function presentEvent(event: AiCallEvent): PresentedAiCallEvent {
  return {
    id: event.id,
    type: event.event_type,
    toolName: event.tool_name,
    message: event.message,
    payload: sanitizeEventPayload(event.payload),
    createdAt: event.created_at,
  };
}

async function loadRunForUser(userId: string, runId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load external agent run: ${error.message}`);
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

async function listAiCallEvents(aiCallId: string, limit: number) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("ai_call_events")
    .select("*")
    .eq("ai_call_id", aiCallId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list run events: ${error.message}`);
  }

  return (data ?? []) as AiCallEvent[];
}

async function updateRunForUser(
  userId: string,
  runId: string,
  update: Partial<Pick<ExternalAgentRunRow, "status" | "error">>
) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .update(update)
    .eq("user_id", userId)
    .eq("id", runId)
    .in("status", ACTIVE_RUN_STATUSES)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to update external agent run ${runId}: ${error.message}`
    );
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

async function killRuntimeCommand(input: {
  user_id: string;
  sandbox_record_id: string | null;
  runtimeCommandId: string;
}) {
  if (!input.sandbox_record_id) {
    throw new MogplexApiRunControlError(
      "BAD_REQUEST",
      "Run has no sandbox metadata",
      400
    );
  }

  const request = new Request("https://internal.mogplex/api/sandbox/cancel", {
    headers: buildInternalApiHeaders(input.user_id),
  });
  const { loadOwnedSandboxRouteContext } =
    await import("@/lib/sandbox/route-context");
  const sandboxData = await loadOwnedSandboxRouteContext(
    request,
    input.sandbox_record_id,
    {
      select: SANDBOX_CANCEL_ROUTE_SELECT,
    }
  );
  if (!sandboxData.ok) {
    throw new MogplexApiRunControlError(
      "CONFLICT",
      sandboxData.error,
      sandboxData.status
    );
  }
  if (!sandboxData.sandbox) {
    throw new MogplexApiRunControlError(
      "CONFLICT",
      "Sandbox is not ready",
      409
    );
  }

  const command = await sandboxData.sandbox.getCommand(input.runtimeCommandId);
  await command.kill();
}

const defaultEventDeps: RunEventListDeps = {
  loadRun: loadRunForUser,
  listEvents: listAiCallEvents,
};

const defaultCancelDeps: RunCancelDeps = {
  loadRun: loadRunForUser,
  updateRun: updateRunForUser,
  loadAiCall: loadOwnedAiCall,
  requestCancellation: requestAiCallCancellationIfActive,
  finalizeCancelled: finalizeAiCallAsCancelledIfActive,
  appendEvent: safeAppendAiCallEvent,
  killRuntimeCommand,
  notifyTerminal: stripSlackRunControlsForTerminalRun,
};

export async function listMogplexApiRunEvents(input: {
  userId: string;
  runId: string;
  limit: number;
  deps?: Partial<RunEventListDeps>;
}) {
  const deps = {
    ...defaultEventDeps,
    ...input.deps,
  };
  const run = await deps.loadRun(input.userId, input.runId);
  if (!run) return null;
  const events = await deps.listEvents(run.ai_call_id, input.limit);
  return {
    run: presentMogplexApiRun(run),
    events: events.map(presentEvent),
  };
}

function isActiveAiCall(call: AiCall) {
  return call.status === "pending" || call.status === "streaming";
}

const ACTIVE_RUN_STATUSES = ["pending", "streaming"] as const;
const TERMINAL_RUN_STATUSES = new Set<ExternalAgentRunRow["status"]>([
  "success",
  "failed",
  "cancelled",
]);

function isTerminalAiCallStatus(status: AiCall["status"]) {
  return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * True when a run status is one that {@link cancelMogplexApiRun} cannot act on
 * anymore (`success` / `failed` / `cancelled`). Useful for callers that need to
 * distinguish "we requested cancellation" from "nothing to cancel".
 */
export function isTerminalMogplexApiRunStatus(
  status: ExternalAgentRunRow["status"]
): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

async function loadFreshRunAfterSkippedUpdate(
  deps: Pick<RunCancelDeps, "loadRun">,
  userId: string,
  run: ExternalAgentRunRow
) {
  return (await deps.loadRun(userId, run.id)) ?? run;
}

export async function cancelMogplexApiRun(input: {
  userId: string;
  runId: string;
  deps?: Partial<RunCancelDeps>;
}) {
  const deps = {
    ...defaultCancelDeps,
    ...input.deps,
  };
  const safeNotifyTerminal = async (
    terminalRun: { id: string; metadata: unknown },
    status: MogplexApiRunStatus
  ): Promise<void> => {
    try {
      await deps.notifyTerminal(terminalRun, status);
    } catch (error) {
      console.warn(
        "[mogplex-api/cancel] terminal-state notification failed",
        terminalRun.id,
        error
      );
    }
  };
  const run = await deps.loadRun(input.userId, input.runId);
  if (!run) return null;
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    // Run was already finished before this call — nothing was cancelled here,
    // but strip any leftover button just in case the completion hook didn't run.
    await safeNotifyTerminal(run, run.status);
    return {
      run: presentMogplexApiRun(run),
      status: run.status,
      alreadyTerminal: true,
    };
  }

  const aiCall = await deps.loadAiCall(input.userId, run.ai_call_id);
  if (!aiCall) {
    console.error("[mogplex-api/cancel] ai_call not found for run", run.id);
    throw new MogplexApiRunControlError(
      "CONFLICT",
      "Run state is inconsistent",
      409
    );
  }
  if (!isActiveAiCall(aiCall)) {
    const updatedRun = await deps.updateRun(input.userId, run.id, {
      status: aiCall.status,
      error: aiCall.error,
    });
    const freshRun =
      updatedRun ??
      (await loadFreshRunAfterSkippedUpdate(deps, input.userId, run));
    // The ai_call had already reached a terminal state; we only synced the run
    // row to match — no cancellation was actually requested by this call.
    await safeNotifyTerminal(freshRun, freshRun.status);
    return {
      run: presentMogplexApiRun(freshRun),
      status: freshRun.status,
      alreadyTerminal: true,
    };
  }

  const cancelRequestedAt =
    aiCall.cancel_requested_at ?? new Date().toISOString();
  const currentCall =
    aiCall.control_state === "cancel_requested" ||
    aiCall.control_state === "cancelled"
      ? aiCall
      : await deps.requestCancellation(aiCall.id, cancelRequestedAt);

  if (!currentCall) {
    throw new MogplexApiRunControlError(
      "CONFLICT",
      "Run is no longer active",
      409
    );
  }

  if (
    aiCall.control_state !== "cancel_requested" &&
    aiCall.control_state !== "cancelled"
  ) {
    await deps.appendEvent({
      aiCallId: aiCall.id,
      userId: input.userId,
      conversationId: aiCall.conversation_id,
      repoId: aiCall.repo_id,
      eventType: "cancel_requested",
      message: "Cancellation requested",
      payload: {
        external_run_id: run.id,
        runtime_command_id: currentCall.runtime_command_id,
      },
    });
  }

  if (currentCall.runtime_command_id) {
    await deps.killRuntimeCommand({
      user_id: run.user_id,
      sandbox_record_id: run.sandbox_record_id,
      runtimeCommandId: currentCall.runtime_command_id,
    });
  }

  const cancelledCall = await deps.finalizeCancelled(
    aiCall.id,
    buildAiCallCompletionUpdate({
      startedAt: aiCall.started_at,
      status: "cancelled",
      cancelRequestedAt,
      controlState: "cancelled",
      runtimeCommandId: currentCall.runtime_command_id,
      metadata: currentCall.metadata,
    })
  );
  const finalCall =
    cancelledCall ?? (await deps.loadAiCall(input.userId, run.ai_call_id));
  const updatedRun =
    finalCall && isTerminalAiCallStatus(finalCall.status)
      ? ((await deps.updateRun(input.userId, run.id, {
          status: finalCall.status,
          error: finalCall.error,
        })) ?? (await loadFreshRunAfterSkippedUpdate(deps, input.userId, run)))
      : await loadFreshRunAfterSkippedUpdate(deps, input.userId, run);

  if (finalCall?.status === "cancelled" && updatedRun.status === "cancelled") {
    await deps.appendEvent({
      aiCallId: aiCall.id,
      userId: input.userId,
      conversationId: aiCall.conversation_id,
      repoId: aiCall.repo_id,
      eventType: "cancelled",
      message: "External Mogplex run cancelled",
      payload: {
        external_run_id: run.id,
        runtime_command_id: currentCall.runtime_command_id,
      },
    });
  }

  if (TERMINAL_RUN_STATUSES.has(updatedRun.status)) {
    await safeNotifyTerminal(updatedRun, updatedRun.status);
  }

  return {
    run: presentMogplexApiRun(updatedRun),
    status: updatedRun.status,
    alreadyTerminal: false,
  };
}
