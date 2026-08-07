import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxDeleteRecord } from "./sandbox-record-route-test-harness/record-builders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  loadSandboxRecordRouteModule,
} from "./sandbox-record-route-test-harness";

test("DELETE /api/sandbox/[id] keeps the row for reaper cleanup when remote control cannot be resolved", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];
  const stopped: Array<{
    id: string;
    healthStatus?: string;
    additionalUpdates?: Record<string, unknown>;
  }> = [];
  const updates: Array<{ id: string; updates: Record<string, unknown> }> = [];

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async () =>
      buildSandboxRouteContextFailure() as never,
    deleteSandboxRecord: (async (
      id: string,
      options?: { userId?: string; expectedSandboxId?: string }
    ) => {
      deleted.push({
        id,
        userId: options?.userId,
        sandboxId: options?.expectedSandboxId,
      });
      return { id } as never;
    }) as never,
    stopSandboxRecord: async (id, options) => {
      stopped.push({
        id,
        healthStatus: options?.healthStatus,
        additionalUpdates: options?.additionalUpdates,
      });
      return { id } as never;
    },
    updateSandboxRecord: async (id, nextUpdates) => {
      updates.push({ id, updates: nextUpdates });
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, []);
  assert.deepEqual(stopped, []);
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "error",
        health_status: "error",
        error:
          "Remote VM vm_123 could not be deleted: credentials unresolvable. Record kept for reaper cleanup.",
      },
    },
  ]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
    warning:
      "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
  });
});

test("DELETE /api/sandbox/[id] preserves persistent rows when only stop fallback is available", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];
  const stopped: string[] = [];
  const updates: Array<{ id: string; updates: Record<string, unknown> }> = [];
  let remoteStopCount = 0;

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord({ persistent: true })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          remoteStopCount += 1;
        },
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
      }) as never,
    deleteSandboxRecord: (async (
      id: string,
      options?: { userId?: string; expectedSandboxId?: string }
    ) => {
      deleted.push({
        id,
        userId: options?.userId,
        sandboxId: options?.expectedSandboxId,
      });
      return { id } as never;
    }) as never,
    stopSandboxRecord: async (id) => {
      stopped.push(id);
      return { id: "sandbox-1" } as never;
    },
    updateSandboxRecord: async (id, nextUpdates) => {
      updates.push({ id, updates: nextUpdates });
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(remoteStopCount, 1);
  assert.deepEqual(deleted, []);
  assert.deepEqual(stopped, []);
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "paused",
        health_status: "paused",
        error:
          "Remote VM vm_123 could not be deleted because delete() is unavailable. VM was stopped, but persistent resources may remain. Record kept for reaper cleanup.",
      },
    },
  ]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
    warning:
      "Remote VM was stopped but persistent resources could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
  });
});

test("DELETE /api/sandbox/[id] preserves persistent rows for reaper cleanup when getSandbox fails", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];
  const stopped: string[] = [];
  const updates: Array<{ id: string; updates: Record<string, unknown> }> = [];

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord({ persistent: true })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () => {
      throw new Error("api unavailable");
    },
    deleteSandboxRecord: (async (
      id: string,
      options?: { userId?: string; expectedSandboxId?: string }
    ) => {
      deleted.push({
        id,
        userId: options?.userId,
        sandboxId: options?.expectedSandboxId,
      });
      return { id } as never;
    }) as never,
    stopSandboxRecord: async (id) => {
      stopped.push(id);
      return { id } as never;
    },
    updateSandboxRecord: async (id, nextUpdates) => {
      updates.push({ id, updates: nextUpdates });
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, []);
  assert.deepEqual(stopped, []);
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "paused",
        health_status: "paused",
        error:
          "Remote VM vm_123 could not be deleted: api unavailable. Record kept for reaper cleanup.",
      },
    },
  ]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
    warning:
      "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
  });
});

test("DELETE /api/sandbox/[id] returns warning when persistent cleanup bookkeeping fails", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];
  let updateAttempts = 0;

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord({ persistent: true })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () => {
      throw new Error("api unavailable");
    },
    deleteSandboxRecord: (async (
      id: string,
      options?: { userId?: string; expectedSandboxId?: string }
    ) => {
      deleted.push({
        id,
        userId: options?.userId,
        sandboxId: options?.expectedSandboxId,
      });
      return { id } as never;
    }) as never,
    updateSandboxRecord: async () => {
      updateAttempts += 1;
      throw new Error("update failed");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(updateAttempts, 1);
  assert.deepEqual(deleted, []);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
    warning:
      "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
  });
});

test("DELETE /api/sandbox/[id] preserves the row when remote delete cannot be verified", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];
  const stopped: Array<{
    id: string;
    healthStatus?: string;
    additionalUpdates?: Record<string, unknown>;
  }> = [];
  const updates: Array<{ id: string; updates: Record<string, unknown> }> = [];

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        delete: async () => {
          throw new Error("delete failed");
        },
        stop: async () => {
          throw new Error("stop should not run after delete failure");
        },
      }) as never,
    deleteSandboxRecord: (async (
      id: string,
      options?: { userId?: string; expectedSandboxId?: string }
    ) => {
      deleted.push({
        id,
        userId: options?.userId,
        sandboxId: options?.expectedSandboxId,
      });
      return { id } as never;
    }) as never,
    stopSandboxRecord: async (id, options) => {
      stopped.push({
        id,
        healthStatus: options?.healthStatus,
        additionalUpdates: options?.additionalUpdates,
      });
      return { id } as never;
    },
    updateSandboxRecord: async (id, nextUpdates) => {
      updates.push({ id, updates: nextUpdates });
      return { id } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, []);
  assert.deepEqual(stopped, []);
  assert.deepEqual(updates, [
    {
      id: "sandbox-1",
      updates: {
        status: "error",
        health_status: "error",
        error:
          "Remote VM vm_123 could not be deleted: delete failed. Record kept for reaper cleanup.",
      },
    },
  ]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
    warning:
      "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
  });
});
