import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReaperStaleStoppedSandbox,
  buildSandboxReaperRequest,
  loadSandboxReaperRouteModule,
} from "./sandbox-reaper-test-harness";

test("GET /api/cron/sandbox-reaper reports when stopped-row repair already converged by race", async () => {
  const { createSandboxReaperGetHandler } =
    await loadSandboxReaperRouteModule();

  const handler = createSandboxReaperGetHandler({
    requireMachineApiAuth: () => null,
    loadActiveSandboxes: async () => [] as never,
    loadStaleStoppedSandboxes: async () =>
      [buildReaperStaleStoppedSandbox()] as never,
    loadAbandonedPausedSandboxes: async () => [] as never,
    loadBusySandboxIds: async () => {
      throw new Error("loadBusySandboxIds should not be called");
    },
    resolveCrossUserActiveSandboxLivenessMap: async () => new Map() as never,
    repairStoppedSandboxHealthStatus: async () =>
      ({
        repaired: false,
        action: "stopped_health_status_already_converged",
      }) as never,
  });

  const response = await handler(buildSandboxReaperRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Processed 1 sandboxes",
    reaped: 0,
    results: [
      {
        id: "sandbox-stale-1",
        action: "stopped_health_status_already_converged",
      },
    ],
  });
});
