import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxStopRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxStopRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

for (const status of ["running", "stopped"]) {
  test(`Stop retains a persistent ${status} workspace and its saved snapshot`, async () => {
    const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
    let stopped = 0;
    let deleted = 0;
    let recorded = false;
    const updates: Record<string, unknown>[] = [];
    const handler = createSandboxStopHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxStopRecord({
          status: recorded ? "stopped" : "running",
        })) as never,
      resolveLoadedSandboxRouteContext: (async () =>
        buildResolvedSandboxRouteContext(
          buildLoadedSandboxStopRecord()
        )) as never,
      getSandbox: (async () => ({
        persistent: true,
        status,
        currentSnapshotId: "saved-snapshot",
        stop: async () => {
          stopped += 1;
        },
        delete: async () => {
          deleted += 1;
        },
        currentSession: () => ({ stoppedAt: new Date() }),
        runCommand: async () => {
          throw new Error(
            "Persistent files do not need a destructive-stop guard"
          );
        },
      })) as never,
      stopSandboxRecord: async () => {
        recorded = true;
        return { id: "sandbox-1" } as never;
      },
      updateSandboxRecord: async (_id, update) => {
        updates.push(update);
        return { id: "sandbox-1" } as never;
      },
    });
    const response = await handler(
      buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 200);
    assert.equal(stopped, status === "running" ? 1 : 0);
    assert.equal(deleted, 0);
    assert.equal(recorded, true);
    assert.equal(updates[0]?.snapshot_id, "saved-snapshot");
  });
}
