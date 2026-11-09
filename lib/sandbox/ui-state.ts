import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import { computeSandboxUiBundle } from "./ui-state-resolver";
import type {
  PreviewOverlayStatus,
  ResolveSandboxUiStateInput,
  SandboxUiBundle,
  SandboxUiState,
} from "./ui-state-types";

export type {
  ResolveSandboxUiStateInput,
  SandboxUiBundle,
  SandboxUiState,
} from "./ui-state-types";

export function resolveSandboxUiBundle(
  input: ResolveSandboxUiStateInput
): SandboxUiBundle {
  return computeSandboxUiBundle(input);
}

export function resolveSandboxUiState(
  input: ResolveSandboxUiStateInput
): SandboxUiState {
  return computeSandboxUiBundle(input).state;
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
  return computeSandboxUiBundle(input).overlayStatus;
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
