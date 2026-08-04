import assert from "node:assert/strict";
import test from "node:test";
import type {
  SandboxContextResult,
  SandboxVercelContext,
} from "@/lib/sandbox/context";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import type { SandboxRecordRow } from "@/lib/types";

type SandboxReconcileRecordFixture = SandboxRecordRow & {
  repo?: {
    root_directory?: string | null;
    dev_port?: number | null;
    dev_port_auto?: unknown;
  } | null;
};

async function loadSandboxReadinessReconciliation() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
  return import("../../lib/sandbox/readiness-reconciliation");
}

function buildSandboxReconcileRecord(
  overrides: Partial<SandboxReconcileRecordFixture> = {}
): SandboxReconcileRecordFixture {
  return {
    id: "sandbox-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "vm_123",
    base_branch: "main",
    working_branch: "main",
    limit_claim_id: null,
    vercel_team_id: null,
    vercel_project_id: "project-1",
    sandbox_billing_target: "personal",
    billing_source: "platform",
    billing_team_id: null,
    billing_project_id: "project-1",
    status: "installing",
    preview_url: "https://preview.example.com",
    snapshot_id: null,
    install_log: "",
    dev_log: "",
    health_status: "starting",
    last_health_check_at: null,
    last_preview_http_status: null,
    last_preview_error: null,
    last_boot_error: "Booting",
    boot_attempts: 1,
    last_boot_started_at: "2026-04-01T10:00:00.000Z",
    last_boot_completed_at: null,
    runtime: "node22",
    terminal_cwd: null,
    exec_lock_token: null,
    exec_lock_started_at: null,
    error: "Booting",
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:00:00.000Z",
    repo: { root_directory: null, dev_port: 3000, dev_port_auto: true },
    ...overrides,
  };
}

function buildResolvedContext(): SandboxContextResult<SandboxVercelContext> {
  return {
    ok: true as const,
    context: {
      ownership: {
        source: "record" as const,
        billingSource: "platform" as const,
        credentialSource: "platform" as const,
        projectId: "project-1",
        teamId: null,
      },
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      },
    },
  };
}

test("reconcileSandboxReadiness keeps installing sandboxes active when Vercel lookup fails transiently", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({ product_team_id: "team-1" });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  const platformAccessScopes: Array<[string, string | null | undefined]> = [];
  let resolvedProductTeamId: string | null | undefined;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  try {
    console.warn = (...args) => {
      warnings.push(args);
    };

    const result = await reconcileSandboxReadiness(
      {
        sandboxRecordId: record.id,
        expectedSandboxId: record.sandbox_id,
        source: "launch",
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
        loadUserPlatformAccess: async (userId, productTeamId) => {
          platformAccessScopes.push([userId, productTeamId]);
          return {
            allowPlatformAi: false,
            allowPlatformSandbox: false,
          };
        },
        resolveSandboxRecordContext: async ({ sandboxCredentials }) => {
          resolvedProductTeamId = sandboxCredentials.productTeamId;
          return buildResolvedContext();
        },
        getSandbox: async () => {
          throw new Error("temporary Vercel lookup failure");
        },
        checkSandboxHealth: async () => ({
          status: "running",
          message: "Preview is accessible",
          statusCode: 200,
        }),
        loadSandboxVercelDiagnostics: async () => null,
        updateSandboxRecord: async (_id, payload) => {
          updates.push(payload as Partial<SandboxReconcileRecordFixture>);
          return {
            ...record,
            ...payload,
          } as never;
        },
      }
    );

    assert.ok(result);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, "running");
    assert.equal(updates[0].health_status, "running");
    assert.equal(updates[0].last_preview_error, null);
    assert.equal(result.sandbox.runtime_summary.status, "running");
    assert.equal(result.sandbox.runtime_summary.health_status, "running");
    assert.equal(result.isSettled, true);
    assert.equal(warnings.length, 1);
    assert.deepEqual(platformAccessScopes, [["user-1", "team-1"]]);
    assert.equal(resolvedProductTeamId, "team-1");
  } finally {
    console.warn = originalWarn;
  }
});

test("reconcileSandboxReadiness does not promote installing sandbox to running when VM is running but preview is not ready", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "starting",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "launch",
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
          readFile: async () => null,
        }) as never,
      checkSandboxHealth: async () => ({
        status: "starting" as const,
        message: "Preview not ready yet",
        statusCode: undefined,
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
  // Must stay "installing" — NOT promoted to "running"
  assert.equal(
    updates[0].status,
    "installing",
    "should not promote to running while bootstrapping and preview is not ready"
  );
  assert.equal(result.isSettled, false);
});

test("reconcileSandboxReadiness promotes installing sandbox to running when preview is actually ready", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "starting",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "launch",
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
          readFile: async () => null,
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
  assert.equal(
    updates[0].status,
    "running",
    "should promote when preview health confirms readiness"
  );
  assert.equal(result.isSettled, true);
});

test("reconcileSandboxReadiness recovers missing preview URL from a running VM", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "not_available",
    preview_url: null,
    repo: { root_directory: null, dev_port: 5173, dev_port_auto: false },
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  let checkedUrl: string | null | undefined;

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
          domain: (port: number) => `https://preview-${port}.example.com`,
          readFile: async () => "",
        }) as never,
      checkSandboxHealth: async (url) => {
        checkedUrl = url;
        return {
          status: "running" as const,
          message: "Preview is accessible",
          statusCode: 200,
        };
      },
      loadSandboxVercelDiagnostics: async () => null,
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(checkedUrl, "https://preview-5173.example.com");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].preview_url, "https://preview-5173.example.com");
  assert.equal(updates[0].status, "running");
  assert.equal(result.sandbox.runtime_summary.preview_url, checkedUrl);
  assert.equal(result.isSettled, true);
});

test("reconcileSandboxReadiness reads dev log only when the VM reports running", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "starting",
    dev_log: "previous log",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  let readFileCalls = 0;

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "launch",
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
          status: "pending",
          sandboxId: record.sandbox_id,
          readFile: async () => {
            readFileCalls += 1;
            throw new Error("readFile should not run for pending VMs");
          },
        }) as never,
      checkSandboxHealth: async () => ({
        status: "starting" as const,
        message: "Preview not ready yet",
        statusCode: undefined,
      }),
      loadSandboxVercelDiagnostics: async () => null,
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(readFileCalls, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].dev_log, "previous log");
  assert.equal(result.isSettled, false);
});

test("reconcileSandboxReadiness reads dev log during bootstrap when VM reports running", async () => {
  const { reconcileSandboxReadiness } =
    await loadSandboxReadinessReconciliation();
  const record = buildSandboxReconcileRecord({
    status: "installing",
    health_status: "starting",
    dev_log: "previous log",
  });
  const updates: Array<Partial<SandboxReconcileRecordFixture>> = [];
  let readFileCalls = 0;

  const result = await reconcileSandboxReadiness(
    {
      sandboxRecordId: record.id,
      expectedSandboxId: record.sandbox_id,
      source: "launch",
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
            readFileCalls += 1;
            return "fresh bootstrap log";
          },
        }) as never,
      checkSandboxHealth: async () => ({
        status: "starting" as const,
        message: "Preview not ready yet",
        statusCode: undefined,
      }),
      loadSandboxVercelDiagnostics: async () => null,
      updateSandboxRecord: async (_id, payload) => {
        updates.push(payload as Partial<SandboxReconcileRecordFixture>);
        return { ...record, ...payload } as never;
      },
    }
  );

  assert.ok(result);
  assert.equal(readFileCalls, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].dev_log, "fresh bootstrap log");
  assert.equal(result.isSettled, false);
});

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

test("isSnapshotNotFoundSandboxError detects SDK-envelope code (.json.error.code)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Snapshot not found"), {
    status: 400,
    json: { error: { code: "snapshot_not_found", message: "gone" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects top-level .code", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Snapshot not found"), {
    code: "snapshot_not_found",
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects HTTP 400 with marker in .body (object)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Bad request"), {
    status: 400,
    body: { error: { code: "snapshot_not_found" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects HTTP 400 with marker in .body (raw string)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Bad request"), {
    status: 400,
    body: '{"error":{"code":"snapshot_not_found"}}',
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError does not swallow unrelated 400 errors that mention the marker outside body/data", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  // The marker appears only in the message — neither .body nor .data carry it,
  // so the fallback path must not match.
  const error = Object.assign(
    new Error("Validation failed: snapshot_not_found is reserved"),
    {
      status: 400,
      body: { error: { code: "validation_error" } },
    }
  );
  assert.equal(isSnapshotNotFoundSandboxError(error), false);
});

test("isSnapshotNotFoundSandboxError ignores non-400 errors even if body contains the marker", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Server error"), {
    status: 500,
    body: { error: { code: "snapshot_not_found" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), false);
});
