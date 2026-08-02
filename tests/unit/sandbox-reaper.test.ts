import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformSandboxCredentials,
  buildReaperResolvedLiveness,
  buildReaperSandboxRecord,
  buildSandboxReaperRequest,
  buildUserVercelCredentials,
  loadSandboxReaperRouteModule,
} from "./sandbox-reaper-test-harness";

async function buildHandler(
  overrides: Partial<
    Parameters<
      Awaited<
        ReturnType<typeof loadSandboxReaperRouteModule>
      >["createSandboxReaperGetHandler"]
    >[0]
  > = {}
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

test("GET /api/cron/sandbox-reaper finalizes stale pausing persistent rows when the VM is stopped", async () => {
  const updates: Array<{
    id: string;
    updates: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];

  const handler = await buildHandler({
    loadActiveSandboxes: async () =>
      [
        buildReaperSandboxRecord({
          status: "pausing",
          health_status: "pausing",
          persistent: true,
        }),
      ] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperResolvedLiveness("stopped")]]) as never,
    updateSandboxRecord: async (id, nextUpdates, options) => {
      updates.push({ id, updates: nextUpdates, options });
      return {} as never;
    },
    getSandbox: async () => {
      throw new Error("getSandbox should not be called for stopped VMs");
    },
    stopSandbox: async () => {
      throw new Error("stopSandbox should not be called for persistent rows");
    },
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 1,
    results: [{ id: "sandbox-1", action: "finalized_stale_pausing" }],
  });
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "paused",
        health_status: "paused",
        stop_reason: "auto_pause",
      },
      options: {
        expectedSandboxId: "vm_123",
        fromStatuses: "pausing",
      },
    },
  ]);
});

test("GET /api/cron/sandbox-reaper completes stale pausing persistent rows when the VM is still running", async () => {
  const updates: Array<{
    id: string;
    updates: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];
  let stopCalls = 0;

  const handler = await buildHandler({
    loadActiveSandboxes: async () =>
      [
        buildReaperSandboxRecord({
          status: "pausing",
          health_status: "pausing",
          persistent: true,
        }),
      ] as never,
    resolveCrossUserActiveSandboxLivenessMap: async () =>
      new Map([["sandbox-1", buildReaperResolvedLiveness("running")]]) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
        currentSnapshotId: "snap_reaped",
      }) as never,
    updateSandboxRecord: async (id, nextUpdates, options) => {
      updates.push({ id, updates: nextUpdates, options });
      return {} as never;
    },
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 1,
    results: [{ id: "sandbox-1", action: "paused_stale_pausing" }],
  });
  assert.equal(stopCalls, 1);
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "paused",
        health_status: "paused",
        stop_reason: "auto_pause",
        snapshot_id: "snap_reaped",
      },
      options: {
        expectedSandboxId: "vm_123",
        fromStatuses: "pausing",
      },
    },
  ]);
});

test("GET /api/cron/sandbox-reaper skips stale pausing rows while busy work is attached", async () => {
  for (const busyId of ["sandbox-1", "vm_123"]) {
    const handler = await buildHandler({
      loadActiveSandboxes: async () =>
        [
          buildReaperSandboxRecord({
            status: "pausing",
            health_status: "pausing",
            persistent: true,
          }),
        ] as never,
      loadBusySandboxIds: async () => new Set([busyId]),
      resolveCrossUserActiveSandboxLivenessMap: async () =>
        new Map([
          ["sandbox-1", buildReaperResolvedLiveness("running")],
        ]) as never,
      getSandbox: async () => {
        throw new Error("busy pausing rows must not touch the VM");
      },
      updateSandboxRecord: async () => {
        throw new Error("busy pausing rows must not update the row");
      },
    });

    const response = await handler(buildSandboxReaperRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Processed 1 sandboxes",
      reaped: 0,
      results: [{ id: "sandbox-1", action: "skipped_stale_pausing_busy" }],
    });
  }
});
