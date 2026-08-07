import type { SandboxRecord } from "@/lib/types";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";

export async function loadSandboxStore() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../hooks/use-sandbox");
}

export type SandboxRecordBuildOverrides = Partial<SandboxRecord> & {
  status?: SandboxRecord["runtime_summary"]["status"];
  health_status?: SandboxHealthStatus | null;
  preview_url?: string | null;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  boot_attempts?: number;
  error?: string | null;
  billing_source?: SandboxBillingMode | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
};

export function buildSandboxRecord(
  overrides: SandboxRecordBuildOverrides = {}
): SandboxRecord {
  const status =
    overrides.status ?? overrides.runtime_summary?.status ?? "creating";
  const healthStatus =
    overrides.health_status ??
    overrides.runtime_summary?.health_status ??
    "starting";
  const previewUrl =
    overrides.preview_url ?? overrides.runtime_summary?.preview_url ?? null;
  const lastPreviewError =
    overrides.last_preview_error ??
    overrides.error_summary?.last_preview_error ??
    null;
  const lastBootError =
    overrides.last_boot_error ??
    overrides.error_summary?.last_boot_error ??
    null;
  const currentError =
    overrides.error ?? overrides.error_summary?.current_error ?? null;
  const lastHealthCheckAt =
    overrides.last_health_check_at ??
    overrides.runtime_summary?.last_health_check_at ??
    null;
  const lastPreviewHttpStatus =
    overrides.last_preview_http_status ??
    overrides.runtime_summary?.last_preview_http_status ??
    null;
  const bootAttempts =
    overrides.boot_attempts ?? overrides.runtime_summary?.boot_attempts ?? 1;
  const lastBootStartedAt =
    overrides.last_boot_started_at ??
    overrides.runtime_summary?.last_boot_started_at ??
    null;
  const lastBootCompletedAt =
    overrides.last_boot_completed_at ??
    overrides.runtime_summary?.last_boot_completed_at ??
    null;
  const billingSource =
    overrides.billing_source ?? overrides.billing_summary?.source ?? "platform";
  const billingTeamId =
    overrides.billing_team_id ?? overrides.billing_summary?.team_id ?? null;
  const billingProjectId =
    overrides.billing_project_id ??
    overrides.billing_summary?.project_id ??
    "project-1";

  return {
    id: overrides.id ?? "sandbox-1",
    user_id: overrides.user_id ?? "user-1",
    repo_id: overrides.repo_id ?? "repo-1",
    sandbox_id: overrides.sandbox_id ?? "pending",
    base_branch: overrides.base_branch ?? "main",
    working_branch: overrides.working_branch ?? overrides.base_branch ?? "main",
    snapshot_id: overrides.snapshot_id ?? null,
    stop_reason: overrides.stop_reason ?? null,
    install_log: overrides.install_log ?? null,
    dev_log: overrides.dev_log ?? null,
    runtime: overrides.runtime ?? "node22",
    terminal_cwd: overrides.terminal_cwd ?? null,
    // root_directory has three-way semantics on SandboxRecord (undefined =
    // "use repo default", null = "explicit repo root", string = subpath).
    // Default to null so launchKey round-trips render the "n" sentinel
    // instead of falling back to "u".
    root_directory:
      overrides.root_directory === undefined ? null : overrides.root_directory,
    created_at: overrides.created_at ?? "2026-04-01T10:00:00.000Z",
    last_active_at: overrides.last_active_at ?? "2026-04-01T10:00:00.000Z",
    billing_summary: overrides.billing_summary ?? {
      source: billingSource,
      label:
        billingSource === "user_vercel_project"
          ? "Your Vercel project"
          : "Mogplex billing",
      project_id: billingProjectId,
      team_id: billingTeamId,
      team_label: billingTeamId ?? "Personal",
    },
    runtime_summary: overrides.runtime_summary ?? {
      sandbox_id: overrides.sandbox_id ?? "pending",
      status,
      health_status: healthStatus,
      preview_url: previewUrl,
      last_health_check_at: lastHealthCheckAt,
      last_preview_http_status: lastPreviewHttpStatus,
      boot_attempts: bootAttempts,
      last_boot_started_at: lastBootStartedAt,
      last_boot_completed_at: lastBootCompletedAt,
    },
    error_summary: overrides.error_summary ?? {
      current_error: currentError,
      last_preview_error: lastPreviewError,
      last_boot_error: lastBootError,
      display_error: currentError ?? lastPreviewError ?? lastBootError,
      has_errors: Boolean(currentError ?? lastPreviewError ?? lastBootError),
    },
  };
}

export function buildSseResponse(events: unknown[]) {
  const body = events
    .flatMap((event) => [`data: ${JSON.stringify(event)}`, ""])
    .join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

export function createStoreHarness(repoId: string) {
  let state = {
    sandboxes: {} as Record<string, SandboxRecord>,
    sandboxesById: {} as Record<string, SandboxRecord>,
    activeSandboxId: null as string | null,
    creating: new Set<string>([repoId]),
    errors: {} as Record<
      string,
      { message: string; code: string; launchAttemptId?: string }
    >,
    logs: {} as Record<string, string>,
    setSandboxRecord(record: SandboxRecord) {
      state = {
        ...state,
        sandboxes: {
          ...state.sandboxes,
          [record.repo_id]: record,
        },
        sandboxesById: {
          ...state.sandboxesById,
          [record.id]: record,
        },
        activeSandboxId: record.id,
      };
    },
    appendLog(targetRepoId: string, text: string) {
      state = {
        ...state,
        logs: {
          ...state.logs,
          [targetRepoId]: (state.logs[targetRepoId] || "") + text,
        },
      };
    },
  };

  const set = (
    partial:
      | Record<string, unknown>
      | ((current: typeof state) => Record<string, unknown>)
  ) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = {
      ...state,
      ...next,
    };
  };

  return {
    set,
    get: () => state,
  };
}
