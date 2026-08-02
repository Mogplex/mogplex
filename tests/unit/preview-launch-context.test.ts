import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewPaneLaunchContext } from "../../lib/sandbox/preview-launch-context";
import type { Session } from "../../hooks/use-sessions";
import type { SandboxRecord } from "../../lib/types";

function buildSandboxRecord(
  overrides: Partial<SandboxRecord> = {}
): SandboxRecord {
  return {
    id: "sandbox-record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "sbx_123",
    base_branch: "main",
    working_branch: "feature/current",
    snapshot_id: null,
    stop_reason: "idle_timeout",
    install_log: "",
    dev_log: "",
    runtime: "node22",
    terminal_cwd: null,
    created_at: "2026-04-05T00:00:00.000Z",
    last_active_at: "2026-04-05T00:00:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Mogplex billing",
      project_id: "project-1",
      team_id: null,
      team_label: "Personal",
    },
    runtime_summary: {
      sandbox_id: "sbx_123",
      status: "stopped",
      health_status: "stopped",
      preview_url: null,
      last_health_check_at: "2026-04-05T00:00:00.000Z",
      last_preview_http_status: null,
      boot_attempts: 1,
      last_boot_started_at: "2026-04-05T00:00:00.000Z",
      last_boot_completed_at: "2026-04-05T00:00:10.000Z",
      vercel_diagnostics: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
    ...overrides,
  };
}

test("resolvePreviewPaneLaunchContext uses fallback record ids for stopped overlay restarts", () => {
  const result = resolvePreviewPaneLaunchContext({
    trigger: "status_overlay",
    record: buildSandboxRecord(),
    sandboxRecordId: undefined,
  });

  assert.equal(result.effectiveSandboxRecordId, "sandbox-record-1");
  assert.equal(result.overlayStatus, "stopped");
  assert.deepEqual(result.intent, {
    kind: "restart_on_branch",
    sandboxRecordId: "sandbox-record-1",
  });
  assert.equal(result.shouldReserveStoppedOverlayLaunchAttempt, true);
});

test("resolvePreviewPaneLaunchContext threads live probes into launch state", () => {
  const stoppedRecord = buildSandboxRecord();
  const result = resolvePreviewPaneLaunchContext({
    trigger: "status_overlay",
    record: buildSandboxRecord({
      stop_reason: null,
      runtime_summary: {
        ...stoppedRecord.runtime_summary,
        status: "running",
        health_status: "running",
        preview_url: "https://sandbox.example",
      },
    }),
    sandboxRecordId: undefined,
    liveProbe: "app_error",
  });

  assert.equal(result.overlayStatus, "app_error");
  assert.equal(result.state.kind, "degraded");
  assert.deepEqual(result.intent, {
    kind: "restart_on_branch",
    sandboxRecordId: "sandbox-record-1",
  });
  assert.equal(result.shouldReserveStoppedOverlayLaunchAttempt, false);
});

test("resolvePreviewPaneLaunchContext keeps empty states as fresh starts without a record", () => {
  const result = resolvePreviewPaneLaunchContext({
    trigger: "empty_state",
    record: null,
    sandboxRecordId: undefined,
  });

  assert.equal(result.effectiveSandboxRecordId, null);
  assert.deepEqual(result.intent, { kind: "start_fresh" });
  assert.equal(result.shouldReserveStoppedOverlayLaunchAttempt, false);
});

test("resolvePreviewPaneLaunchContext preserves session state without a record", () => {
  const session: Session = {
    id: "session-1",
    index: 1,
    name: "Session 1",
    color: "green",
    paneTree: {
      id: "p-home",
      type: "home",
      name: "Workspace Guide",
      lines: [],
      status: "idle",
    },
    activeId: "p-home",
    activeSandboxId: "sandbox-previous",
    pendingSandboxBranch: "feature/current",
  };
  const result = resolvePreviewPaneLaunchContext({
    trigger: "empty_state",
    session,
    record: null,
    sandboxRecordId: undefined,
  });

  assert.equal(result.effectiveSandboxRecordId, null);
  assert.deepEqual(result.state, {
    kind: "no_sandbox",
    branch: "feature/current",
    lastSandboxId: "sandbox-previous",
  });
  assert.deepEqual(result.intent, { kind: "start_fresh" });
  assert.equal(result.shouldReserveStoppedOverlayLaunchAttempt, false);
});

test("resolvePreviewPaneLaunchContext reserves attempt ids for empty-state stopped records", () => {
  const result = resolvePreviewPaneLaunchContext({
    trigger: "empty_state",
    record: buildSandboxRecord(),
    sandboxRecordId: undefined,
  });

  assert.equal(result.effectiveSandboxRecordId, "sandbox-record-1");
  assert.deepEqual(result.intent, {
    kind: "restart_on_branch",
    sandboxRecordId: "sandbox-record-1",
  });
  assert.equal(result.shouldReserveStoppedOverlayLaunchAttempt, true);
});
