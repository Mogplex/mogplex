import assert from "node:assert/strict";
import test from "node:test";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import {
  loadSandboxReadinessReconciliation,
  buildSandboxReconcileRecord,
  buildResolvedContext,
  type SandboxReconcileRecordFixture,
} from "./helpers/sandbox-readiness-reconciliation-fixtures";

test("reconcileSandboxReadiness downgrades snapshot_not_found dev log reads", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "running",
    health_status: "running",
    dev_log: "previous log",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  const originalError = console.error;
  const originalDebug = console.debug;
  const errors: unknown[][] = [];
  const debugLogs: unknown[][] = [];

  try {
    console.error = (...args) => {
      errors.push(args);
    };
    console.debug = (...args) => {
      debugLogs.push(args);
    };

    const result = await reconcileSandboxReadiness(
      {
        sandboxRecordId: record.id,
        expectedSandboxId: record.sandbox_id,
        source: "health",
      },
      {},
      {
        loadSandboxRecord: async () => record,
        loadLatestSandboxRecord: async () => record,
        loadUserVercelCredentials: async () => ({
          userVercelToken: null,
          userVercelTeamId: null,
          accountDefaultVercelProjectId: null,
          accountDefaultVercelTeamId: null,
        }),
        loadUserPlatformAccess: async () => ({
          allowPlatformAi: false,
          allowPlatformSandbox: false,
        }),
        resolveSandboxRecordContext: async () => buildResolvedContext(),
        getSandbox: async () =>
          ({
            status: "running",
            sandboxId: record.sandbox_id,
            readFile: async () => {
              const error = new Error("Snapshot not found");
              Object.assign(error, {
                status: 400,
                json: {
                  error: {
                    code: "snapshot_not_found",
                    message: "Snapshot not found",
                  },
                },
              });
              throw error;
            },
          }) as never,
        checkSandboxHealth: async () => ({
          status: "running" as const,
          message: "Preview is accessible",
          statusCode: 200,
        }),
        loadSandboxVercelDiagnostics: async () => null,
        updateSandboxRecord: async (_id, payload) => {
          updates.push(payload as Partial<SandboxReconcileRecordFixture>);
          return { ...record, ...payload } as never;
        },
      }
    );

    assert.ok(result);
    assert.equal(errors.length, 0);
    assert.equal(debugLogs.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].dev_log, "previous log");
    assert.equal(result.sandbox.dev_log, "previous log");
  } finally {
    console.error = originalError;
    console.debug = originalDebug;
  }
});

test("reconcileSandboxReadiness still stores dev log for genuinely running sandboxes", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "running",
    health_status: "running",
    dev_log: "previous log",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "health",
    },
    {},
    {
      loadSandboxRecord: async () => record,
      loadLatestSandboxRecord: async () => record,
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      resolveSandboxRecordContext: async () => buildResolvedContext(),
      getSandbox: async () =>
        ({
          status: "running",
          sandboxId: record.sandbox_id,
          readFile: async () => "fresh dev log",
        }) as never,
      checkSandboxHealth: async () => ({
        status: "running" as const,
        message: "Preview is accessible",
        statusCode: 200,
      }),
      loadSandboxVercelDiagnostics: async () => null,
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].dev_log, "fresh dev log");
  assert.equal(result.sandbox.dev_log, "fresh dev log");
});

test("reconcileSandboxReadiness preserves vm_gone stop_reason writes", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const clientFixture = sandboxRecord({
    status: "running",
    healthStatus: "starting",
  });
  const record = buildSandboxReconcileRecord({
    id: clientFixture.id,
    sandbox_id: clientFixture.sandbox_id,
    status: "running",
    health_status: "starting",
    preview_url: clientFixture.runtime_summary.preview_url,
    dev_log: "previous log",
  });
  const stopCalls: Array<{
    id: string;
    options?: {
      stopReason?: string | null;
      additionalUpdates?: Record<string, unknown>;
    };
  }> = [];

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "health",
    },
    {},
    {
      loadSandboxRecord: async () => record,
      loadLatestSandboxRecord: async () => ({
        ...record,
        status: "stopped",
        health_status: "stopped",
        stop_reason: "vm_gone",
      }),
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      resolveSandboxRecordContext: async () => buildResolvedContext(),
      getSandbox: async () =>
        ({
          status: "stopped",
          sandboxId: record.sandbox_id,
          readFile: async () => {
            throw new Error("readFile should not run for stopped VMs");
          },
        }) as never,
      checkSandboxHealth: async () => {
        throw new Error("health check should not run for stopped VMs");
      },
      loadSandboxVercelDiagnostics: async () => null,
      stopSandboxRecord: async (id, options) => {
        stopCalls.push({ id, options });
        return null;
      },
      updateSandboxRecord: async () => {
        throw new Error("updateSandboxRecord should not run for stopped VMs");
      },
    }
  );

  assert.ok(result);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].id, record.id);
  assert.equal(stopCalls[0].options?.stopReason, "vm_gone");
  assert.equal(
    stopCalls[0].options?.additionalUpdates?.last_preview_error,
    "Sandbox is no longer running"
  );
  assert.equal(
    stopCalls[0].options?.additionalUpdates?.dev_log,
    "previous log"
  );
  assert.equal(result.rawRecord.stop_reason, "vm_gone");
});

test("reconcileSandboxReadiness skips project-level Vercel diagnostics while sandbox bootstrap is still transient", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "starting",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  let diagnosticsCalls = 0;

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "health",
    },
    {
      includeDiagnostics: true,
    },
    {
      loadSandboxRecord: async () => record,
      loadLatestSandboxRecord: async () => record,
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      resolveSandboxRecordContext: async () => buildResolvedContext(),
      getSandbox: async () =>
        ({
          status: "running",
          sandboxId: record.sandbox_id,
          readFile: async () => null,
        }) as never,
      checkSandboxHealth: async () => ({
        status: "not_available" as const,
        message: "Preview is still starting",
        statusCode: undefined,
      }),
      loadSandboxVercelDiagnostics: async () => {
        diagnosticsCalls += 1;
        return {
          state: "build_failed",
          deploymentId: "dpl_stale",
          deploymentUrl: "https://stale-project-deploy.vercel.app",
          deploymentStatus: "CANCELED",
          buildSummary:
            'The Deployment has been canceled by "Ignored Build Step".',
          detectedAt: "2026-04-18T10:24:43.000Z",
        };
      },
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(diagnosticsCalls, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "installing");
  assert.equal(updates[0].last_preview_error, "Preview is still starting");
  assert.equal(
    result.sandbox.error_summary.last_preview_error,
    "Preview is still starting"
  );
  assert.equal(result.sandbox.runtime_summary.vercel_diagnostics ?? null, null);
  assert.equal(result.isSettled, false);
});

test("reconcileSandboxReadiness still loads project-level diagnostics for settled preview failures", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "running",
    health_status: "app_error",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  let diagnosticsCalls = 0;

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "health",
    },
    {
      includeDiagnostics: true,
    },
    {
      loadSandboxRecord: async () => record,
      loadLatestSandboxRecord: async () => record,
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      }),
      resolveSandboxRecordContext: async () => buildResolvedContext(),
      getSandbox: async () =>
        ({
          status: "running",
          sandboxId: record.sandbox_id,
          readFile: async () => null,
        }) as never,
      checkSandboxHealth: async () => ({
        status: "app_error" as const,
        message: "Preview failed while booting",
        statusCode: 503,
      }),
      loadSandboxVercelDiagnostics: async () => {
        diagnosticsCalls += 1;
        return {
          state: "build_failed",
          deploymentId: "dpl_real",
          deploymentUrl: "https://failed-preview.vercel.app",
          deploymentStatus: "ERROR",
          buildSummary: "Error: Missing NEXT_PUBLIC_API_URL",
          detectedAt: "2026-04-18T12:05:00.000Z",
        };
      },
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(diagnosticsCalls, 1);
  assert.equal(updates.length, 1);
  assert.equal(
    updates[0].last_preview_error,
    "Error: Missing NEXT_PUBLIC_API_URL"
  );
  assert.equal(
    result.sandbox.runtime_summary.vercel_diagnostics?.state,
    "build_failed"
  );
  assert.equal(
    result.sandbox.error_summary.last_preview_error,
    "Error: Missing NEXT_PUBLIC_API_URL"
  );
});
