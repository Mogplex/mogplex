import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxRecord, StopReason } from "@/lib/types";

export type PreviewOverlayStatus =
  | SandboxHealthStatus
  | "building"
  | "build_failed"
  | "deployment_missing";

export function derivePreviewOverlayStatus(
  status: SandboxHealthStatus,
  details?: {
    runtime_summary: SandboxRecord["runtime_summary"];
  } | null
): PreviewOverlayStatus {
  const diagnostics = details?.runtime_summary.vercel_diagnostics;
  if (!diagnostics) return status;

  if (status === "starting" && diagnostics.state === "building") {
    return "building";
  }

  if (
    (status === "starting" ||
      status === "app_error" ||
      status === "unreachable" ||
      status === "error") &&
    diagnostics.state === "build_failed"
  ) {
    return "build_failed";
  }

  if (
    (status === "starting" ||
      status === "app_error" ||
      status === "unreachable" ||
      status === "error") &&
    (diagnostics.state === "deployment_missing" ||
      diagnostics.state === "inaccessible" ||
      diagnostics.state === "platform_not_configured")
  ) {
    return "deployment_missing";
  }

  return status;
}

const STOP_REASON_TEXT = {
  idle_timeout: "Idle for too long",
  lifetime_timeout: "Reached its lifetime limit",
  manual: "You stopped this sandbox",
  stuck_boot: "Boot didn't complete",
  vm_gone: "The VM expired",
  auto_pause: "Auto-paused after you left",
  billing_depleted: "Balance depleted — add funds to restart",
  unknown: null,
} as const satisfies Record<StopReason, string | null>;

/**
 * @param status — must be the result of derivePreviewOverlayStatus, not a
 *   raw SandboxHealthStatus. We rely on derivePreviewOverlayStatus's invariant
 *   that "stopped" passes through unchanged, so a "stopped" overlay status
 *   always corresponds to a stopped health status with a meaningful stop_reason.
 *   If a future call site bypasses derivePreviewOverlayStatus, or that function
 *   ever starts remapping "stopped", this guard needs to be restored.
 */
export function derivePreviewOverlayStopReasonText(
  status: PreviewOverlayStatus,
  details?: {
    runtime_summary: SandboxRecord["runtime_summary"];
    stop_reason?: SandboxRecord["stop_reason"];
  } | null
): string | null {
  if (status !== "stopped") return null;
  const reason = details?.stop_reason ?? null;
  if (!reason) return null;
  return STOP_REASON_TEXT[reason] ?? null;
}
