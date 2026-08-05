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

type PersistentRestartRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo: {
    root_directory: string | null;
    dev_command: string | null;
    dev_port: number | null;
    dev_port_auto: boolean;
    runtime?: string | null;
    vercel_project_id: string | null;
    vercel_team_id: string | null;
  };
};

function buildLoadedPersistentRestartContext(
  overrides: Partial<PersistentRestartRecord> = {}
) {
  return {
    ok: true as const,
    auth: {
      userId: "user-1",
      vercelToken: "platform-token",
      vercelTeamId: null,
      vercelProjectId: "project-1",
      userVercelToken: null,
      userVercelTeamId: null,
    },
    repo: null,
    rootDirectory: undefined,
    context: {
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      },
    },
    sandbox: null,
    record: {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "feature-a",
      status: "running",
      health_status: "running",
      preview_url: "https://preview.example.com",
      snapshot_id: "snap_abc",
      runtime: "node22",
      terminal_cwd: null,
      root_directory: null,
      persistent: true,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:00:00.000Z",
      repo: {
        root_directory: null,
        dev_command: null,
        dev_port: 3000,
        dev_port_auto: true,
        runtime: "node22",
        vercel_project_id: "project-1",
        vercel_team_id: null,
      },
      ...overrides,
    },
  };
}

function buildPersistedPersistentRestartRecord(
  updates: Partial<PersistentRestartRecord> = {}
): PersistentRestartRecord {
  return {
    ...buildLoadedPersistentRestartContext().record,
    ...updates,
  };
}

test("POST /api/sandbox/[id]/restart denies inactive persistent wake before resuming the VM", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  let getSandboxCalls = 0;
  let updateCalls = 0;

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
      allowed: false,
      status: 429,
      code: "sandbox_boot_rate_limited",
      error: "Too many active sandboxes",
      reason: "active_sandbox_limit_exceeded",
      retryAfterSeconds: 15,
      limit: {
        name: "active_sandboxes",
        value: 3,
        windowSeconds: 0,
      },
    })) as never,
    getSandbox: async () => {
      getSandboxCalls += 1;
      return {} as never;
    },
    updateSandboxRecord: async () => {
      updateCalls += 1;
      return { id: "sandbox-1" } as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.equal(getSandboxCalls, 0);
  assert.equal(updateCalls, 0);
});

test("POST /api/sandbox/[id]/restart releases inactive wake claims when resuming the VM fails", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const releasedClaims: string[] = [];

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
    getSandbox: async () => {
      throw new Error("vm unavailable");
    },
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.match(payload.error, /vm unavailable/);
  assert.deepEqual(releasedClaims, ["claim-restart-1"]);
});

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

test("POST /api/sandbox/[id]/restart releases inactive wake claims when the state transition no-ops", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const releasedClaims: string[] = [];
  let resolveEnvCalls = 0;

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
    getSandbox: (async () => ({ stop: async () => {} }) as never) as never,
    updateSandboxRecord: async () => null,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
    resolveRepoSandboxEnv: (async () => {
      resolveEnvCalls += 1;
      return { envVars: {}, sync: { mode: "sandbox-only" } };
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/restart" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.deepEqual(releasedClaims, ["claim-restart-1"]);
  assert.equal(resolveEnvCalls, 0);
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

test("POST /api/sandbox/[id]/restart allows stopped persistent records to restart", async () => {
  const { createSandboxRestartHandler } = await loadSandboxRestartRouteModule();
  const updateOptions: Array<Record<string, unknown> | undefined> = [];
  const restartRootDirectory = "apps/web";
  const restartTerminalCwd = "/workspace/apps/web";

  const handler = createSandboxRestartHandler({
    loadOwnedSandboxRouteRecord: (async () => ({
      ok: true as const,
      auth: { userId: "user-1" },
      repo: null,
      rootDirectory: undefined,
      record: { id: "sandbox-1", sandbox_id: "vm_123", persistent: true },
    })) as never,
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedPersistentRestartContext({
        status: "stopped",
        root_directory: restartRootDirectory,
        terminal_cwd: restartTerminalCwd,
      })) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-restart-1",
    })) as never,
    getSandbox: async () =>
      ({
        stop: async () => {},
      }) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>,
      options: Record<string, unknown> | undefined
    ) => {
      updateOptions.push(options);
      return buildPersistedPersistentRestartRecord({
        status: "stopped",
        root_directory: restartRootDirectory,
        terminal_cwd: restartTerminalCwd,
        ...(updates as Partial<PersistentRestartRecord>),
      });
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
  assert.match(body, /"type":"ready"/);
  assert.match(body, /"root_directory":"apps\/web"/);
  assert.match(body, /"terminal_cwd":"\/workspace\/apps\/web"/);
  assert.ok(
    (updateOptions[0]?.fromStatuses as readonly string[] | undefined)?.includes(
      "stopped"
    ),
    "expected stopped to be allowed for the installing transition"
  );
  assert.equal(updateOptions[0]?.expectedSandboxId, "vm_123");
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
