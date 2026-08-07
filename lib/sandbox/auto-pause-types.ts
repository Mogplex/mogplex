import type { SandboxLifecycleStatus } from "@/lib/types";

export const DEFAULT_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 90_000;

export const MIN_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 10_000;
export const MAX_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS = 30 * 60 * 1000;
export const SANDBOX_AUTO_PAUSE_CLAIMED_STATUS =
  "pausing" satisfies SandboxLifecycleStatus;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SANDBOX_ID_METADATA_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

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

export type LifecycleEventInput = {
  sandboxRecordId: string | null;
  userId: string | null;
  tabId?: string | null;
  sessionId?: string | null;
  eventType: SandboxLifecycleEventType;
  decisionCode?: string | null;
  workerRunId?: string | null;
  payload?: Record<string, unknown>;
};

export type PresenceState = {
  activeSessionCount: number;
  newerSessionEventCount: number;
};

export type SandboxAutoPauseClaimResult = {
  claimed: boolean;
  previousHealthStatus?: string | null;
};

export type AttachRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
};

export type ReleaseRpcResult = {
  session_row_id?: string | null;
  applied?: boolean | null;
  should_queue?: boolean | null;
  released_at?: string | null;
  release_event_id?: string | null;
};

export type SandboxAutoPauseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export type ClaimRpcResult = {
  claimed?: boolean | null;
  previous_health_status?: string | null;
  previousHealthStatus?: string | null;
};
