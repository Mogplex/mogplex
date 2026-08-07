/**
 * Helper functions for sandbox readiness reconciliation.
 * Status detection, record transformation, and preview URL recovery.
 */

import {
  normalizeDevPort,
  resolveConfiguredDevPort,
} from "@/lib/repo-settings";
import { getStrategy } from "@/lib/sandbox/runtimes";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";
import type { SandboxRecordRow } from "@/lib/types";
import type { VercelAuthMode } from "@/lib/vercel/service";

export const ACTIVE_RECONCILE_STATUSES = [
  "creating",
  "installing",
  "running",
] as const;

export const TRANSIENT_HEALTH_STATUSES = new Set(["starting", "not_available"]);

// Per-launch path snapshot — preferred over repo.root_directory when
// resolving paths inside the sandbox (e.g. .mogplex/dev.log reads).
export const SANDBOX_RECONCILE_SELECT = [
  "id",
  "user_id",
  "product_team_id",
  "repo_id",
  "sandbox_id",
  "base_branch",
  "working_branch",
  "snapshot_id",
  "install_log",
  "dev_log",
  "runtime",
  "terminal_cwd",
  "root_directory",
  "status",
  "stop_reason",
  "preview_url",
  "health_status",
  "last_health_check_at",
  "last_active_at",
  "last_preview_http_status",
  "last_preview_error",
  "last_boot_error",
  "boot_attempts",
  "last_boot_started_at",
  "last_boot_completed_at",
  "billing_source",
  "billing_team_id",
  "billing_project_id",
  "vercel_team_id",
  "vercel_project_id",
  "error",
  "created_at",
  "repo:repos(root_directory, dev_port, dev_port_auto)",
].join(", ");

export type SandboxReconcileRecord = SandboxRecordRow & {
  repo?:
    | {
        root_directory?: string | null;
        dev_port?: number | null;
        dev_port_auto?: unknown;
      }
    | {
        root_directory?: string | null;
        dev_port?: number | null;
        dev_port_auto?: unknown;
      }[]
    | null;
};

export function toRepo(record: SandboxReconcileRecord) {
  return Array.isArray(record.repo) ? record.repo[0] : record.repo;
}

export function isSettledSandbox(record: SandboxReconcileRecord) {
  if (record.status === "stopped" || record.status === "error") return true;
  return !TRANSIENT_HEALTH_STATUSES.has(
    record.health_status ?? "not_available"
  );
}

export function normalizeRecordedLiveSandboxStatus(
  status: string
): "running" | "pending" | "stopped" {
  if (status === "running") return "running";
  if (status === "creating" || status === "installing") return "pending";
  return "stopped";
}

export function shouldClearBootError(status: string, healthStatus: string) {
  return status === "running" && !TRANSIENT_HEALTH_STATUSES.has(healthStatus);
}

export function recoverPreviewUrlFromLiveSandbox(
  record: SandboxReconcileRecord,
  sandbox: { domain?: (port: number) => string }
) {
  if (record.preview_url) return record.preview_url;
  if (typeof sandbox.domain !== "function") return null;

  const repo = toRepo(record);
  const configuredPort = resolveConfiguredDevPort(
    repo?.dev_port,
    repo?.dev_port_auto
  );
  const strategy = getStrategy(record.runtime as SandboxRuntime | null);
  const port = normalizeDevPort(configuredPort ?? strategy.defaultPort);
  return sandbox.domain(port);
}

export function shouldLoadProjectVercelDiagnostics(input: {
  includeDiagnostics?: boolean;
  recordStatus: string;
  previewUrl: string | null;
  previewHealthStatus: string;
}) {
  if (!input.includeDiagnostics) return false;
  if (!input.previewUrl) return false;
  if (
    input.previewHealthStatus === "running" ||
    input.previewHealthStatus === "idle_warning"
  ) {
    return false;
  }
  if (
    input.recordStatus === "creating" ||
    input.recordStatus === "installing" ||
    TRANSIENT_HEALTH_STATUSES.has(input.previewHealthStatus)
  ) {
    return false;
  }
  return true;
}

export function getAuthModeFromBillingSource(
  source?: string | null
): VercelAuthMode {
  return source === "user_vercel_project" ? "personal" : "platform";
}

export function buildClientRecord(
  record: SandboxReconcileRecord,
  diagnostics?: Awaited<ReturnType<typeof loadSandboxVercelDiagnostics>> | null
) {
  return toSandboxClientRecord({
    ...record,
    ...(diagnostics ? { vercel_diagnostics: diagnostics } : {}),
  });
}
