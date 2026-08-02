import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxClientRecord() {
  return import("../../lib/sandbox/client-record");
}

test("mergeSandboxRecord keeps summaries in sync after partial status updates", async () => {
  const { mergeSandboxRecord } = await loadSandboxClientRecord();

  const merged = mergeSandboxRecord(
    {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "feature/docs-refresh",
      snapshot_id: null,
      stop_reason: null,
      install_log: null,
      dev_log: null,
      runtime: "node22",
      terminal_cwd: null,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:05:00.000Z",
      billing_summary: {
        source: "platform",
        label: "Mogplex billing",
        project_id: null,
        team_id: null,
        team_label: "Personal",
      },
      runtime_summary: {
        sandbox_id: "vm_123",
        status: "running",
        health_status: "running",
        preview_url: "https://preview.example.com",
        last_health_check_at: null,
        last_preview_http_status: 200,
        boot_attempts: 1,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
      error_summary: {
        current_error: null,
        last_preview_error: null,
        last_boot_error: null,
        display_error: null,
        has_errors: false,
      },
    },
    {
      id: "sandbox-1",
      status: "stopped",
      health_status: "stopped",
    },
    "repo-1"
  );

  assert.equal(merged.runtime_summary.status, "stopped");
  assert.equal(merged.runtime_summary.health_status, "stopped");
  assert.equal(
    merged.runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal(merged.base_branch, "main");
  assert.equal(merged.working_branch, "feature/docs-refresh");
});

test("mergeSandboxRecord clears preview_url when incoming patch explicitly sets null", async () => {
  const { mergeSandboxRecord } = await loadSandboxClientRecord();

  const merged = mergeSandboxRecord(
    {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "main",
      snapshot_id: null,
      stop_reason: null,
      install_log: null,
      dev_log: null,
      runtime: "node22",
      terminal_cwd: null,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:05:00.000Z",
      billing_summary: {
        source: "platform",
        label: "Mogplex billing",
        project_id: null,
        team_id: null,
        team_label: "Personal",
      },
      runtime_summary: {
        sandbox_id: "vm_123",
        status: "running",
        health_status: "running",
        preview_url: "https://old-preview.example.com",
        last_health_check_at: null,
        last_preview_http_status: 200,
        boot_attempts: 1,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
      error_summary: {
        current_error: null,
        last_preview_error: null,
        last_boot_error: null,
        display_error: null,
        has_errors: false,
      },
    },
    { id: "sandbox-1", preview_url: null },
    "repo-1"
  );

  assert.equal(
    merged.runtime_summary.preview_url,
    null,
    "explicit null in patch should clear preview_url"
  );
});

test("mergeSandboxRecord preserves preview_url when incoming patch omits the field", async () => {
  const { mergeSandboxRecord } = await loadSandboxClientRecord();

  const merged = mergeSandboxRecord(
    {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "main",
      snapshot_id: null,
      stop_reason: null,
      install_log: null,
      dev_log: null,
      runtime: "node22",
      terminal_cwd: null,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:05:00.000Z",
      billing_summary: {
        source: "platform",
        label: "Mogplex billing",
        project_id: null,
        team_id: null,
        team_label: "Personal",
      },
      runtime_summary: {
        sandbox_id: "vm_123",
        status: "running",
        health_status: "running",
        preview_url: "https://keep-this.example.com",
        last_health_check_at: null,
        last_preview_http_status: 200,
        boot_attempts: 1,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
      error_summary: {
        current_error: null,
        last_preview_error: null,
        last_boot_error: null,
        display_error: null,
        has_errors: false,
      },
    },
    { id: "sandbox-1", status: "stopped" },
    "repo-1"
  );

  assert.equal(
    merged.runtime_summary.preview_url,
    "https://keep-this.example.com",
    "omitted preview_url should preserve existing value"
  );
});

test("mergeSandboxRecord builds summary-backed placeholder records for sandbox_created events", async () => {
  const { mergeSandboxRecord } = await loadSandboxClientRecord();

  const merged = mergeSandboxRecord(
    undefined,
    {
      id: "sandbox-1",
      repo_id: "repo-1",
      sandbox_id: "pending",
      base_branch: "main",
      working_branch: "main",
      status: "installing",
      health_status: "starting",
    },
    "repo-1"
  );

  assert.equal(merged.runtime_summary.status, "installing");
  assert.equal(merged.runtime_summary.health_status, "starting");
  assert.equal(merged.error_summary.display_error, null);
  assert.equal(merged.base_branch, "main");
  assert.equal(merged.working_branch, "main");
});
