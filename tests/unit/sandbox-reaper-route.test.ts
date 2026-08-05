import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformSandboxCredentials,
  buildReaperCredentialFailure,
  buildReaperResolvedLiveness,
  buildReaperSandboxCredentials,
  buildReaperSandboxRecord,
  buildReaperStaleStoppedSandbox,
  buildReaperUnresolvableLiveness,
  buildSandboxReaperRequest,
  buildUserVercelCredentials,
  loadSandboxReaperRouteModule,
} from "./sandbox-reaper-test-harness";

type SandboxReaperRouteModule = Awaited<
  ReturnType<typeof loadSandboxReaperRouteModule>
>;

type SandboxReaperGetHandlerOverrides = Parameters<
  SandboxReaperRouteModule["createSandboxReaperGetHandler"]
>[0];

async function buildSandboxReaperHandler(
  overrides: SandboxReaperGetHandlerOverrides = {}
) {
  const { createSandboxReaperGetHandler } =
    await loadSandboxReaperRouteModule();

  return createSandboxReaperGetHandler({
    requireMachineApiAuth: () => null,
    loadActiveSandboxes: async () => [] as never,
    loadStaleStoppedSandboxes: async () => [] as never,
    loadAbandonedPausedSandboxes: async () => [] as never,
    loadBusySandboxIds: async () => new Set<string>(),
    getPlatformSandboxCredentials: () => buildPlatformSandboxCredentials(),
    loadUserVercelCredentials: async () => buildUserVercelCredentials(),
    resolveCrossUserActiveSandboxLivenessMap: async () => new Map() as never,
    ...overrides,
  });
}

test("stopSandbox leaves user-billed sandboxes active when credentials cannot be resolved", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  let stopped = false;
  let updatePayload: Record<string, unknown> | null = null;

  const result = await stopSandbox(
    buildReaperSandboxRecord(),
    buildReaperCredentialFailure(),
    {
      onSuccessAction: "stopped_vm_gone",
    },
    {
      getSandbox: async () => {
        throw new Error("getSandbox should not be called");
      },
      stopSandboxRecord: async () => {
        stopped = true;
        return null;
      },
      updateSandboxRecord: async (_id, updates) => {
        updatePayload = updates;
        return null;
      },
    }
  );

  assert.deepEqual(result, {
    stopped: false,
    action: "skipped_missing_billing_credentials",
  });
  assert.equal(stopped, false);
  assert.deepEqual(updatePayload, {
    health_status: "error",
    last_preview_error:
      "Sandbox is missing its stored Vercel project for user-owned billing.",
  });
});

test("stopSandbox soft-pauses a persistent sandbox on idle timeout (state preserved)", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  const updateCalls: Array<{ updates: Record<string, unknown> }> = [];
  let stopSandboxRecordCalled = false;

  const result = await stopSandbox(
    {
      id: "sandbox-1",
      sandbox_id: "vm_123",
      status: "running",
      persistent: true,
    },
    { ok: true, vercelToken: "t", vercelTeamId: null, vercelProjectId: "p" },
    { onSuccessAction: "stopped_idle" },
    {
      getSandbox: (async () => ({
        stop: async () => {},
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
        currentSnapshotId: "snap_idle",
      })) as never,
      updateSandboxRecord: async (_id, updates) => {
        updateCalls.push({ updates });
        return null;
      },
      stopSandboxRecord: async () => {
        stopSandboxRecordCalled = true;
        return null;
      },
    }
  );

  assert.deepEqual(result, { stopped: true, action: "paused_idle" });
  assert.equal(stopSandboxRecordCalled, false);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].updates.status, "paused");
  assert.equal(updateCalls[0].updates.health_status, "paused");
  assert.equal(updateCalls[0].updates.snapshot_id, "snap_idle");
});

test("stopSandbox hard-stops a non-persistent sandbox on idle timeout (no soft-pause)", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  let stopSandboxRecordCalled = false;
  let updateSandboxRecordCalled = false;

  const result = await stopSandbox(
    {
      id: "sandbox-1",
      sandbox_id: "vm_123",
      status: "running",
      persistent: false,
    },
    { ok: true, vercelToken: "t", vercelTeamId: null, vercelProjectId: "p" },
    { onSuccessAction: "stopped_idle" },
    {
      getSandbox: (async () => ({
        stop: async () => {},
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
        currentSnapshotId: undefined,
      })) as never,
      updateSandboxRecord: async () => {
        updateSandboxRecordCalled = true;
        return null;
      },
      stopSandboxRecord: async () => {
        stopSandboxRecordCalled = true;
        return null;
      },
    }
  );

  assert.deepEqual(result, { stopped: true, action: "stopped_idle" });
  assert.equal(stopSandboxRecordCalled, true);
  assert.equal(updateSandboxRecordCalled, false);
});

test("stopSandbox hard-stops a persistent sandbox when VM is confirmed gone (no soft-pause)", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  let stopSandboxRecordCalled = false;

  const result = await stopSandbox(
    {
      id: "sandbox-1",
      sandbox_id: "vm_123",
      status: "running",
      persistent: true,
    },
    { ok: true, vercelToken: "t", vercelTeamId: null, vercelProjectId: "p" },
    { onSuccessAction: "stopped_vm_gone", confirmedGone: true },
    {
      getSandbox: async () => {
        throw new Error("getSandbox should not be called when confirmedGone");
      },
      updateSandboxRecord: async () => null,
      stopSandboxRecord: async () => {
        stopSandboxRecordCalled = true;
        return null;
      },
    }
  );

  assert.deepEqual(result, { stopped: true, action: "stopped_vm_gone" });
  assert.equal(stopSandboxRecordCalled, true);
});

test("stopSandbox only marks a sandbox stopped after confirmed-gone or successful stop", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  let stopCalls = 0;

  const result = await stopSandbox(
    buildReaperSandboxRecord(),
    buildReaperSandboxCredentials({
      vercelToken: "token",
      vercelTeamId: "team",
      vercelProjectId: "project",
    }),
    {
      confirmedGone: true,
      onSuccessAction: "stopped_vm_gone",
    },
    {
      getSandbox: async () => {
        throw new Error("getSandbox should not be called for confirmedGone");
      },
      stopSandboxRecord: async () => {
        stopCalls += 1;
        return null;
      },
      updateSandboxRecord: async () => {
        throw new Error("updateSandboxRecord should not be called");
      },
    }
  );

  assert.deepEqual(result, {
    stopped: true,
    action: "stopped_vm_gone",
  });
  assert.equal(stopCalls, 1);
});

test("GET /api/cron/sandbox-reaper marks idle sandboxes with an idle warning on first pass", async () => {
  const updates: Array<{
    id: string;
    updates: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];

  const handler = await buildSandboxReaperHandler({
    loadActiveSandboxes: async () => [buildReaperSandboxRecord()] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperResolvedLiveness("running")]]) as never,
    stopSandbox: async () => {
      throw new Error("stopSandbox should not be called");
    },
    updateSandboxRecord: async (id, nextUpdates, options) => {
      updates.push({ id, updates: nextUpdates, options });
      return {} as never;
    },
    nowMs: () => new Date("2026-04-01T10:11:00.000Z").getTime(),
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 0,
    results: [{ id: "sandbox-1", action: "marked_idle_warning" }],
  });
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: { health_status: "idle_warning" },
      options: {
        expectedSandboxId: "vm_123",
        fromStatuses: "running",
      },
    },
  ]);
});

test("GET /api/cron/sandbox-reaper stops second-pass idle sandboxes through the shared stop path", async () => {
  const stopCalls: Array<{
    credentials: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];

  const handler = await buildSandboxReaperHandler({
    loadActiveSandboxes: async () =>
      [
        buildReaperSandboxRecord({
          health_status: "idle_warning",
        }),
      ] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperResolvedLiveness("running")]]) as never,
    stopSandbox: async (_sandbox, credentials, options) => {
      stopCalls.push({ credentials, options });
      return { stopped: true, action: "stopped_idle" } as never;
    },
    loadFreshIdleState: async () => ({
      last_active_at: "2026-04-01T10:00:00.000Z",
      health_status: "idle_warning",
    }),
    nowMs: () => new Date("2026-04-01T10:11:00.000Z").getTime(),
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 1,
    results: [{ id: "sandbox-1", action: "stopped_idle" }],
  });
  assert.deepEqual(stopCalls, [
    {
      credentials: buildReaperSandboxCredentials(),
      options: {
        expectedHealthStatus: "idle_warning",
        confirmedGone: false,
        onSuccessAction: "stopped_idle",
      },
    },
  ]);
});

test("GET /api/cron/sandbox-reaper fast-stops sandboxes whose shared liveness is already stopped", async () => {
  const stopCalls: Array<{
    credentials: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];

  const handler = await buildSandboxReaperHandler({
    loadActiveSandboxes: async () => [buildReaperSandboxRecord()] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperResolvedLiveness("stopped")]]) as never,
    stopSandbox: async (_sandbox, credentials, options) => {
      stopCalls.push({ credentials, options });
      return { stopped: true, action: "stopped_vm_gone" } as never;
    },
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 1,
    results: [{ id: "sandbox-1", action: "stopped_vm_gone" }],
  });
  assert.deepEqual(stopCalls, [
    {
      credentials: buildReaperSandboxCredentials(),
      options: {
        confirmedGone: true,
        onSuccessAction: "stopped_vm_gone",
      },
    },
  ]);
});

test("GET /api/cron/sandbox-reaper preserves fail-safe behavior for user-billed credential errors", async () => {
  const { stopSandbox } = await loadSandboxReaperRouteModule();
  let errorUpdate: Record<string, unknown> | null = null;

  const handler = await buildSandboxReaperHandler({
    loadActiveSandboxes: async () =>
      [
        buildReaperSandboxRecord({
          billing_source: "user_vercel_project",
          status: "creating",
          sandbox_id: "vm_user_123",
          created_at: "2026-04-01T03:00:00.000Z",
        }),
      ] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperUnresolvableLiveness()]]) as never,
    stopSandbox: async (sandbox, credentials, options) =>
      stopSandbox(sandbox, credentials, options, {
        getSandbox: async () => {
          throw new Error("getSandbox should not be called");
        },
        stopSandboxRecord: async () => {
          throw new Error("stopSandboxRecord should not be called");
        },
        updateSandboxRecord: async (_id, updates) => {
          errorUpdate = updates;
          return null;
        },
      }),
    nowMs: () => new Date("2026-04-01T10:10:00.000Z").getTime(),
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 0,
    results: [
      { id: "sandbox-1", action: "skipped_missing_billing_credentials" },
    ],
  });
  assert.deepEqual(errorUpdate, {
    health_status: "error",
    last_boot_error:
      "Sandbox is missing its stored Vercel project for user-owned billing.",
  });
});

test("GET /api/cron/sandbox-reaper repairs stale stopped health_status rows without active sandboxes", async () => {
  const repairs: Array<Record<string, unknown>> = [];

  const handler = await buildSandboxReaperHandler({
    loadStaleStoppedSandboxes: async () =>
      [buildReaperStaleStoppedSandbox()] as never,
    loadBusySandboxIds: async () => {
      throw new Error("loadBusySandboxIds should not be called");
    },
    repairStoppedSandboxHealthStatus: async (sandbox) => {
      repairs.push(sandbox as unknown as Record<string, unknown>);
      return {
        repaired: true,
        action: "repaired_stopped_health_status",
      } as never;
    },
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 0,
    results: [
      { id: "sandbox-stale-1", action: "repaired_stopped_health_status" },
    ],
  });
  assert.deepEqual(repairs, [buildReaperStaleStoppedSandbox()]);
});

test("GET /api/cron/sandbox-reaper logs stopped-row repair failures and keeps going", async () => {
  const errors: Array<Parameters<typeof console.error>> = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    errors.push(args);
  };

  try {
    const handler = await buildSandboxReaperHandler({
      loadStaleStoppedSandboxes: async () =>
        [buildReaperStaleStoppedSandbox({ health_status: null })] as never,
      loadBusySandboxIds: async () => {
        throw new Error("loadBusySandboxIds should not be called");
      },
      repairStoppedSandboxHealthStatus: async () => {
        throw new Error("stale stopped repair failed");
      },
    });

    const response = await handler(buildSandboxReaperRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Processed 1 sandboxes",
      reaped: 0,
      results: [
        {
          id: "sandbox-stale-1",
          action: "repair_stopped_health_status_failed",
        },
      ],
    });
    assert.equal(errors.length, 1);
    assert.match(
      String(errors[0]?.[0]),
      /Failed to repair stopped health status/
    );
  } finally {
    console.error = originalConsoleError;
  }
});
