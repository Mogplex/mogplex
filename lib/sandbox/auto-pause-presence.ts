import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  DEFAULT_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS,
  MIN_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS,
  MAX_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS,
  UUID_PATTERN,
  SANDBOX_ID_METADATA_PATTERN,
  type SandboxClientPresenceEvent,
  type SandboxAutoPauseMode,
  type SandboxPresenceInput,
  type SandboxReleaseInput,
  type SandboxClientReleaseResult,
  type SandboxAutoPausePayload,
  type LifecycleEventInput,
  type AttachRpcResult,
  type ReleaseRpcResult,
  type SandboxAutoPauseRpcClient,
} from "./auto-pause-types";

function normalizePresenceId(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error(`${label} must be between 1 and 128 characters`);
  }
  return trimmed;
}

function normalizeReleaseReason(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : null;
}

function normalizeEventSeq(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("eventSeq must be a non-negative integer");
  }
  return value;
}

export function normalizeSandboxPresencePayload(body: unknown): {
  event: SandboxClientPresenceEvent;
  tabId: string;
  sessionId: string;
  eventSeq: number;
  releaseReason: string | null;
} {
  const payload =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const event = payload.event;
  if (event !== "attach" && event !== "release") {
    throw new Error("event must be attach or release");
  }

  return {
    event,
    tabId: normalizePresenceId(payload.tabId, "tabId"),
    sessionId: normalizePresenceId(payload.sessionId, "sessionId"),
    eventSeq: normalizeEventSeq(payload.eventSeq),
    releaseReason: normalizeReleaseReason(payload.reason),
  };
}

export function resolveSandboxAutoPauseGracePeriodMs() {
  const raw = Number(process.env.SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS);
  if (!Number.isFinite(raw)) return DEFAULT_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS;
  return Math.min(
    MAX_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS,
    Math.max(MIN_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS, Math.floor(raw))
  );
}

export function resolveSandboxAutoPauseMode(
  userId?: string | null
): SandboxAutoPauseMode {
  const mode = (process.env.SANDBOX_AUTO_PAUSE_MODE ?? "observe")
    .trim()
    .toLowerCase();
  if (mode === "enabled" || mode === "on" || mode === "true") {
    return "enabled";
  }
  if (mode === "internal") {
    const enabledUsers = new Set(
      (process.env.SANDBOX_AUTO_PAUSE_INTERNAL_USER_IDS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    );
    return userId && enabledUsers.has(userId) ? "enabled" : "observe";
  }
  return "observe";
}

export async function recordSandboxLifecycleEvent(input: LifecycleEventInput) {
  const { data, error } = await supabaseAdmin
    .from("sandbox_lifecycle_events")
    .insert({
      sandbox_record_id: input.sandboxRecordId,
      user_id: input.userId,
      tab_id: input.tabId ?? null,
      session_id: input.sessionId ?? null,
      event_type: input.eventType,
      decision_code: input.decisionCode ?? null,
      worker_run_id: input.workerRunId ?? null,
      payload: input.payload ?? {},
    })
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to record sandbox lifecycle event: ${error.message}`
    );
  }

  return (data as { id?: string } | null)?.id ?? null;
}

const defaultSandboxAutoPauseRpcClient =
  supabaseAdmin as unknown as SandboxAutoPauseRpcClient;

function firstRpcRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as T) : null;
}

export async function recordSandboxClientAttach(input: SandboxPresenceInput) {
  const { data, error } = await defaultSandboxAutoPauseRpcClient.rpc(
    "record_sandbox_client_attach_event",
    {
      p_sandbox_record_id: input.sandboxRecordId,
      p_user_id: input.userId,
      p_tab_id: input.tabId,
      p_session_id: input.sessionId,
      p_event_seq: input.eventSeq,
    }
  );

  if (error) {
    throw new Error(
      `Failed to attach sandbox client session: ${error.message}`
    );
  }

  const result = firstRpcRow<AttachRpcResult>(data);
  if (!result?.applied) return;

  await recordSandboxLifecycleEvent({
    sandboxRecordId: input.sandboxRecordId,
    userId: input.userId,
    tabId: input.tabId,
    sessionId: input.sessionId,
    eventType: "tab_attached",
    payload: {
      event_seq: input.eventSeq,
      session_row_id: result.session_row_id ?? null,
    },
  });
}

export async function recordSandboxClientRelease(
  input: SandboxReleaseInput,
  client: SandboxAutoPauseRpcClient = defaultSandboxAutoPauseRpcClient
): Promise<SandboxClientReleaseResult> {
  const { data, error } = await client.rpc(
    "record_sandbox_client_release_event",
    {
      p_sandbox_record_id: input.sandboxRecordId,
      p_user_id: input.userId,
      p_tab_id: input.tabId,
      p_session_id: input.sessionId,
      p_event_seq: input.eventSeq,
      p_release_reason: input.releaseReason ?? null,
    }
  );

  if (error) {
    throw new Error(
      `Failed to release sandbox client session: ${error.message}`
    );
  }

  const result = firstRpcRow<ReleaseRpcResult>(data);
  const sessionRowId = result?.session_row_id ?? undefined;
  const releasedAt = result?.released_at ?? undefined;
  const releaseEventId = result?.release_event_id ?? undefined;

  if (!result?.should_queue || !sessionRowId || !releasedAt) {
    return {
      released: Boolean(result?.applied),
      sessionRowId,
      releasedAt,
      releaseEventId,
      shouldQueue: false,
    };
  }

  if (!releaseEventId) {
    throw new Error("Sandbox release RPC did not return release_event_id");
  }

  return {
    released: Boolean(result.applied),
    sessionRowId,
    releasedAt,
    releaseEventId,
    shouldQueue: true,
  };
}

export async function queueSandboxAutoPauseCheck(
  input: SandboxAutoPausePayload & { sessionRowId?: string }
) {
  const { sessionRowId, ...payload } = input;
  const { tasks } = await import("@trigger.dev/sdk/v3");
  await tasks.trigger(TRIGGER_TASK_IDS.sandboxAutoPause, payload, {
    delay: `${Math.ceil(input.gracePeriodMs / 1000)}s`,
    idempotencyKey: `sandbox-auto-pause:${input.sandboxRecordId}:${input.releaseEventId}`,
  });

  try {
    await recordSandboxLifecycleEvent({
      sandboxRecordId: input.sandboxRecordId,
      userId: input.userId,
      tabId: input.tabId,
      sessionId: input.sessionId,
      eventType: "auto_pause_queued",
      payload: {
        release_event_id: input.releaseEventId,
        released_at: input.releasedAt,
        grace_period_ms: input.gracePeriodMs,
      },
    });

    if (sessionRowId) {
      const { error } = await supabaseAdmin
        .from("sandbox_client_sessions")
        .update({ auto_pause_queued_at: new Date().toISOString() })
        .eq("id", sessionRowId);
      if (error) {
        throw new Error(
          `Failed to mark sandbox auto-pause as queued: ${error.message}`
        );
      }
    }
  } catch (error) {
    console.warn(
      "[sandbox/auto-pause] Trigger accepted auto-pause task, but post-queue audit update failed:",
      error
    );
  }
}

export function buildActiveAiCallSandboxMetadataFilter(
  sandboxRecordId: string,
  sandboxId?: string
) {
  if (!UUID_PATTERN.test(sandboxRecordId)) {
    throw new Error("sandboxRecordId must be a UUID for metadata filtering");
  }

  const filters = [
    `metadata->>sandbox_record_id.eq.${sandboxRecordId}`,
    `metadata->>sandbox_id.eq.${sandboxRecordId}`,
  ];

  if (sandboxId && sandboxId !== sandboxRecordId) {
    if (!SANDBOX_ID_METADATA_PATTERN.test(sandboxId)) {
      throw new Error("sandboxId has unsupported metadata filter characters");
    }
    filters.push(`metadata->>sandbox_id.eq.${sandboxId}`);
  }

  return filters.join(",");
}
