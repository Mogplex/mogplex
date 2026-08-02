import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxStopRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxStopRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

test("POST /api/sandbox/[id]/stop marks the sandbox stopped even when remote control cannot be resolved", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  let loadCount = 0;
  const stopCalls: Array<{
    id: string;
    sandboxId?: string;
    stopReason?: string | null;
  }> = [];

  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () => {
      loadCount += 1;
      return loadCount === 1
        ? buildLoadedSandboxStopRecord()
        : buildLoadedSandboxStopRecord({
            status: "stopped",
            health_status: "stopped",
          });
    }) as never,
    resolveLoadedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure() as never,
    stopSandboxRecord: async (id, options) => {
      stopCalls.push({
        id,
        sandboxId: options?.expectedSandboxId,
        stopReason: options?.stopReason,
      });
      return { id } as never;
    },
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(stopCalls, [
    { id: "sandbox-1", sandboxId: "vm_123", stopReason: "manual" },
  ]);
  const payload = await response.json();
  assert.equal(payload.sandbox.runtime_summary.status, "stopped");
  assert.equal(payload.sandbox.runtime_summary.health_status, "stopped");
});

test("POST /api/sandbox/[id]/stop falls back to a row-only stop when sandbox id drifted", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  const stopCalls: Array<{
    id: string;
    sandboxId?: string;
    stopReason?: string | null;
  }> = [];

  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({
        status: stopCalls.length > 0 ? "stopped" : "running",
        health_status: stopCalls.length > 0 ? "stopped" : "running",
      })) as never,
    resolveLoadedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure() as never,
    stopSandboxRecord: async (id, options) => {
      stopCalls.push({
        id,
        sandboxId: options?.expectedSandboxId,
        stopReason: options?.stopReason,
      });
      return stopCalls.length === 1 ? null : ({ id } as never);
    },
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(stopCalls, [
    { id: "sandbox-1", sandboxId: "vm_123", stopReason: "manual" },
    { id: "sandbox-1", sandboxId: undefined, stopReason: "manual" },
  ]);
  const payload = await response.json();
  assert.equal(payload.sandbox.runtime_summary.status, "stopped");
});

test("POST /api/sandbox/[id]/stop best-effort stops the remote sandbox before updating the row", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  let remoteStopCount = 0;

  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          remoteStopCount += 1;
        },
      }) as never,
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(remoteStopCount, 1);
});

test("POST /api/sandbox/[id]/stop deletes a paused sandbox's resources and marks record stopped", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  const stopCalls: Array<{
    id: string;
    fromStatuses: unknown;
    stopReason?: string | null;
  }> = [];
  let deleteCount = 0;

  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({
        status: stopCalls.length > 0 ? "stopped" : "paused",
        health_status: stopCalls.length > 0 ? "stopped" : "paused",
      })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        delete: async () => {
          deleteCount += 1;
        },
      }) as never,
    stopSandboxRecord: async (id, options) => {
      stopCalls.push({
        id,
        fromStatuses: options?.fromStatuses,
        stopReason: options?.stopReason,
      });
      return { id } as never;
    },
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  // delete() releases both the VM snapshot and the sandbox name so the
  // user stops paying for retained storage.
  assert.equal(deleteCount, 1);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].stopReason, "manual");
  assert.ok(
    Array.isArray(stopCalls[0]?.fromStatuses) &&
      stopCalls[0].fromStatuses.includes("paused"),
    "stopSandboxRecord must allow transitioning from paused"
  );
});

test("POST /api/sandbox/[id]/stop can operate while auto-pause is pausing", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  const stopCalls: Array<{
    id: string;
    fromStatuses: unknown;
    stopReason?: string | null;
  }> = [];
  let deleteCount = 0;

  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({
        status: stopCalls.length > 0 ? "stopped" : "pausing",
        health_status: stopCalls.length > 0 ? "stopped" : "pausing",
      })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        delete: async () => {
          deleteCount += 1;
        },
      }) as never,
    stopSandboxRecord: async (id, options) => {
      stopCalls.push({
        id,
        fromStatuses: options?.fromStatuses,
        stopReason: options?.stopReason,
      });
      return { id } as never;
    },
    updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(deleteCount, 1);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].stopReason, "manual");
  assert.ok(
    Array.isArray(stopCalls[0]?.fromStatuses) &&
      stopCalls[0].fromStatuses.includes("pausing"),
    "stopSandboxRecord must allow transitioning from pausing"
  );
  const payload = await response.json();
  assert.equal(payload.sandbox.runtime_summary.status, "stopped");
});

test("POST /api/sandbox/[id]/stop logs and continues when stop metadata persistence fails", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  let loadCount = 0;
  const errors: Array<Parameters<typeof console.error>> = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    errors.push(args);
  };

  try {
    const handler = createSandboxStopHandler({
      loadOwnedSandboxRouteRecord: (async () => {
        loadCount += 1;
        return loadCount === 1
          ? buildLoadedSandboxStopRecord()
          : buildLoadedSandboxStopRecord({
              status: "stopped",
              health_status: "stopped",
            });
      }) as never,
      resolveLoadedSandboxRouteContext: async () =>
        buildSandboxRouteContextFailure() as never,
      stopSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      updateSandboxRecord: async () => {
        throw new Error("stop metadata write failed");
      },
    });

    const response = await handler(
      buildSandboxRouteRequest({ method: "POST", suffix: "/stop" }),
      buildSandboxRouteParams()
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sandbox.runtime_summary.status, "stopped");
    assert.equal(payload.sandbox.error_summary.current_error, null);
    assert.equal(errors.length, 2);
    assert.match(String(errors[1]?.[0]), /Failed to persist stop metadata/);
  } finally {
    console.error = originalConsoleError;
  }
});
