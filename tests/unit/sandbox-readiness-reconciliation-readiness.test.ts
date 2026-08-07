import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxReadinessReconciliation,
  buildSandboxReconcileRecord,
  buildResolvedContext,
  type SandboxReconcileRecordFixture,
} from "./helpers/sandbox-readiness-reconciliation-fixtures";

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
