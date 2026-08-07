import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxDeleteRecord } from "./sandbox-record-route-test-harness/record-builders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  loadSandboxRecordRouteModule,
} from "./sandbox-record-route-test-harness";

test("DELETE /api/sandbox/[id] falls back to a row-only delete when sandbox id drifted", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const deleted: Array<{ id: string; userId?: string; sandboxId?: string }> =
    [];

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        delete: async () => {},
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
      return deleted.length === 1 ? null : ({ id } as never);
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, [
    { id: "sandbox-1", userId: "user-1", sandboxId: "vm_123" },
    { id: "sandbox-1", userId: "user-1", sandboxId: undefined },
  ]);
});

test("DELETE /api/sandbox/[id] deletes the remote sandbox before deleting the row", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const events: string[] = [];
  let remoteStopCount = 0;
  let remoteDeleteCount = 0;

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        delete: async () => {
          remoteDeleteCount += 1;
          events.push("remote-delete");
        },
        stop: async () => {
          remoteStopCount += 1;
          events.push("remote-stop");
        },
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
      }) as never,
    deleteSandboxRecord: (async () => {
      events.push("db-delete");
      return { id: "sandbox-1" } as never;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(remoteDeleteCount, 1);
  assert.equal(remoteStopCount, 0);
  assert.deepEqual(events, ["remote-delete", "db-delete"]);
});

test("DELETE /api/sandbox/[id] caps provider-not-found billing before deleting the row", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const meteredThroughAt = new Date("2026-08-05T11:04:00.000Z");
  const finalizedAt: Date[] = [];
  let deleted = false;
  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () => {
      throw Object.assign(new Error("Sandbox not found"), { status: 404 });
    },
    prepareSandboxBillingClose: async () => ({
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "user-1",
      meteredThroughAt,
    }),
    finalizeSandboxBillingClose: async (_attempt, endedAt) => {
      finalizedAt.push(endedAt);
      return { finalized: true, metered: true };
    },
    deleteSandboxRecord: async () => {
      deleted = true;
      return { id: "sandbox-1" } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(finalizedAt, [meteredThroughAt]);
  assert.equal(deleted, true);
});

test("DELETE /api/sandbox/[id] falls back to stop when delete is unavailable", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const events: string[] = [];
  let remoteStopCount = 0;

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          remoteStopCount += 1;
          events.push("remote-stop");
        },
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
      }) as never,
    stopSandboxRecord: async () => {
      events.push("db-stop");
      return { id: "sandbox-1" } as never;
    },
    deleteSandboxRecord: (async () => {
      events.push("db-delete");
      return { id: "sandbox-1" } as never;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(remoteStopCount, 1);
  assert.deepEqual(events, ["remote-stop", "db-stop", "db-delete"]);
});

test("DELETE /api/sandbox/[id] still deletes the row when stop bookkeeping fails after fallback", async () => {
  const { createSandboxDeleteHandler } = await loadSandboxRecordRouteModule();
  const events: string[] = [];

  const handler = createSandboxDeleteHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxDeleteRecord()) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          events.push("remote-stop");
        },
        currentSession: () => ({
          updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        }),
      }) as never,
    stopSandboxRecord: async () => {
      events.push("db-stop");
      throw new Error("stop write failed");
    },
    deleteSandboxRecord: (async () => {
      events.push("db-delete");
      return { id: "sandbox-1" } as never;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "DELETE" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(events, ["remote-stop", "db-stop", "db-delete"]);
  assert.deepEqual(await response.json(), {
    ok: true,
    sandboxId: "sandbox-1",
  });
});
