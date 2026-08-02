import {
  formatSandboxBillingLabel,
  formatSandboxTeamLabel,
} from "@/lib/sandbox/summary";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxCallContext, SandboxRecord } from "@/lib/types";

type SandboxDebugInput = {
  sandbox?: Pick<
    SandboxRecord,
    | "id"
    | "sandbox_id"
    | "billing_summary"
    | "runtime_summary"
    | "error_summary"
  > | null;
  sandboxContext?: SandboxCallContext | null;
  aiBillingSource?: string | null;
};

export type SandboxDebugPresenter = {
  computeBillingSource: SandboxBillingMode;
  computeBillingLabel: string;
  computeBillingBadgeLabel: string;
  aiBillingLabel: string | null;
  projectId: string | null;
  projectLabel: string;
  teamId: string | null;
  teamLabel: string;
  previewUrl: string | null;
  previewStatusLabel: string;
  runtimeStatusLabel: string;
  healthStatusLabel: string;
  sandboxRecordId: string | null;
  sandboxRuntimeId: string | null;
  currentError: string | null;
  currentErrorLabel: string;
  lastPreviewError: string | null;
  lastPreviewErrorLabel: string;
  lastBootError: string | null;
  lastBootErrorLabel: string;
  displayError: string | null;
  displayErrorLabel: string;
};

export function formatSandboxComputeBadgeLabel(
  source: SandboxBillingMode | null | undefined
) {
  return source === "user_vercel_project" ? "user billing" : "mogplex billing";
}

export function formatAiBillingLabel(source: string | null | undefined) {
  return typeof source === "string" && source.trim().length > 0
    ? source.replaceAll("_", " ")
    : null;
}

export function presentSandboxDebug({
  sandbox,
  sandboxContext,
  aiBillingSource,
}: SandboxDebugInput): SandboxDebugPresenter {
  const computeBillingSource =
    sandbox?.billing_summary.source ??
    sandboxContext?.compute_billing_source ??
    "platform";
  const projectId =
    sandbox?.billing_summary.project_id ??
    sandboxContext?.billing_project_id ??
    null;
  const teamId =
    sandbox?.billing_summary.team_id ?? sandboxContext?.billing_team_id ?? null;
  const previewUrl =
    sandbox?.runtime_summary.preview_url ?? sandboxContext?.preview_url ?? null;
  const previewStatus =
    sandbox?.runtime_summary.last_preview_http_status ?? null;
  const runtimeStatus = sandbox?.runtime_summary.status ?? "stopped";
  const healthStatus = sandbox?.runtime_summary.health_status ?? "unknown";
  const sandboxRecordId =
    sandbox?.id ?? sandboxContext?.sandbox_record_id ?? null;
  const sandboxRuntimeId =
    sandbox?.runtime_summary.sandbox_id ??
    sandbox?.sandbox_id ??
    sandboxContext?.sandbox_id ??
    null;
  const currentError = sandbox?.error_summary.current_error ?? null;
  const lastPreviewError = sandbox?.error_summary.last_preview_error ?? null;
  const lastBootError = sandbox?.error_summary.last_boot_error ?? null;
  const displayError =
    sandbox?.error_summary.display_error ??
    currentError ??
    lastPreviewError ??
    lastBootError ??
    null;

  return {
    computeBillingSource,
    computeBillingLabel: formatSandboxBillingLabel(computeBillingSource),
    computeBillingBadgeLabel:
      formatSandboxComputeBadgeLabel(computeBillingSource),
    aiBillingLabel: formatAiBillingLabel(aiBillingSource),
    projectId,
    projectLabel: projectId || "—",
    teamId,
    teamLabel: formatSandboxTeamLabel(teamId),
    previewUrl,
    previewStatusLabel: previewStatus ? `HTTP ${previewStatus}` : "n/a",
    runtimeStatusLabel: runtimeStatus,
    healthStatusLabel: String(healthStatus),
    sandboxRecordId,
    sandboxRuntimeId,
    currentError,
    currentErrorLabel: currentError || "None",
    lastPreviewError,
    lastPreviewErrorLabel: lastPreviewError || "None",
    lastBootError,
    lastBootErrorLabel: lastBootError || "None",
    displayError,
    displayErrorLabel: displayError || "None",
  };
}
