import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxStopRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxPauseRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

test("POST /api/sandbox/[id]/pause stops the VM (auto-snapshot) and marks record paused", async () => {
  const { createSandboxPauseHandler } = await loadSandboxPauseRouteModule();
  let stopCount = 0;
  const updateCalls: Array<Record<string, unknown>> = [];
  let loadCount = 0;

  const handler = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: (async () => {
      loadCount += 1;
      return loadCount === 1
        ? buildLoadedSandboxStopRecord({ status: "running" })
        : buildLoadedSandboxStopRecord({
            status: "paused",
            health_status: "paused",
            snapshot_id: "snap_abc",
          });
    }) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          stopCount += 1;
        },
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
        currentSnapshotId: "snap_abc",
      }) as never,
    updateSandboxRecord: async (_id, updates) => {
      updateCalls.push(updates);
      return { id: "sandbox-1" } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/pause" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(stopCount, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].status, "paused");
  assert.equal(updateCalls[0].health_status, "paused");
  assert.equal(updateCalls[0].snapshot_id, "snap_abc");
  const payload = await response.json();
  assert.equal(payload.sandbox.runtime_summary.status, "paused");
});

test("POST /api/sandbox/[id]/pause rejects when sandbox is not running", async () => {
  const { createSandboxPauseHandler } = await loadSandboxPauseRouteModule();
  let snapshotAttempts = 0;

  const handler = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({ status: "stopped" })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        snapshot: async () => {
          snapshotAttempts += 1;
          return { snapshotId: "should-not-happen" };
        },
      }) as never,
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/pause" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  assert.equal(snapshotAttempts, 0);
  const payload = await response.json();
  assert.match(payload.error, /not running/i);
});

test("POST /api/sandbox/[id]/pause rejects when sandbox is still booting", async () => {
  const { createSandboxPauseHandler } = await loadSandboxPauseRouteModule();

  const handler = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({
        status: "running",
        sandbox_id: "pending",
      })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () => ({ snapshot: async () => ({}) }) as never,
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/pause" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
});

test("POST /api/sandbox/[id]/pause surfaces credential failure from context resolution", async () => {
  const { createSandboxPauseHandler } = await loadSandboxPauseRouteModule();

  const handler = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({ status: "running" })) as never,
    resolveLoadedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure({
        status: 400,
        error: "Missing Vercel credentials",
      }) as never,
    getSandbox: async () => ({ snapshot: async () => ({}) }) as never,
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/pause" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Missing Vercel credentials/);
});

test("POST /api/sandbox/[id]/pause reports 500 when stop throws", async () => {
  const { createSandboxPauseHandler } = await loadSandboxPauseRouteModule();

  const handler = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({ status: "running" })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          throw new Error("snapshot quota exceeded");
        },
        currentSnapshotId: undefined,
      }) as never,
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/pause" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.match(payload.error, /snapshot quota exceeded/);
});
