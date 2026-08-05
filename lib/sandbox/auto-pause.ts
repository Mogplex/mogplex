import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { SandboxVmCredentials } from "@/lib/sandbox/liveness";
import type { SandboxLifecycleStatus } from "@/lib/types";

export const DEFAULT_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 90_000;

const MIN_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 10_000;
const MAX_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 30 * 60 * 1000;
const SANDBOX_AUTO_PAUSE_CLAIMED_STATUS =
  "pausing" satisfies SandboxLifecycleStatus;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SANDBOX_ID_METADATA_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

export type SandboxClientPresenceEvent = "attach" | "release";

export type SandboxLifecycleEventType =
  | "tab_attached"
  | "tab_released"
  | "auto_pause_queued"
  | "auto_pause_decision"
  | "auto_pause_succeeded"
  | "auto_pause_failed"
  | "resume_after_auto_pause";

export type SandboxAutoPauseDecisionCode =
  | "would_auto_pause"
  | "auto_pause_succeeded"
  | "auto_pause_skipped_busy"
  | "auto_pause_skipped_grace_period"
  | "auto_pause_skipped_missing_credentials"
  | "auto_pause_skipped_new_session"
  | "auto_pause_skipped_not_found"
  | "auto_pause_skipped_not_persistent"
  | "auto_pause_skipped_not_running"
  | "auto_pause_skipped_status_changed"
  | "auto_pause_failed";

export type SandboxAutoPauseMode = "observe" | "enabled";

export type SandboxAutoPausePayload = {
  sandboxRecordId: string;
  sandboxId: string;
  userId: string;
  tabId: string;
  sessionId: string;
  releasedAt: string;
  releaseEventId: string;
  gracePeriodMs: number;
};

export type SandboxAutoPauseRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  status: string;
  health_status: string | null;
  exec_lock_token: string | null;
  persistent: boolean | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

export type SandboxPresenceInput = {
  sandboxRecordId: string;
  sandboxId: string;
  userId: string;
  tabId: string;
  sessionId: string;
  eventSeq: number;
};

export type SandboxReleaseInput = SandboxPresenceInput & {
  releaseReason?: string | null;
};

export type SandboxClientReleaseResult = {
  released: boolean;
  sessionRowId?: string;
  releasedAt?: string;
  releaseEventId?: string;
  shouldQueue: boolean;
};

export type SandboxAutoPauseResult = {
  decisionCode: SandboxAutoPauseDecisionCode;
  paused: boolean;
  message: string;
};

type LifecycleEventInput = {
  sandboxRecordId: string | null;
  userId: string | null;
  tabId?: string | null;
  sessionId?: string | null;
  eventType: SandboxLifecycleEventType;
  decisionCode?: string | null;
  workerRunId?: string | null;
  payload?: Record<string, unknown>;
};

type PresenceState = {
  activeSessionCount: number;
  newerSessionEventCount: number;
};

type SandboxAutoPauseClaimResult = {
  claimed: boolean;
  previousHealthStatus?: string | null;
};

type SandboxAutoPauseRunnerDeps = {
  loadSandboxRecord: (
    sandboxRecordId: string
  ) => Promise<SandboxAutoPauseRecord | null>;
  loadPresenceState: (input: {
    sandboxRecordId: string;
    releasedAt: string;
  }) => Promise<PresenceState>;
  hasActiveAiCall: (input: {
    sandboxRecordId: string;
    sandboxId: string;
  }) => Promise<boolean>;
  hasRunningAutomation: (sandboxRecordId: string) => Promise<boolean>;
  claimAutoPause: (input: {
    sandboxRecordId: string;
    sandboxId: string;
    releasedAt: string;
  }) => Promise<boolean | SandboxAutoPauseClaimResult>;
  resolveVmCredentials: (
    record: SandboxAutoPauseRecord
  ) => Promise<SandboxVmCredentials | null>;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  recordLifecycleEvent: (input: LifecycleEventInput) => Promise<string | null>;
  resolveMode: (record: SandboxAutoPauseRecord) => SandboxAutoPauseMode;
  nowMs: () => number;
};

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

type AttachRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
};

type ReleaseRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
  should_queue?: boolean | null;
  released_at?: string | null;
  release_event_id?: string | null;
};

type SandboxAutoPauseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const defaultSandboxAutoPauseRpcClient =
  supabaseAdmin as unknown as SandboxAutoPauseRpcClient;

function firstRpcRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as T) : null;
}

type ClaimRpcResult = {
  claimed?: boolean | null;
  previous_health_status?: string | null;
  previousHealthStatus?: string | null;
};

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

async function loadSandboxRecord(
  sandboxRecordId: string
): Promise<SandboxAutoPauseRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, user_id, repo_id, sandbox_id, status, health_status, exec_lock_token, persistent, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id"
    )
    .eq("id", sandboxRecordId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load sandbox for auto-pause: ${error.message}`);
  }

  return data as SandboxAutoPauseRecord | null;
}

async function loadPresenceState(input: {
  sandboxRecordId: string;
  releasedAt: string;
}): Promise<PresenceState> {
  const [activeResult, newerResult] = await Promise.all([
    supabaseAdmin
      .from("sandbox_client_sessions")
      .select("id", { count: "exact", head: true })
      .eq("sandbox_record_id", input.sandboxRecordId)
      .is("released_at", null),
    supabaseAdmin
      .from("sandbox_client_sessions")
      .select("id", { count: "exact", head: true })
      .eq("sandbox_record_id", input.sandboxRecordId)
      .gt("last_event_at", input.releasedAt),
  ]);

  if (activeResult.error) {
    throw new Error(
      `Failed to load active sandbox sessions: ${activeResult.error.message}`
    );
  }
  if (newerResult.error) {
    throw new Error(
      `Failed to load newer sandbox session events: ${newerResult.error.message}`
    );
  }

  return {
    activeSessionCount: activeResult.count ?? 0,
    newerSessionEventCount: newerResult.count ?? 0,
  };
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

async function hasActiveAiCall(input: {
  sandboxRecordId: string;
  sandboxId: string;
}) {
  const { count, error } = await supabaseAdmin
    .from("ai_calls")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "streaming"])
    .or(
      buildActiveAiCallSandboxMetadataFilter(
        input.sandboxRecordId,
        input.sandboxId
      )
    );

  if (error) {
    throw new Error(`Failed to load active ai_calls: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function hasRunningAutomation(sandboxRecordId: string) {
  const { count, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("sandbox_record_id", sandboxRecordId)
    .in("status", ["pending", "streaming"]);

  if (error) {
    throw new Error(
      `Failed to load active external agent runs: ${error.message}`
    );
  }

  return (count ?? 0) > 0;
}

async function claimAutoPause(input: {
  sandboxRecordId: string;
  sandboxId: string;
  releasedAt: string;
}): Promise<SandboxAutoPauseClaimResult> {
  const { data, error } = await supabaseAdmin.rpc("claim_sandbox_auto_pause", {
    p_sandbox_record_id: input.sandboxRecordId,
    p_sandbox_id: input.sandboxId,
    p_released_at: input.releasedAt,
  });

  if (error) {
    throw new Error(`Failed to claim sandbox auto-pause: ${error.message}`);
  }

  return normalizeAutoPauseClaimResult(data);
}

function normalizeAutoPauseClaimResult(
  data: unknown
): SandboxAutoPauseClaimResult {
  if (typeof data === "boolean") {
    return { claimed: data };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { claimed: false };
  }

  const result = row as ClaimRpcResult;
  return {
    claimed: result.claimed === true,
    previousHealthStatus:
      result.previous_health_status ?? result.previousHealthStatus ?? null,
  };
}

async function resolveVmCredentials(
  record: SandboxAutoPauseRecord
): Promise<SandboxVmCredentials | null> {
  const [platformCredentials, userCredentials] = await Promise.all([
    Promise.resolve(getPlatformSandboxCredentials()),
    loadUserVercelCredentials(record.user_id),
  ]);

  const contextResult = await resolveSandboxRecordContext({
    sandboxCredentials: {
      userId: record.user_id,
      ...platformCredentials,
      ...userCredentials,
    },
    record,
  });

  if (!contextResult.ok) {
    return null;
  }

  return {
    vercelToken: contextResult.context.credentials.vercelToken,
    vercelTeamId: contextResult.context.credentials.vercelTeamId ?? null,
    vercelProjectId: contextResult.context.credentials.vercelProjectId,
  };
}

const defaultSandboxAutoPauseRunnerDeps: SandboxAutoPauseRunnerDeps = {
  loadSandboxRecord,
  loadPresenceState,
  hasActiveAiCall,
  hasRunningAutomation,
  claimAutoPause,
  resolveVmCredentials,
  getSandbox,
  updateSandboxRecord,
  recordLifecycleEvent: recordSandboxLifecycleEvent,
  resolveMode: (record) => resolveSandboxAutoPauseMode(record.user_id),
  nowMs: () => Date.now(),
};

async function recordAutoPauseDecision(
  deps: Pick<SandboxAutoPauseRunnerDeps, "recordLifecycleEvent">,
  input: SandboxAutoPausePayload,
  record: SandboxAutoPauseRecord | null,
  decisionCode: SandboxAutoPauseDecisionCode,
  payload: Record<string, unknown> = {}
) {
  await deps.recordLifecycleEvent({
    sandboxRecordId: input.sandboxRecordId,
    userId: record?.user_id ?? input.userId,
    tabId: input.tabId,
    sessionId: input.sessionId,
    eventType:
      decisionCode === "auto_pause_succeeded"
        ? "auto_pause_succeeded"
        : decisionCode === "auto_pause_failed"
          ? "auto_pause_failed"
          : "auto_pause_decision",
    decisionCode,
    payload: {
      release_event_id: input.releaseEventId,
      released_at: input.releasedAt,
      ...payload,
    },
  });
}

function buildAutoPauseResult(
  decisionCode: SandboxAutoPauseDecisionCode,
  message: string,
  paused = false
): SandboxAutoPauseResult {
  return { decisionCode, message, paused };
}

function isClaimedOrFinalizedAutoPauseStatus(
  record: SandboxAutoPauseRecord,
  input: SandboxAutoPausePayload
) {
  return (
    record.sandbox_id === input.sandboxId &&
    (record.status === SANDBOX_AUTO_PAUSE_CLAIMED_STATUS ||
      record.status === "paused")
  );
}

async function skipAutoPause(
  deps: Pick<SandboxAutoPauseRunnerDeps, "recordLifecycleEvent">,
  input: SandboxAutoPausePayload,
  record: SandboxAutoPauseRecord | null,
  decisionCode: SandboxAutoPauseDecisionCode,
  message: string,
  payload?: Record<string, unknown>
) {
  await recordAutoPauseDecision(deps, input, record, decisionCode, payload);
  return buildAutoPauseResult(decisionCode, message);
}

export async function runSandboxAutoPauseCheck(
  input: SandboxAutoPausePayload,
  overrides: Partial<SandboxAutoPauseRunnerDeps> = {}
): Promise<SandboxAutoPauseResult> {
  const deps: SandboxAutoPauseRunnerDeps = {
    ...defaultSandboxAutoPauseRunnerDeps,
    ...overrides,
  };
  const releasedAtMs = new Date(input.releasedAt).getTime();
  const elapsedMs = deps.nowMs() - releasedAtMs;
  if (!Number.isFinite(releasedAtMs) || elapsedMs < input.gracePeriodMs) {
    return skipAutoPause(
      deps,
      input,
      null,
      "auto_pause_skipped_grace_period",
      "Auto-pause check ran before the grace period elapsed.",
      { elapsed_ms: Number.isFinite(elapsedMs) ? elapsedMs : null }
    );
  }

  const [record, presence, activeAiCall, runningAutomation] = await Promise.all(
    [
      deps.loadSandboxRecord(input.sandboxRecordId),
      deps.loadPresenceState({
        sandboxRecordId: input.sandboxRecordId,
        releasedAt: input.releasedAt,
      }),
      deps.hasActiveAiCall({
        sandboxRecordId: input.sandboxRecordId,
        sandboxId: input.sandboxId,
      }),
      deps.hasRunningAutomation(input.sandboxRecordId),
    ]
  );
  if (!record) {
    return skipAutoPause(
      deps,
      input,
      null,
      "auto_pause_skipped_not_found",
      "Sandbox record no longer exists."
    );
  }

  if (record.sandbox_id !== input.sandboxId || record.status !== "running") {
    const statusChanged = isClaimedOrFinalizedAutoPauseStatus(record, input);
    return skipAutoPause(
      deps,
      input,
      record,
      statusChanged
        ? "auto_pause_skipped_status_changed"
        : "auto_pause_skipped_not_running",
      statusChanged
        ? "Sandbox auto-pause was already claimed or finalized."
        : "Sandbox is no longer the released running VM.",
      {
        current_sandbox_id: record.sandbox_id,
        current_status: record.status,
      }
    );
  }

  if (!record.persistent) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_not_persistent",
      "Sandbox is not persistent."
    );
  }

  if (record.exec_lock_token) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has an active exec lock.",
      { busy_reason: "exec_lock" }
    );
  }

  if (presence.activeSessionCount > 0 || presence.newerSessionEventCount > 0) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_new_session",
      "A workspace session is attached or a newer presence event exists.",
      presence
    );
  }

  if (activeAiCall) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has a pending or streaming AI call.",
      { busy_reason: "ai_call" }
    );
  }

  if (runningAutomation) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_busy",
      "Sandbox has a running automation.",
      { busy_reason: "automation" }
    );
  }

  const mode = deps.resolveMode(record);
  if (mode === "observe") {
    await recordAutoPauseDecision(deps, input, record, "would_auto_pause", {
      mode,
    });
    return buildAutoPauseResult(
      "would_auto_pause",
      "Sandbox would auto-pause; observe-only mode is active."
    );
  }

  const credentials = await deps.resolveVmCredentials(record);
  if (!credentials) {
    return skipAutoPause(
      deps,
      input,
      record,
      "auto_pause_skipped_missing_credentials",
      "Sandbox VM credentials could not be resolved."
    );
  }

  // Keep the final checks close to the state transition. This is deliberately
  // one sequential pass, not a retry loop, so attach/exec/AI races have one
  // last chance to block the atomic claim.
  const finalRecord = await deps.loadSandboxRecord(input.sandboxRecordId);
  if (!finalRecord) {
    return skipAutoPause(
      deps,
      input,
      null,
      "auto_pause_skipped_not_found",
      "Sandbox record no longer exists."
    );
  }
  if (
    finalRecord.sandbox_id !== input.sandboxId ||
    finalRecord.status !== "running"
  ) {
    const statusChanged = isClaimedOrFinalizedAutoPauseStatus(
      finalRecord,
      input
    );
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      statusChanged
        ? "auto_pause_skipped_status_changed"
        : "auto_pause_skipped_not_running",
      statusChanged
        ? "Sandbox auto-pause was already claimed or finalized."
        : "Sandbox is no longer the released running VM.",
      {
        current_sandbox_id: finalRecord.sandbox_id,
        current_status: finalRecord.status,
      }
    );
  }
  if (!finalRecord.persistent) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_not_persistent",
      "Sandbox is not persistent."
    );
  }
  if (finalRecord.exec_lock_token) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has an active exec lock.",
      { busy_reason: "exec_lock", phase: "final_check" }
    );
  }

  const finalPresence = await deps.loadPresenceState({
    sandboxRecordId: input.sandboxRecordId,
    releasedAt: input.releasedAt,
  });
  if (
    finalPresence.activeSessionCount > 0 ||
    finalPresence.newerSessionEventCount > 0
  ) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_new_session",
      "A workspace session is attached or a newer presence event exists.",
      { ...finalPresence, phase: "final_check" }
    );
  }
  if (
    await deps.hasActiveAiCall({
      sandboxRecordId: input.sandboxRecordId,
      sandboxId: input.sandboxId,
    })
  ) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has a pending or streaming AI call.",
      { busy_reason: "ai_call", phase: "final_check" }
    );
  }
  if (await deps.hasRunningAutomation(input.sandboxRecordId)) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_busy",
      "Sandbox has a running automation.",
      { busy_reason: "automation", phase: "final_check" }
    );
  }

  const claimResult = normalizeAutoPauseClaimResult(
    await deps.claimAutoPause({
      sandboxRecordId: input.sandboxRecordId,
      sandboxId: input.sandboxId,
      releasedAt: input.releasedAt,
    })
  );
  if (!claimResult.claimed) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_status_changed",
      "Sandbox changed or became busy before the auto-pause claim committed.",
      { phase: "claim" }
    );
  }

  const previousHealthStatus =
    claimResult.previousHealthStatus ?? finalRecord.health_status ?? "running";
  let sandbox: Awaited<ReturnType<typeof getSandbox>>;
  try {
    sandbox = await deps.getSandbox(finalRecord.sandbox_id, credentials);
    await sandbox.stop();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Auto-pause failed";
    await deps
      .updateSandboxRecord(
        finalRecord.id,
        {
          status: "running",
          health_status: previousHealthStatus,
          stop_reason: null,
        },
        {
          expectedSandboxId: finalRecord.sandbox_id,
          fromStatuses: SANDBOX_AUTO_PAUSE_CLAIMED_STATUS,
        }
      )
      .catch((restoreError) => {
        console.warn(
          "[sandbox/auto-pause] Failed to restore running state after auto-pause stop failure:",
          restoreError
        );
      });
    await recordAutoPauseDecision(
      deps,
      input,
      finalRecord,
      "auto_pause_failed",
      {
        error: message,
      }
    );
    return buildAutoPauseResult("auto_pause_failed", message);
  }

  const snapshotId = sandbox.currentSnapshotId ?? null;
  if (!snapshotId && finalRecord.persistent) {
    console.warn(
      "[sandbox/auto-pause] Persistent sandbox stopped without a snapshot ID:",
      {
        sandboxRecordId: finalRecord.id,
        sandboxId: finalRecord.sandbox_id,
      }
    );
  }

  let finalized = false;
  try {
    const finalUpdate = await deps.updateSandboxRecord(
      finalRecord.id,
      {
        status: "paused",
        health_status: "paused",
        stop_reason: "auto_pause",
        snapshot_id: snapshotId,
      },
      {
        expectedSandboxId: finalRecord.sandbox_id,
        fromStatuses: SANDBOX_AUTO_PAUSE_CLAIMED_STATUS,
      }
    );
    finalized = Boolean(finalUpdate);
  } catch (finalizeError) {
    console.warn(
      "[sandbox/auto-pause] Sandbox stopped, but paused-state finalize failed:",
      finalizeError
    );
  }

  if (!finalized) {
    return skipAutoPause(
      deps,
      input,
      finalRecord,
      "auto_pause_skipped_status_changed",
      "Sandbox auto-pause finalize was superseded after the VM stopped.",
      {
        phase: "finalize",
        snapshot_id: snapshotId,
      }
    );
  }

  await recordAutoPauseDecision(
    deps,
    input,
    finalRecord,
    "auto_pause_succeeded",
    {
      snapshot_id: snapshotId,
    }
  );
  return buildAutoPauseResult(
    "auto_pause_succeeded",
    "Sandbox auto-paused.",
    true
  );
}
