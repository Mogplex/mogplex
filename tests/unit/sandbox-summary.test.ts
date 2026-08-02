import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxSummary() {
  return import("../../lib/sandbox/summary");
}

test("withSandboxSummaryFields normalizes user-billed sandbox details", async () => {
  const { withSandboxSummaryFields } = await loadSandboxSummary();

  const record = withSandboxSummaryFields({
    sandbox_id: "sandbox-runtime-1",
    status: "running",
    health_status: "running",
    preview_url: "https://preview.example.com",
    last_health_check_at: "2026-04-01T12:00:00.000Z",
    last_preview_http_status: 200,
    boot_attempts: 3,
    last_boot_started_at: "2026-04-01T11:58:00.000Z",
    last_boot_completed_at: "2026-04-01T11:59:00.000Z",
    billing_source: "user_vercel_project",
    billing_team_id: "team-acme",
    billing_project_id: "proj_123",
    error: null,
    last_preview_error: null,
    last_boot_error: null,
  });

  assert.deepEqual(record.billing_summary, {
    source: "user_vercel_project",
    label: "Your Vercel project",
    project_id: "proj_123",
    team_id: "team-acme",
    team_label: "team-acme",
  });
  assert.deepEqual(record.runtime_summary, {
    sandbox_id: "sandbox-runtime-1",
    status: "running",
    health_status: "running",
    preview_url: "https://preview.example.com",
    last_health_check_at: "2026-04-01T12:00:00.000Z",
    last_preview_http_status: 200,
    boot_attempts: 3,
    last_boot_started_at: "2026-04-01T11:58:00.000Z",
    last_boot_completed_at: "2026-04-01T11:59:00.000Z",
  });
  assert.deepEqual(record.error_summary, {
    current_error: null,
    last_preview_error: null,
    last_boot_error: null,
    display_error: null,
    has_errors: false,
  });
});

test("withSandboxSummaryFields exposes effective_timeout_ms when provided", async () => {
  const { withSandboxSummaryFields } = await loadSandboxSummary();

  const record = withSandboxSummaryFields({
    sandbox_id: "sandbox-runtime-timeout",
    status: "running",
    health_status: "running",
    preview_url: null,
    last_health_check_at: null,
    last_preview_http_status: null,
    boot_attempts: null,
    last_boot_started_at: null,
    last_boot_completed_at: null,
    billing_source: "platform",
    billing_team_id: null,
    billing_project_id: null,
    error: null,
    last_preview_error: null,
    last_boot_error: null,
    effective_timeout_ms: 5 * 60 * 60 * 1000,
  });

  assert.equal(record.runtime_summary.effective_timeout_ms, 5 * 60 * 60 * 1000);
});

test("withSandboxSummaryFields omits effective_timeout_ms when source is missing", async () => {
  const { withSandboxSummaryFields } = await loadSandboxSummary();

  const record = withSandboxSummaryFields({
    sandbox_id: "sandbox-runtime-no-timeout",
    status: "running",
    health_status: "running",
    preview_url: null,
    last_health_check_at: null,
    last_preview_http_status: null,
    boot_attempts: null,
    last_boot_started_at: null,
    last_boot_completed_at: null,
    billing_source: "platform",
    billing_team_id: null,
    billing_project_id: null,
    error: null,
    last_preview_error: null,
    last_boot_error: null,
  });

  assert.equal(record.runtime_summary.effective_timeout_ms, undefined);
});

test("withSandboxSummaryFields falls back to stored Vercel fields and personal scope", async () => {
  const { withSandboxSummaryFields } = await loadSandboxSummary();

  const record = withSandboxSummaryFields({
    sandbox_id: "sandbox-runtime-2",
    status: null,
    health_status: null,
    preview_url: null,
    last_health_check_at: null,
    last_preview_http_status: null,
    boot_attempts: null,
    last_boot_started_at: null,
    last_boot_completed_at: null,
    billing_source: null,
    billing_team_id: null,
    billing_project_id: null,
    vercel_team_id: null,
    vercel_project_id: "fallback-project",
    error: "Launch failed",
    last_preview_error: null,
    last_boot_error: "Missing package manager",
  });

  assert.deepEqual(record.billing_summary, {
    source: "platform",
    label: "Mogplex billing",
    project_id: "fallback-project",
    team_id: null,
    team_label: "Personal",
  });
  assert.deepEqual(record.runtime_summary, {
    sandbox_id: "sandbox-runtime-2",
    status: "stopped",
    health_status: "unknown",
    preview_url: null,
    last_health_check_at: null,
    last_preview_http_status: null,
    boot_attempts: 0,
    last_boot_started_at: null,
    last_boot_completed_at: null,
  });
  assert.deepEqual(record.error_summary, {
    current_error: "Launch failed",
    last_preview_error: null,
    last_boot_error: "Missing package manager",
    display_error: "Launch failed",
    has_errors: true,
  });
});

test("withSandboxSummaryFields carries Vercel diagnostics through runtime summaries", async () => {
  const { withSandboxSummaryFields } = await loadSandboxSummary();

  const record = withSandboxSummaryFields({
    sandbox_id: "sandbox-runtime-3",
    status: "running",
    health_status: "app_error",
    preview_url: "https://preview.example.com",
    last_health_check_at: "2026-04-01T12:00:00.000Z",
    last_preview_http_status: 503,
    boot_attempts: 1,
    last_boot_started_at: null,
    last_boot_completed_at: null,
    billing_source: "platform",
    billing_team_id: "team-acme",
    billing_project_id: "proj_123",
    error: null,
    last_preview_error: null,
    last_boot_error: null,
    vercel_diagnostics: {
      state: "build_failed",
      deploymentId: "dpl_123",
      deploymentUrl: "https://preview.example.com",
      deploymentStatus: "ERROR",
      buildSummary: "Build failed: Missing NEXT_PUBLIC_API_URL",
      detectedAt: "2026-04-01T12:05:00.000Z",
    },
  });

  assert.equal(
    record.runtime_summary.vercel_diagnostics?.state,
    "build_failed"
  );
  assert.equal(
    record.error_summary.display_error,
    "Build failed: Missing NEXT_PUBLIC_API_URL"
  );
  assert.equal(record.error_summary.has_errors, true);
});
