import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxRecord } from "@/lib/types";
import { loadSandboxRouteModule } from "./sandbox-service-route-test-harness";

test("interactive sandbox launches only auto-queue snapshot warmup when the feature flag is enabled", async () => {
  const { shouldQueueSnapshotWarmupOnSandboxLaunch } =
    await loadSandboxRouteModule();
  const previousValue = process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;

  try {
    delete process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), false);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "true";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), true);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "1";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), true);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "false";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;
    } else {
      process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = previousValue;
    }
  }
});

test("summarizeDeferredSnapshotWarmupQueueResult treats expected skips as informational", async () => {
  const { summarizeDeferredSnapshotWarmupQueueResult } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    summarizeDeferredSnapshotWarmupQueueResult({
      queued: false,
      reason: "in_progress",
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
    }),
    {
      logLevel: "info",
      logMessage:
        "[sandbox/create] Deferred snapshot build is already in progress",
      warningMessage: null,
      details: { reason: "in_progress" },
    }
  );
});

test("summarizeDeferredSnapshotWarmupQueueResult surfaces unexpected skips for operators", async () => {
  const { summarizeDeferredSnapshotWarmupQueueResult } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    summarizeDeferredSnapshotWarmupQueueResult({
      queued: false,
      reason: "repo_not_found",
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
    }),
    {
      logLevel: "warn",
      logMessage:
        "[sandbox/create] Deferred snapshot build could not be queued because the repo state was unavailable",
      warningMessage: "Automatic snapshot warmup could not be queued.",
      details: { reason: "repo_not_found" },
    }
  );
});

test("classifySandboxLaunchFailure preserves sandbox request validation errors", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();
  const { SandboxCreateRequestValidationError } =
    await import("@/lib/sandbox/client");

  const failure = classifySandboxLaunchFailure(
    new SandboxCreateRequestValidationError(
      "reserved_port",
      "Sandbox requested reserved port 8080. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
    )
  );

  assert.equal(
    failure.actionableMessage,
    "Sandbox requested reserved port 8080. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
  );
  assert.equal(failure.phase, "create");
});

test("classifySandboxLaunchFailure maps raw Vercel reserved_port envelopes to actionable guidance", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();

  const err = Object.assign(new Error("Status code 400 is not ok"), {
    json: {
      error: {
        code: "reserved_port",
        message: "Port 8080 is reserved by the system",
      },
    },
  });

  const failure = classifySandboxLaunchFailure(err);

  assert.equal(
    failure.actionableMessage,
    "Vercel rejected the sandbox request: reserved_port: Port 8080 is reserved by the system. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
  );
  assert.equal(failure.phase, "create");
});

test("classifySandboxLaunchFailure maps raw Vercel payload-too-large envelopes to actionable guidance", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();

  const err = Object.assign(new Error("Status code 400 is not ok"), {
    json: {
      error: {
        code: "bad_request",
        message: "env payload too large (4349 bytes; max 4096)",
      },
    },
  });

  const failure = classifySandboxLaunchFailure(err);

  assert.equal(
    failure.actionableMessage,
    "Vercel rejected the sandbox request: bad_request: env payload too large (4349 bytes; max 4096). Remove or shorten sandbox env vars before launching."
  );
  assert.equal(failure.phase, "create");
});

test("shouldLoadSandboxLaunchFailureDiagnostics only loads project diagnostics after sandbox creation", async () => {
  const { shouldLoadSandboxLaunchFailureDiagnostics } =
    await loadSandboxRouteModule();

  type LaunchFailureState = Parameters<
    typeof shouldLoadSandboxLaunchFailureDiagnostics
  >[0];

  const baseState: LaunchFailureState = {
    sandbox: null,
    previewUrl: null,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: false,
    streamSandboxRecord: {} as never,
  };

  assert.equal(shouldLoadSandboxLaunchFailureDiagnostics(baseState), false);
  assert.equal(
    shouldLoadSandboxLaunchFailureDiagnostics({
      ...baseState,
      sandbox: { name: "sandbox-1" } as never,
    }),
    true
  );
});

test("toStreamStatusSandboxRecord preserves normalized client records for running status events", async () => {
  const { toStreamStatusSandboxRecord } = await loadSandboxRouteModule();

  const readySandbox: SandboxRecord = {
    id: "sandbox-1",
    user_id: "user-123",
    repo_id: "repo-123",
    sandbox_id: "vm_123",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: null,
    stop_reason: null,
    install_log: "",
    dev_log: "",
    runtime: "node22",
    terminal_cwd: null,
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:01:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Mogplex billing",
      project_id: "project-123",
      team_id: null,
      team_label: "Personal",
    },
    runtime_summary: {
      sandbox_id: "vm_123",
      status: "running",
      health_status: "running",
      preview_url: "https://preview.example.com",
      last_health_check_at: "2026-04-01T10:01:00.000Z",
      last_preview_http_status: 200,
      boot_attempts: 1,
      last_boot_started_at: "2026-04-01T10:00:00.000Z",
      last_boot_completed_at: "2026-04-01T10:01:00.000Z",
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };

  const result = toStreamStatusSandboxRecord(readySandbox);

  assert.equal(result.runtime_summary.status, "running");
  assert.equal(result.runtime_summary.health_status, "running");
  assert.equal(
    result.runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal("status" in result, false);
});

test("buildSandboxInstallingRecordUpdates stores the Vercel persistence flag", async () => {
  const { buildSandboxInstallingRecordUpdates } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    buildSandboxInstallingRecordUpdates({
      sandboxId: "vm_ephemeral",
      sandbox: { sandbox: { persistent: false } },
    }),
    {
      sandbox_id: "vm_ephemeral",
      status: "installing",
      persistent: false,
    }
  );

  assert.deepEqual(
    buildSandboxInstallingRecordUpdates({
      sandboxId: "vm_persistent",
      sandbox: { sandbox: { persistent: true } },
    }),
    {
      sandbox_id: "vm_persistent",
      status: "installing",
      persistent: true,
    }
  );
});

test("resolvePendingSandboxPersistenceFlag mirrors the sandbox create persistence gate", async () => {
  const { resolvePendingSandboxPersistenceFlag } =
    await loadSandboxRouteModule();
  const previousEnable = process.env.ENABLE_PERSISTENT_SANDBOXES;
  const previousDisable = process.env.DISABLE_PERSISTENT_SANDBOXES;

  try {
    delete process.env.ENABLE_PERSISTENT_SANDBOXES;
    delete process.env.DISABLE_PERSISTENT_SANDBOXES;
    assert.equal(resolvePendingSandboxPersistenceFlag(), false);

    process.env.ENABLE_PERSISTENT_SANDBOXES = "true";
    assert.equal(resolvePendingSandboxPersistenceFlag(), true);

    process.env.DISABLE_PERSISTENT_SANDBOXES = "true";
    assert.equal(resolvePendingSandboxPersistenceFlag(), false);
  } finally {
    if (previousEnable === undefined) {
      delete process.env.ENABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.ENABLE_PERSISTENT_SANDBOXES = previousEnable;
    }

    if (previousDisable === undefined) {
      delete process.env.DISABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.DISABLE_PERSISTENT_SANDBOXES = previousDisable;
    }
  }
});
