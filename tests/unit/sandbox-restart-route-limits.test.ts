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
