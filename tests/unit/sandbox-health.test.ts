import assert from "node:assert/strict";
import test from "node:test";
import { deriveSandboxHealthStatus } from "../../hooks/use-sandbox-health";

test("treats creating and installing sandboxes as starting", () => {
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "creating",
        health_status: "starting",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "starting"
  );
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "installing",
        health_status: "running",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "starting"
  );
});

test("surfaces idle warning as its own preview state", () => {
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "running",
        health_status: "idle_warning",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "idle_warning"
  );
});

test("surfaces pausing as its own transient state", () => {
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "pausing",
        health_status: "running",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "pausing"
  );
});

test("maps terminal sandbox records directly", () => {
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "stopped",
        health_status: "running",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "stopped"
  );
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "error",
        health_status: "running",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "error"
  );
});

test("falls back to not_available when no record exists", () => {
  assert.equal(deriveSandboxHealthStatus(null), "not_available");
});

test("prefers degraded preview health when available", () => {
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "running",
        health_status: "app_error",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "app_error"
  );
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "running",
        health_status: "unreachable",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "unreachable"
  );
  assert.equal(
    deriveSandboxHealthStatus({
      runtime_summary: {
        sandbox_id: "sandbox-1",
        status: "error",
        health_status: "app_error",
        preview_url: null,
        last_health_check_at: null,
        last_preview_http_status: null,
        boot_attempts: 0,
        last_boot_started_at: null,
        last_boot_completed_at: null,
      },
    }),
    "app_error"
  );
});
