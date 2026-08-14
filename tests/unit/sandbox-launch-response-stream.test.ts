import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxStore,
  buildSandboxRecord,
  buildSseResponse,
  createStoreHarness,
} from "./helpers/sandbox-launch-response-fixtures";

test("consumeSandboxLaunchResponse applies summary-backed launch events directly", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const creatingSandbox = buildSandboxRecord();
  const installingSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "installing",
    health_status: "starting",
    runtime_summary: {
      ...creatingSandbox.runtime_summary,
      sandbox_id: "vm_123",
      status: "installing",
    },
  });
  const previewSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "installing",
    preview_url: "https://preview.example.com",
    health_status: "starting",
    runtime_summary: {
      ...installingSandbox.runtime_summary,
      preview_url: "https://preview.example.com",
    },
  });
  const readySandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "running",
    preview_url: "https://preview.example.com",
    health_status: "running",
    last_preview_http_status: 200,
    runtime_summary: {
      ...previewSandbox.runtime_summary,
      status: "running",
      health_status: "running",
      last_preview_http_status: 200,
    },
  });

  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([
    { type: "status", status: "creating", sandbox: creatingSandbox },
    {
      type: "sandbox_created",
      sandboxId: "vm_123",
      recordId: "sandbox-1",
      sandbox: installingSandbox,
    },
    {
      type: "preview_url",
      url: "https://preview.example.com",
      sandbox: previewSandbox,
    },
    { type: "ready", sandbox: readySandbox },
  ]);

  const result = await consumeSandboxLaunchResponse(
    repoId,
    launchKey,
    response,
    harness.set as never,
    harness.get as never
  );

  assert.equal(result?.id, "sandbox-1");
  assert.equal(result?.runtime_summary.status, "running");
  assert.equal(
    result?.runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal(
    harness.get().sandboxes[repoId].runtime_summary.status,
    "running"
  );
  assert.equal(
    harness.get().sandboxes[repoId].runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal(harness.get().activeSandboxId, "sandbox-1");
});

test("consumeSandboxLaunchResponse keeps summary-backed error state before returning null", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const errorSandbox = buildSandboxRecord({
    sandbox_id: "vm_123",
    status: "error",
    health_status: "app_error",
    preview_url: "https://preview.example.com",
    last_preview_error: "Preview returned 500",
    error: "Bootstrap failed",
    runtime_summary: {
      sandbox_id: "vm_123",
      status: "error",
      health_status: "app_error",
      preview_url: "https://preview.example.com",
      last_health_check_at: null,
      last_preview_http_status: 500,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
    error_summary: {
      current_error: "Bootstrap failed",
      last_preview_error: "Preview returned 500",
      last_boot_error: null,
      display_error: "Bootstrap failed",
      has_errors: true,
    },
  });

  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([
    { type: "status", status: "error", sandbox: errorSandbox },
    { type: "error", message: "Bootstrap failed", phase: "bootstrap" },
  ]);

  const result = await consumeSandboxLaunchResponse(
    repoId,
    launchKey,
    response,
    harness.set as never,
    harness.get as never,
    "launch-attempt-1"
  );

  assert.equal(result, null);
  assert.equal(harness.get().sandboxes[repoId].runtime_summary.status, "error");
  assert.equal(
    harness.get().sandboxes[repoId].error_summary.current_error,
    "Bootstrap failed"
  );
  assert.deepEqual(harness.get().errors[launchKey], {
    message: "Bootstrap failed",
    code: "UNKNOWN",
    launchAttemptId: "launch-attempt-1",
  });
});

test("consumeSandboxLaunchResponse surfaces a failed fallback refresh", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([{ type: "log", data: "Starting..." }]);
  const get = () => ({
    ...harness.get(),
    refresh: async () => false,
    getSandboxForRepo: () => null,
  });

  await assert.rejects(
    consumeSandboxLaunchResponse(
      repoId,
      launchKey,
      response,
      harness.set as never,
      get as never
    ),
    /inventory refresh failed/
  );
});

test("consumeSandboxLaunchResponse surfaces a missing sandbox after fallback refresh", async () => {
  const { buildSandboxStateKey, consumeSandboxLaunchResponse } =
    await loadSandboxStore();
  const repoId = "repo-1";
  const launchKey = buildSandboxStateKey(repoId, "main", null);
  const harness = createStoreHarness(repoId);
  const response = buildSseResponse([{ type: "log", data: "Starting..." }]);
  const get = () => ({
    ...harness.get(),
    refresh: async () => true,
    getSandboxForRepo: () => null,
  });

  await assert.rejects(
    consumeSandboxLaunchResponse(
      repoId,
      launchKey,
      response,
      harness.set as never,
      get as never
    ),
    /refreshed inventory did not contain the sandbox/
  );
});
