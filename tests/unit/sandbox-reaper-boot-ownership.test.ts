import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformSandboxCredentials,
  buildUserVercelCredentials,
  buildReaperSandboxRecord,
  buildReaperResolvedLiveness,
  buildSandboxReaperRequest,
  loadSandboxReaperRouteModule,
} from "./sandbox-reaper-test-harness";

for (const ageMinutes of [1, 11]) {
  test(`reaper preserves fresh boots and recovers abandoned boots (${ageMinutes} minutes)`, async () => {
    const now = Date.now();
    const { createSandboxReaperGetHandler } =
      await loadSandboxReaperRouteModule();
    const handler = createSandboxReaperGetHandler({
      requireMachineApiAuth: () => null,
      loadStaleStoppedSandboxes: async () => [],
      loadBusySandboxIds: async () => new Set<string>(),
      getPlatformSandboxCredentials: () => buildPlatformSandboxCredentials(),
      loadUserVercelCredentials: async () => buildUserVercelCredentials(),
      loadActiveSandboxes: async () =>
        [
          {
            ...buildReaperSandboxRecord({
              status: "installing",
              health_status: "starting",
            }),
            last_boot_started_at: new Date(
              now - ageMinutes * 60_000
            ).toISOString(),
          },
        ] as never,
      resolveCrossUserActiveSandboxLivenessMap: async () =>
        new Map([
          ["sandbox-1", buildReaperResolvedLiveness("stopped")],
        ]) as never,
      nowMs: () => now,
      stopSandbox: async (_sandbox, _credentials, options) => {
        assert.equal(ageMinutes, 11, "a fresh boot must not be stopped");
        assert.equal(options.onSuccessAction, "stopped_stuck_boot");
        return { stopped: true, action: options.onSuccessAction } as never;
      },
    });
    const payload = await (await handler(buildSandboxReaperRequest())).json();
    assert.equal(payload.reaped, ageMinutes === 11 ? 1 : 0);
  });
}
