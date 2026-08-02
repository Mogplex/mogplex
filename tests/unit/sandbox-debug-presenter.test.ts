import assert from "node:assert/strict";
import test from "node:test";
import { presentSandboxDebug } from "../../lib/sandbox/debug-presenter";
import type { SandboxRecord } from "../../lib/types";

function buildSandboxRecord(
  overrides: Partial<SandboxRecord> = {}
): SandboxRecord {
  return {
    id: "sandbox-record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "sandbox-runtime-1",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: null,
    stop_reason: overrides.stop_reason ?? null,
    install_log: null,
    dev_log: null,
    runtime: null,
    terminal_cwd: null,
    created_at: "2026-04-01T00:00:00.000Z",
    last_active_at: "2026-04-01T00:05:00.000Z",
    billing_summary: {
      source: "user_vercel_project",
      label: "Your Vercel project",
      project_id: "proj_user_123",
      team_id: "team-acme",
      team_label: "team-acme",
    },
    runtime_summary: {
      sandbox_id: "sandbox-runtime-1",
      status: "running",
      health_status: "app_error",
      preview_url: "https://preview.example.com",
      last_health_check_at: null,
      last_preview_http_status: 500,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: "HTTP 500 at preview",
      last_boot_error: null,
      display_error: "HTTP 500 at preview",
      has_errors: true,
    },
    ...overrides,
  };
}

test("presentSandboxDebug formats summary-backed sandbox records consistently", () => {
  const presenter = presentSandboxDebug({
    sandbox: buildSandboxRecord(),
    aiBillingSource: "user_ai_gateway",
  });

  assert.equal(presenter.computeBillingLabel, "Your Vercel project");
  assert.equal(presenter.computeBillingBadgeLabel, "user billing");
  assert.equal(presenter.aiBillingLabel, "user ai gateway");
  assert.equal(presenter.projectLabel, "proj_user_123");
  assert.equal(presenter.teamLabel, "team-acme");
  assert.equal(presenter.previewStatusLabel, "HTTP 500");
  assert.equal(presenter.runtimeStatusLabel, "running");
  assert.equal(presenter.healthStatusLabel, "app_error");
  assert.equal(presenter.sandboxRecordId, "sandbox-record-1");
  assert.equal(presenter.sandboxRuntimeId, "sandbox-runtime-1");
  assert.equal(presenter.displayErrorLabel, "HTTP 500 at preview");
  assert.equal(presenter.lastPreviewErrorLabel, "HTTP 500 at preview");
  assert.equal(presenter.lastBootErrorLabel, "None");
});

test("presentSandboxDebug formats sandbox call context and personal fallback", () => {
  const presenter = presentSandboxDebug({
    sandboxContext: {
      sandbox_record_id: "sandbox-record-2",
      sandbox_id: "sandbox-runtime-2",
      compute_billing_source: "platform",
      billing_project_id: null,
      billing_team_id: null,
      preview_url: "https://preview.example.com/runtime",
    },
    aiBillingSource: "platform_ai_gateway",
  });

  assert.equal(presenter.computeBillingLabel, "Mogplex billing");
  assert.equal(presenter.computeBillingBadgeLabel, "mogplex billing");
  assert.equal(presenter.aiBillingLabel, "platform ai gateway");
  assert.equal(presenter.projectLabel, "—");
  assert.equal(presenter.teamLabel, "Personal");
  assert.equal(presenter.previewUrl, "https://preview.example.com/runtime");
  assert.equal(presenter.previewStatusLabel, "n/a");
  assert.equal(presenter.sandboxRecordId, "sandbox-record-2");
  assert.equal(presenter.sandboxRuntimeId, "sandbox-runtime-2");
  assert.equal(presenter.displayErrorLabel, "None");
});
