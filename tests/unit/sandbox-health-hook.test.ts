import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxHealthHook() {
  return import("../../hooks/use-sandbox-health");
}

test("deriveSandboxHealthStatus reads runtime_summary directly", async () => {
  const { deriveSandboxHealthStatus } = await loadSandboxHealthHook();

  const status = deriveSandboxHealthStatus({
    runtime_summary: {
      sandbox_id: "sandbox-1",
      status: "stopped",
      health_status: "stopped",
      preview_url: null,
      last_health_check_at: null,
      last_preview_http_status: null,
      boot_attempts: 0,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
  });

  assert.equal(status, "stopped");
});

test("deriveSandboxHealthStatus returns not_available when summaries are absent", async () => {
  const { deriveSandboxHealthStatus } = await loadSandboxHealthHook();

  const status = deriveSandboxHealthStatus(null);

  assert.equal(status, "not_available");
});

test("deriveSandboxHealthStatus keeps idle warnings distinct", async () => {
  const { deriveSandboxHealthStatus } = await loadSandboxHealthHook();

  const status = deriveSandboxHealthStatus({
    runtime_summary: {
      sandbox_id: "sandbox-1",
      status: "running",
      health_status: "idle_warning",
      preview_url: null,
      last_health_check_at: null,
      last_preview_http_status: 200,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
  });

  assert.equal(status, "idle_warning");
});
