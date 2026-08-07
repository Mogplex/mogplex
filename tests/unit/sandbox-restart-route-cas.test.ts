import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  readStreamBody,
} from "./sandbox-record-route-test-harness";
import {
  buildLoadedPersistentRestartContext,
  buildPersistedPersistentRestartRecord,
  type PersistentRestartRecord,
} from "./helpers/sandbox-restart-route-fixtures";

test("POST /api/sandbox/[id]/restart emits cancelled when installing CAS fails", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  let resolvedEnv = false;
  let bootstrapped = false;
  let stopCalls = 0;

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async () => ({
      ok: true as const,
      auth: { userId: "user-1" },
      repo: null,
      rootDirectory: undefined,
      record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
    })) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext()) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
        currentSession: () => ({
          stoppedAt: new Date("2026-08-05T11:10:00.000Z"),
        }),
      }) as never,
    updateSandboxRecord: async () => null,
    resolveRepoSandboxEnv: (async () => {
      resolvedEnv = true;
      return { envVars: {}, sync: { mode: "sandbox-only" } };
    }) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      bootstrapped = true;
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.match(body, /"reason":"conflict"/);
  assert.equal(resolvedEnv, false);
  assert.equal(bootstrapped, false);
  assert.equal(stopCalls, 2);
});

test("POST /api/sandbox/[id]/restart emits cancelled and not ready when running CAS fails", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  let stopCalls = 0;

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async () => ({
      ok: true as const,
      auth: { userId: "user-1" },
      repo: null,
      rootDirectory: undefined,
      record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
    })) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext()) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
        currentSession: () => ({
          stoppedAt: new Date("2026-08-05T11:10:00.000Z"),
        }),
      }) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => {
      if ((updates as { status?: string }).status === "running") {
        return null;
      }
      return buildPersistedPersistentRestartRecord(
        updates as Partial<PersistentRestartRecord>
      );
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"ready"/);
  assert.equal(stopCalls, 2);
});

test("POST /api/sandbox/[id]/restart emits cancelled and not ready when preview_url CAS fails", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  let stopCalls = 0;

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async () => ({
      ok: true as const,
      auth: { userId: "user-1" },
      repo: null,
      rootDirectory: undefined,
      record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
    })) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext()) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
        currentSession: () => ({
          stoppedAt: new Date("2026-08-05T11:10:00.000Z"),
        }),
      }) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => {
      if ("preview_url" in updates) {
        return null;
      }
      return buildPersistedPersistentRestartRecord(
        updates as Partial<PersistentRestartRecord>
      );
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "preview_url", url: "https://preview.example.com" };
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"preview_url"/);
  assert.doesNotMatch(body, /"type":"ready"/);
  assert.equal(stopCalls, 2);
});

test("POST /api/sandbox/[id]/restart guards bootstrap error writes after late stop/delete", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const updateCalls: Array<{
    updates: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];
  let providerStops = 0;
  let billingFinalizations = 0;

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async () => ({
      ok: true as const,
      auth: { userId: "user-1" },
      repo: null,
      rootDirectory: undefined,
      record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
    })) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext({ status: "paused" })) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-restart-1",
    })) as never,
    releaseLimitClaim: (async () => {
      throw new Error("bootstrap errors should preserve consumed claims");
    }) as never,
    getSandbox: async () =>
      ({
        stop: async () => {
          providerStops += 1;
        },
        currentSession: () => ({
          stoppedAt: new Date("2026-08-05T11:10:00.000Z"),
        }),
      }) as never,
    prepareSandboxBillingClose: async () => ({
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "user-1",
    }),
    finalizeSandboxBillingClose: async () => {
      billingFinalizations += 1;
      return { finalized: true, metered: true };
    },
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>,
      options: Record<string, unknown> | undefined
    ) => {
      updateCalls.push({ updates, options });
      if ((updates as { status?: string }).status === "error") {
        return null;
      }
      return buildPersistedPersistentRestartRecord(
        updates as Partial<PersistentRestartRecord>
      );
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield* [] as Array<{ type: "status"; status: "running" }>;
      throw new Error("dev server failed");
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  const body = await readStreamBody(response);
  const errorWrite = updateCalls.find(
    (call) => call.updates.status === "error"
  );
  assert.deepEqual(errorWrite?.options, {
    expectedSandboxId: "vm_123",
    fromStatuses: ["installing", "running"],
  });
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"error"/);
  assert.equal(providerStops, 1);
  assert.equal(billingFinalizations, 1);
});
