import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SandboxVmCredentials } from "@/lib/sandbox/liveness";
import type {
  SandboxAutoPauseRecord,
  PresenceState,
  SandboxAutoPauseClaimResult,
  ClaimRpcResult,
  SandboxAutoPausePayload,
  SandboxAutoPauseResult,
  SandboxAutoPauseDecisionCode,
  LifecycleEventInput,
} from "./auto-pause-types";
import { SANDBOX_AUTO_PAUSE_CLAIMED_STATUS } from "./auto-pause-types";
import { buildActiveAiCallSandboxMetadataFilter } from "./auto-pause-presence";

export { recordSandboxLifecycleEvent } from "./auto-pause-presence";

export type RecordLifecycleEventFn = (
  input: LifecycleEventInput
) => Promise<string | null>;

export async function recordAutoPauseDecision(
  recordLifecycleEvent: RecordLifecycleEventFn,
  input: SandboxAutoPausePayload,
  record: SandboxAutoPauseRecord | null,
  decisionCode: SandboxAutoPauseDecisionCode,
  payload: Record<string, unknown> = {}
) {
  await recordLifecycleEvent({
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

export function buildAutoPauseResult(
  decisionCode: SandboxAutoPauseDecisionCode,
  message: string,
  paused = false
): SandboxAutoPauseResult {
  return { decisionCode, message, paused };
}

export function isClaimedOrFinalizedAutoPauseStatus(
  record: SandboxAutoPauseRecord,
  input: SandboxAutoPausePayload
) {
  return (
    record.sandbox_id === input.sandboxId &&
    (record.status === SANDBOX_AUTO_PAUSE_CLAIMED_STATUS ||
      record.status === "paused")
  );
}

export async function skipAutoPause(
  recordLifecycleEvent: RecordLifecycleEventFn,
  input: SandboxAutoPausePayload,
  record: SandboxAutoPauseRecord | null,
  decisionCode: SandboxAutoPauseDecisionCode,
  message: string,
  payload?: Record<string, unknown>
) {
  await recordAutoPauseDecision(
    recordLifecycleEvent,
    input,
    record,
    decisionCode,
    payload
  );
  return buildAutoPauseResult(decisionCode, message);
}

export async function loadSandboxRecord(
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

export async function loadPresenceState(input: {
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

export async function hasActiveAiCall(input: {
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

export async function hasRunningAutomation(sandboxRecordId: string) {
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

export function normalizeAutoPauseClaimResult(
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

export async function claimAutoPause(input: {
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

export async function resolveVmCredentials(
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
