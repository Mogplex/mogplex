import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";

export type SandboxBillingSummary = {
  source: "platform" | "user_vercel_project";
  label: string;
  project_id: string | null;
  team_id: string | null;
  team_label: string;
};

export type SandboxFixture = {
  id: string;
  sandbox_id: string;
  repo_id: string;
  billing_source?: "platform" | "user_vercel_project" | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  status: string;
  created_at: string;
  last_active_at: string;
  preview_url: string | null;
  health_status: string;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  billing_summary?: SandboxBillingSummary;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
  runtime_summary?: ReturnType<typeof buildSandboxSummaries>["runtime_summary"];
  error_summary?: ReturnType<typeof buildSandboxSummaries>["error_summary"];
};

export type ObservabilityCallFixture = {
  id: string;
  user_id: string;
  type: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  reasoning_tokens: number | null;
  gateway_generation_id: string | null;
  cost_source: "trigger" | "gateway" | "manual" | null;
  total_tokens: number;
  duration_ms: number;
  cost_usd?: number | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  error: string | null;
  conversation_id: string | null;
  job_run_id: string | null;
  repo_id: string;
  limit_claim_id: string | null;
  cancel_requested_at: string | null;
  control_state: string;
  runtime_command_id: string | null;
  tool_calls_count: number;
  tool_calls: unknown[];
  metadata: Record<string, unknown>;
  sandbox_context: {
    sandbox_record_id: string;
    sandbox_id: string;
    compute_billing_source: "platform" | "user_vercel_project";
    billing_project_id: string | null;
    billing_team_id: string | null;
    preview_url: string | null;
  } | null;
};

export function buildSandboxSummaries(record: {
  sandbox_id: string;
  status: string;
  preview_url: string | null;
  health_status: string;
  billing_source?: "platform" | "user_vercel_project" | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  persistent?: boolean | null;
  effective_timeout_ms?: number | null;
  billing_summary?: SandboxBillingSummary;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
}): {
  billing_summary: SandboxBillingSummary;
  runtime_summary: {
    sandbox_id: string;
    status: string;
    health_status: string;
    preview_url: string | null;
    last_health_check_at: string | null;
    last_preview_http_status: number | null;
    boot_attempts: number;
    last_boot_started_at: string | null;
    last_boot_completed_at: string | null;
    persistent?: boolean | null;
    effective_timeout_ms?: number | null;
    vercel_diagnostics?: SandboxVercelDiagnostics | null;
  };
  error_summary: {
    current_error: string | null;
    last_preview_error: string | null;
    last_boot_error: string | null;
    display_error: string | null;
    has_errors: boolean;
  };
} {
  const billingSource =
    record.billing_source === "user_vercel_project"
      ? "user_vercel_project"
      : "platform";
  const billingTeamId = record.billing_team_id ?? record.vercel_team_id ?? null;
  const billingProjectId =
    record.billing_project_id ?? record.vercel_project_id ?? null;

  return {
    billing_summary: record.billing_summary ?? {
      source: billingSource,
      label:
        billingSource === "user_vercel_project"
          ? "Your Vercel project"
          : "Mogplex billing",
      project_id: billingProjectId,
      team_id: billingTeamId,
      team_label: billingTeamId || "Personal",
    },
    runtime_summary: {
      sandbox_id: record.sandbox_id,
      status: record.status,
      health_status: record.health_status,
      preview_url: record.preview_url,
      last_health_check_at: null,
      last_preview_http_status: record.last_preview_http_status ?? null,
      boot_attempts: record.boot_attempts ?? 0,
      last_boot_started_at: null,
      last_boot_completed_at: null,
      ...(typeof record.persistent === "boolean"
        ? { persistent: record.persistent }
        : {}),
      ...(typeof record.effective_timeout_ms === "number"
        ? { effective_timeout_ms: record.effective_timeout_ms }
        : {}),
      ...(record.vercel_diagnostics === undefined
        ? {}
        : { vercel_diagnostics: record.vercel_diagnostics }),
    },
    error_summary: {
      current_error: null,
      last_preview_error: record.last_preview_error ?? null,
      last_boot_error: record.last_boot_error ?? null,
      display_error:
        record.last_preview_error ??
        record.last_boot_error ??
        record.vercel_diagnostics?.buildSummary ??
        null,
      has_errors: Boolean(
        record.last_preview_error ||
        record.last_boot_error ||
        record.vercel_diagnostics?.buildSummary
      ),
    },
  };
}

export function buildSandboxFixture(args: {
  repoId: string;
  sandboxRecordId?: string;
  sandboxId?: string;
  billingSource?: "platform" | "user_vercel_project" | null;
  billingTeamId?: string | null;
  billingProjectId?: string | null;
  vercelTeamId?: string | null;
  vercelProjectId?: string | null;
  status?: string;
  previewUrl?: string | null;
  healthStatus?: string;
  createdAt?: string;
  lastActiveAt?: string;
  lastPreviewHttpStatus?: number | null;
  lastPreviewError?: string | null;
  lastBootError?: string | null;
  bootAttempts?: number;
  billingSummary?: SandboxBillingSummary;
  vercelDiagnostics?: SandboxVercelDiagnostics | null;
}): SandboxFixture {
  const sandbox: SandboxFixture = {
    id: args.sandboxRecordId ?? `sandbox-record-${args.repoId}`,
    sandbox_id: args.sandboxId ?? `sandbox-runtime-${args.repoId}`,
    repo_id: args.repoId,
    billing_source: args.billingSource,
    billing_team_id: args.billingTeamId,
    billing_project_id: args.billingProjectId,
    vercel_team_id: args.vercelTeamId,
    vercel_project_id: args.vercelProjectId,
    status: args.status ?? "running",
    created_at: args.createdAt ?? new Date().toISOString(),
    last_active_at: args.lastActiveAt ?? new Date().toISOString(),
    preview_url:
      args.previewUrl ?? `http://127.0.0.1:3000/__e2e/preview/${args.repoId}`,
    health_status: args.healthStatus ?? "running",
    last_preview_http_status: args.lastPreviewHttpStatus ?? 200,
    last_preview_error: args.lastPreviewError ?? null,
    last_boot_error: args.lastBootError ?? null,
    boot_attempts: args.bootAttempts ?? 1,
    billing_summary: args.billingSummary,
    vercel_diagnostics: args.vercelDiagnostics,
  };

  return {
    ...sandbox,
    ...buildSandboxSummaries(sandbox),
  };
}

export function buildObservabilitySummary(calls: ObservabilityCallFixture[]) {
  const totalCalls = calls.length;
  const totalTokens = calls.reduce((sum, call) => sum + call.total_tokens, 0);
  const durationTotal = calls.reduce((sum, call) => sum + call.duration_ms, 0);
  const totalCost = calls.reduce((sum, call) => {
    if (typeof call.cost_usd === "number") {
      return sum + call.cost_usd;
    }
    return sum;
  }, 0);

  return {
    summary: {
      total_calls: totalCalls,
      total_tokens: totalTokens,
      total_cost: Math.round(totalCost * 100) / 100,
      cost_today: Math.round(totalCost * 100) / 100,
      reconciliation_pending: 0,
      avg_duration_ms:
        totalCalls > 0 ? Math.round(durationTotal / totalCalls) : 0,
      success_rate: totalCalls > 0 ? 100 : 0,
      calls_today: totalCalls,
      tokens_today: totalTokens,
      sandbox_time_ms: 600000,
      sandbox_active: calls.filter((call) => call.sandbox_context).length,
      sandbox_total: calls.filter((call) => call.sandbox_context).length,
      job_runs_total: 0,
      job_runs_running: 0,
      job_runs_pending: 0,
      job_runs_stale_pending: 0,
      job_runs_failed_in_range: 0,
      job_runs_repaired_in_range: 0,
      job_runs_success_rate_in_range: 100,
      suppressed_in_range: 0,
      deferred_in_range: 0,
      start_failed_in_range: 0,
      limit_allowed_in_range: 0,
      limit_denied_in_range: 0,
      oldest_pending_age_ms: 0,
    },
    by_model: [],
    by_type: [],
  };
}

export function buildSandboxBackedCall(args: {
  repoId: string;
  sandboxRecordId: string;
  sandboxId: string;
  previewUrl: string | null;
  computeBillingSource: "platform" | "user_vercel_project";
  billingProjectId: string | null;
  billingTeamId: string | null;
  aiBillingSource: string;
  callId?: string;
  userId?: string;
  model?: string;
}): ObservabilityCallFixture {
  return {
    id: args.callId ?? "call-1",
    user_id: args.userId ?? "user-1",
    type: "chat",
    model: args.model ?? "minimax/minimax-m2.5",
    input_tokens: 120,
    output_tokens: 80,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    reasoning_tokens: null,
    gateway_generation_id: null,
    cost_source: "trigger",
    total_tokens: 200,
    duration_ms: 1500,
    cost_usd: 0.00156,
    started_at: "2026-04-01T14:00:00.000Z",
    completed_at: null,
    status: "streaming",
    error: null,
    conversation_id: "conversation-1",
    job_run_id: null,
    repo_id: args.repoId,
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: "runtime-command-1",
    tool_calls_count: 0,
    tool_calls: [],
    metadata: {
      ai_billing_source: args.aiBillingSource,
      sandbox_record_id: args.sandboxRecordId,
    },
    sandbox_context: {
      sandbox_record_id: args.sandboxRecordId,
      sandbox_id: args.sandboxId,
      compute_billing_source: args.computeBillingSource,
      billing_project_id: args.billingProjectId,
      billing_team_id: args.billingTeamId,
      preview_url: args.previewUrl,
    },
  };
}
