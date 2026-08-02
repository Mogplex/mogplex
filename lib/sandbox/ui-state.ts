import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import { derivePreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";
import type { PreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";
import type { SandboxRecord, StopReason } from "@/lib/types";
import type { Session } from "@/hooks/use-sessions";

const STARTING_RUNTIME_STATUSES: ReadonlySet<string> = new Set([
  "creating",
  "installing",
]);
const ERROR_RUNTIME_HEALTH_STATUSES: ReadonlySet<SandboxHealthStatus> = new Set(
  ["app_error", "unreachable", "not_available"]
);

export type SandboxUiState =
  | { kind: "no_session" }
  | { kind: "no_sandbox"; branch: string | null; lastSandboxId: string | null }
  | {
      kind: "booting";
      sandboxId: string;
      phase: "creating" | "installing";
      runtimeStatus?: "pausing";
    }
  | { kind: "starting"; sandboxId: string; previewUrl: string | null }
  | {
      kind: "live";
      sandboxId: string;
      previewUrl: string;
      expiresAt: string;
    }
  | {
      kind: "degraded";
      sandboxId: string;
      reason: "app_error" | "unreachable" | "idle_warning";
      previewUrl: string | null;
    }
  | { kind: "paused"; sandboxId: string; snapshotId: string | null }
  | {
      kind: "stopped";
      sandboxId: string;
      reason: StopReason | null;
      branch: string;
    }
  | { kind: "errored"; sandboxId: string; message: string };

type ResolveSandboxUiStateInput = {
  session: Session | null;
  record: SandboxRecord | null;
  liveProbe?: SandboxHealthStatus;
};

function getSandboxErrorMessage(record: SandboxRecord): string {
  return (
    record.error_summary.display_error ??
    record.error_summary.current_error ??
    record.error_summary.last_preview_error ??
    record.error_summary.last_boot_error ??
    "Sandbox failed to start"
  );
}

function getLiveExpiresAt(record: SandboxRecord): string {
  // Idle timeout resets on activity, so expiry must be measured from
  // last_active_at (matching useSandboxTimeRemaining); fall back to created_at
  // for records without activity yet.
  const baseTimestamp = record.last_active_at ?? record.created_at;
  const timeoutMs = record.runtime_summary.effective_timeout_ms;
  if (typeof timeoutMs !== "number" || timeoutMs <= 0) return baseTimestamp;

  const baseMs = new Date(baseTimestamp).getTime();
  if (!Number.isFinite(baseMs)) return baseTimestamp;

  return new Date(baseMs + timeoutMs).toISOString();
}

function getEffectiveHealthStatus(
  record: SandboxRecord,
  liveProbe: SandboxHealthStatus | undefined
): SandboxHealthStatus {
  return liveProbe ?? derivePersistedSandboxHealthStatus(record);
}

function derivePersistedSandboxHealthStatus(
  record: SandboxRecord | null | undefined
): SandboxHealthStatus {
  const runtimeSummary = record?.runtime_summary;
  if (!runtimeSummary) return "not_available";

  const runtimeStatus = runtimeSummary.status;
  const healthStatus = runtimeSummary.health_status as
    | SandboxHealthStatus
    | undefined;

  const runtimeDerivedStatus = getRuntimeDerivedHealthStatus(
    runtimeStatus,
    healthStatus
  );
  if (runtimeDerivedStatus) return runtimeDerivedStatus;

  return getFallbackHealthStatus(runtimeStatus, healthStatus);
}

function getRuntimeDerivedHealthStatus(
  runtimeStatus: string,
  healthStatus: SandboxHealthStatus | undefined
): SandboxHealthStatus | null {
  if (STARTING_RUNTIME_STATUSES.has(runtimeStatus)) return "starting";
  if (runtimeStatus === "pausing") return "pausing";
  if (runtimeStatus === "stopped") return "stopped";
  if (runtimeStatus === "paused") return "paused";
  if (runtimeStatus !== "error") return null;

  return healthStatus && ERROR_RUNTIME_HEALTH_STATUSES.has(healthStatus)
    ? healthStatus
    : "error";
}

function getFallbackHealthStatus(
  runtimeStatus: string,
  healthStatus: SandboxHealthStatus | undefined
): SandboxHealthStatus {
  if (healthStatus === "idle_warning") return "idle_warning";
  if (healthStatus) return healthStatus;
  return runtimeStatus === "running" ? "running" : "not_available";
}

function resolveMissingSandboxUiState(session: Session | null): SandboxUiState {
  if (!session) return { kind: "no_session" };
  return {
    kind: "no_sandbox",
    branch: session.pendingSandboxBranch ?? null,
    lastSandboxId: session.activeSandboxId ?? null,
  };
}

function resolveRuntimeSandboxUiState(
  record: SandboxRecord
): SandboxUiState | null {
  const runtimeStatus = record.runtime_summary.status;
  if (runtimeStatus === "creating" || runtimeStatus === "installing") {
    return {
      kind: "booting",
      sandboxId: record.id,
      phase: runtimeStatus,
    };
  }

  if (runtimeStatus === "pausing") {
    return {
      kind: "booting",
      sandboxId: record.id,
      phase: "installing",
      runtimeStatus: "pausing",
    };
  }

  if (runtimeStatus === "paused") {
    if (record.snapshot_id || record.runtime_summary.persistent === true) {
      return {
        kind: "paused",
        sandboxId: record.id,
        snapshotId: record.snapshot_id,
      };
    }

    return {
      kind: "errored",
      sandboxId: record.id,
      message: "Paused sandbox is missing a snapshot",
    };
  }

  if (runtimeStatus === "stopped") {
    return {
      kind: "stopped",
      sandboxId: record.id,
      reason: record.stop_reason ?? null,
      branch: record.working_branch,
    };
  }

  if (runtimeStatus === "error") {
    return {
      kind: "errored",
      sandboxId: record.id,
      message: getSandboxErrorMessage(record),
    };
  }

  // "running" is the only status that legitimately falls through to the overlay
  // path. Anything else (e.g. future "terminating", "migrating") is schema
  // drift — surface it as errored rather than silently rendering as starting.
  if (runtimeStatus !== "running") {
    return {
      kind: "errored",
      sandboxId: record.id,
      message: `Unknown sandbox status: ${runtimeStatus}`,
    };
  }

  return null;
}

function resolveOverlaySandboxUiState(
  record: SandboxRecord,
  overlayStatus: PreviewOverlayStatus
): SandboxUiState {
  return (
    resolveTerminalOverlaySandboxUiState(record, overlayStatus) ??
    resolveDiagnosticOverlaySandboxUiState(record, overlayStatus) ??
    resolvePreviewHealthOverlaySandboxUiState(record, overlayStatus)
  );
}

function resolveTerminalOverlaySandboxUiState(
  record: SandboxRecord,
  overlayStatus: PreviewOverlayStatus
): SandboxUiState | null {
  if (
    overlayStatus !== "stopped" &&
    overlayStatus !== "paused" &&
    overlayStatus !== "error"
  ) {
    return null;
  }

  if (overlayStatus === "stopped") {
    return {
      kind: "stopped",
      sandboxId: record.id,
      reason: record.stop_reason ?? null,
      branch: record.working_branch,
    };
  }

  if (overlayStatus === "paused") {
    if (record.snapshot_id || record.runtime_summary.persistent === true) {
      return {
        kind: "paused",
        sandboxId: record.id,
        snapshotId: record.snapshot_id,
      };
    }

    return {
      kind: "errored",
      sandboxId: record.id,
      message: "Paused sandbox is missing a snapshot",
    };
  }

  return {
    kind: "errored",
    sandboxId: record.id,
    message: getSandboxErrorMessage(record),
  };
}

function resolveDiagnosticOverlaySandboxUiState(
  record: SandboxRecord,
  overlayStatus: PreviewOverlayStatus
): SandboxUiState | null {
  if (overlayStatus === "building") {
    return {
      kind: "booting",
      sandboxId: record.id,
      phase: "installing",
    };
  }

  if (overlayStatus === "pausing") {
    return {
      kind: "booting",
      sandboxId: record.id,
      phase: "installing",
      runtimeStatus: "pausing",
    };
  }

  if (
    overlayStatus === "build_failed" ||
    overlayStatus === "deployment_missing"
  ) {
    return {
      kind: "errored",
      sandboxId: record.id,
      message: getSandboxErrorMessage(record),
    };
  }

  return null;
}

function resolvePreviewHealthOverlaySandboxUiState(
  record: SandboxRecord,
  overlayStatus: PreviewOverlayStatus
): SandboxUiState {
  if (
    overlayStatus === "app_error" ||
    overlayStatus === "unreachable" ||
    overlayStatus === "idle_warning"
  ) {
    return {
      kind: "degraded",
      sandboxId: record.id,
      reason: overlayStatus,
      previewUrl: record.runtime_summary.preview_url,
    };
  }

  if (overlayStatus === "running" && record.runtime_summary.preview_url) {
    return {
      kind: "live",
      sandboxId: record.id,
      previewUrl: record.runtime_summary.preview_url,
      expiresAt: getLiveExpiresAt(record),
    };
  }

  return {
    kind: "starting",
    sandboxId: record.id,
    previewUrl: record.runtime_summary.preview_url,
  };
}

export type SandboxUiBundle = {
  state: SandboxUiState;
  overlayStatus: PreviewOverlayStatus;
};

// Compute the UI state and the preview overlay status in a single traversal so
// callers that need both (e.g. preview-pane) cannot accidentally re-run the
// resolver pipeline twice and risk drift between the two derived values.
export function resolveSandboxUiBundle({
  session,
  record,
  liveProbe,
}: ResolveSandboxUiStateInput): SandboxUiBundle {
  if (!record) {
    // Without a record there is no preview to overlay; use the literal
    // "not_available" rather than re-deriving via getSandboxUiHealthStatus so
    // the two values cannot silently diverge if the no_sandbox/no_session
    // health mapping ever changes.
    return {
      state: resolveMissingSandboxUiState(session),
      overlayStatus: "not_available",
    };
  }

  const effectiveHealthStatus = getEffectiveHealthStatus(record, liveProbe);
  const overlayStatus = derivePreviewOverlayStatus(
    effectiveHealthStatus,
    record
  );

  const runtimeState = resolveRuntimeSandboxUiState(record);
  if (runtimeState) {
    return {
      state: runtimeState,
      overlayStatus:
        runtimeState.kind === "booting" &&
        runtimeState.runtimeStatus === "pausing"
          ? "pausing"
          : overlayStatus,
    };
  }

  return {
    state: resolveOverlaySandboxUiState(record, overlayStatus),
    overlayStatus,
  };
}

export function resolveSandboxUiState(
  input: ResolveSandboxUiStateInput
): SandboxUiState {
  return resolveSandboxUiBundle(input).state;
}

export function getSandboxUiRuntimeStatus(
  state: SandboxUiState
): string | null {
  switch (state.kind) {
    case "booting":
      return state.runtimeStatus ?? state.phase;
    case "live":
    case "starting":
    case "degraded":
      return "running";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "errored":
      return "error";
    case "no_sandbox":
    case "no_session":
      return null;
  }
}

export function getSandboxUiHealthStatus(
  state: SandboxUiState
): SandboxHealthStatus {
  switch (state.kind) {
    case "booting":
      if (state.runtimeStatus === "pausing") return "pausing";
      return "starting";
    case "starting":
      return "starting";
    case "live":
      return "running";
    case "degraded":
      return state.reason;
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "errored":
      return "error";
    case "no_sandbox":
    case "no_session":
      return "not_available";
  }
}

export function resolveSandboxPreviewOverlayStatus(
  input: ResolveSandboxUiStateInput
): PreviewOverlayStatus {
  return resolveSandboxUiBundle(input).overlayStatus;
}

// Booting sandboxes intentionally omit previewUrl: while runtime_summary may
// carry a preview_url during creating/installing in some flows (e.g. Vercel
// preview deployments), surfacing it before the dev server is up routes users
// to a 502/blank page. Only "live", "starting", and "degraded" states have a
// preview URL worth showing.
export function getSandboxUiPreviewUrl(
  state: SandboxUiState
): string | undefined {
  switch (state.kind) {
    case "live":
      return state.previewUrl;
    case "starting":
    case "degraded":
      // Coerce empty strings to undefined alongside null: an iframe src="" resolves
      // to the current page URL, which would silently embed Mogplex inside itself.
      return state.previewUrl || undefined;
    default:
      return undefined;
  }
}

export function isSandboxUiRuntimeRunning(state: SandboxUiState): boolean {
  return (
    state.kind === "live" ||
    state.kind === "starting" ||
    state.kind === "degraded"
  );
}

// idle_warning sandboxes are still serving traffic — only the idle timeout is
// approaching — so they remain "reachable" for preview-URL display and the
// active-preview counter. app_error and unreachable degraded reasons mean the
// preview is broken in a user-visible way and stay excluded.
export function isSandboxUiReachablePreview(state: SandboxUiState): boolean {
  return (
    state.kind === "live" ||
    state.kind === "starting" ||
    isSandboxUiIdleWarning(state)
  );
}

export function isSandboxUiIdleWarning(state: SandboxUiState): boolean {
  return state.kind === "degraded" && state.reason === "idle_warning";
}

export function isSandboxUiNoSession(state: SandboxUiState): boolean {
  return state.kind === "no_session";
}

export function isSandboxUiNoSandbox(state: SandboxUiState): boolean {
  return state.kind === "no_sandbox";
}

export function isSandboxUiBooting(state: SandboxUiState): boolean {
  return state.kind === "booting";
}

export function isSandboxUiStarting(state: SandboxUiState): boolean {
  return state.kind === "starting";
}

export function isSandboxUiLive(state: SandboxUiState): boolean {
  return state.kind === "live";
}

export function isSandboxUiDegraded(state: SandboxUiState): boolean {
  return state.kind === "degraded";
}

export function isSandboxUiPaused(state: SandboxUiState): boolean {
  return state.kind === "paused";
}

export function isSandboxUiStopped(state: SandboxUiState): boolean {
  return state.kind === "stopped";
}

export function isSandboxUiErrored(state: SandboxUiState): boolean {
  return state.kind === "errored";
}
