import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  readStreamBody,
} from "./sandbox-record-route-test-harness";
import {
  buildLoadedPersistentRestartContext,
  buildPersistedPersistentRestartRecord,
  type PersistentRestartRecord,
} from "./helpers/sandbox-restart-route-fixtures";

test("POST /api/sandbox/[id]/restart falls back to legacy restart when the stored persistent row is ephemeral in Vercel", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const getSandboxOptions: Array<{ resume?: boolean }> = [];
  const releasedClaims: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const fetchBodies: unknown[] = [];

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async (
      _request: Request,
      _id: string,
      options?: { select?: string }
    ) => {
      if (options?.select === "id, sandbox_id, persistent") {
        return {
          ok: true as const,
          auth: { userId: "user-1" },
          repo: null,
          rootDirectory: undefined,
          record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
        };
      }
      return buildLoadedSandboxRestartRecord() as never;
    }) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext({ status: "paused" })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-restart-1",
    })) as never,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
    getSandbox: (async (
      _id: string,
      _credentials: unknown,
      options?: { resume?: boolean }
    ) => {
      getSandboxOptions.push(options ?? {});
      return {
        sandbox: { persistent: false },
        status: "stopped",
        snapshot: async () => {
          throw new Error("non-persistent stopped sandbox has no snapshot");
        },
        stop: async () => {},
      };
    }) as never,
    updateSandboxRecord: (async (
      _id: string,
      next: Record<string, unknown>
    ) => {
      updates.push(next);
      return { id: "sandbox-1" } as never;
    }) as never,
    stopSandboxRecord: (async () => ({ id: "sandbox-1" }) as never) as never,
    fetchImpl: async (_input, init) => {
      fetchBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(releasedClaims, ["claim-restart-1"]);
  assert.deepEqual(updates, [{ persistent: false }]);
  assert.deepEqual(fetchBodies, [
    {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "feature-a",
      createBranch: false,
    },
  ]);
  assert.deepEqual(
    getSandboxOptions.map((option) => option.resume),
    [false, false]
  );
});

test("POST /api/sandbox/[id]/restart logs when non-persistent demotion loses the CAS race", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const warnings: Array<Parameters<typeof console.warn>> = [];
  const originalConsoleWarn = console.warn;
  console.warn = (...args: Parameters<typeof console.warn>) => {
    warnings.push(args);
  };

  try {
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async (
        _request: Request,
        _id: string,
        options?: { select?: string }
      ) => {
        if (options?.select === "id, sandbox_id, persistent") {
          return {
            ok: true as const,
            auth: { userId: "user-1" },
            repo: null,
            rootDirectory: undefined,
            record: {
              id: "sandbox-1",
              sandbox_id: "vm_123",
              persistent: true,
            },
          };
        }
        return buildLoadedSandboxRestartRecord() as never;
      }) as never,
      loadOwnedSandboxRouteContext: (async () =>
        buildLoadedPersistentRestartContext({ status: "paused" })) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      enforceSandboxBootLimits: (async () => ({
        allowed: true,
        claimId: "claim-restart-1",
      })) as never,
      releaseLimitClaim: (async () => true) as never,
      getSandbox: (async () =>
        ({
          sandbox: { persistent: false },
          status: "stopped",
          snapshot: async () => {
            throw new Error("non-persistent stopped sandbox has no snapshot");
          },
          stop: async () => {},
        }) as never) as never,
      updateSandboxRecord: (async () => null) as never,
      stopSandboxRecord: (async () => ({ id: "sandbox-1" }) as never) as never,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }),
    });

    const response = await handler(
      buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
      buildSandboxRouteParams()
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.match(
      String(warnings[0]?.[0]),
      /skipped marking sandbox-1 as non-persistent/
    );
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test("POST /api/sandbox/[id]/restart logs and continues when snapshot metadata persistence fails", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const errors: Array<Parameters<typeof console.error>> = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const stopCalls: Array<{ id: string; sandboxId?: string }> = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    errors.push(args);
  };

  try {
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxRestartRecord()) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      getSandbox: async () =>
        ({
          snapshot: async () => ({ snapshotId: "snapshot-123" }),
          stop: async () => {},
        }) as never,
      stopSandboxRecord: async (id, options) => {
        stopCalls.push({ id, sandboxId: options?.expectedSandboxId });
        return { id } as never;
      },
      updateSandboxRecord: async () => {
        throw new Error("restart snapshot write failed");
      },
      fetchImpl: async (input, init) => {
        fetchCalls.push({ url: String(input), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      },
    });

    const response = await handler(
      buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
      buildSandboxRouteParams()
    );

    assert.equal(response.status, 200);
    assert.deepEqual(stopCalls, [{ id: "sandbox-1", sandboxId: "vm_123" }]);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(String(fetchCalls[0]?.init?.body)), {
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "feature-a",
      createBranch: false,
      restoreSnapshotId: "snapshot-123",
      restoreSnapshotProjectId: "project-1",
      restoreSnapshotTeamId: null,
    });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[0]), /Failed to persist snapshot metadata/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("POST /api/sandbox/[id]/restart finalizes the old session before waking the replacement", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const stoppedAt = new Date("2026-08-05T11:10:00.000Z");
  const events: unknown[] = [];

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
    getSandbox: (async (
      _id: string,
      _credentials: unknown,
      options?: { resume?: boolean }
    ) => {
      events.push(["get", options?.resume]);
      return {
        stop: async () => {
          events.push(["stop"]);
        },
        currentSession: () => ({ stoppedAt }),
      };
    }) as never,
    prepareSandboxBillingClose: async () => {
      events.push(["prepare"]);
      return {
        sessionId: "billing-session-1",
        closeGeneration: 1,
        actorUserId: "user-1",
      };
    },
    finalizeSandboxBillingClose: async (_attempt, endedAt) => {
      events.push(["finalize", endedAt]);
      return { finalized: true, metered: true };
    },
    requireSandboxBillingSession: async () => {
      events.push(["admit-replacement"]);
      return { metered: true, reason: "opened", sessionId: "billing-2" };
    },
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) =>
      buildPersistedPersistentRestartRecord(
        updates as Partial<PersistentRestartRecord>
      )) as never,
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
  await readStreamBody(response);
  assert.deepEqual(events.slice(0, 6), [
    ["get", false],
    ["prepare"],
    ["stop"],
    ["finalize", stoppedAt],
    ["get", true],
    ["admit-replacement"],
  ]);
});
