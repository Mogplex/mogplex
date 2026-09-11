import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxStopRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxStopRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceAiAccess,
  buildSandboxServiceRouteAuth,
  loadSandboxExecRouteModule,
} from "./sandbox-service-route-test-harness";
import {
  buildBaseSandboxContext,
  buildDefaultDeps,
  buildTreeRouteRequest,
} from "./helpers/sandbox-tree-route-fixtures";

async function fixture(
  options: {
    stdout?: string;
    exitCode?: number;
    deleteSandbox?: () => Promise<void>;
  } = {}
) {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  const { withSandboxMutationLock } =
    await import("@/lib/sandbox/mutation-lock");
  let locked = false;
  let deleted = false;
  let status = "running";
  let inspected = 0;
  const lockDeps = {
    acquireSandboxExecLock: async () => {
      if (locked) return { acquired: false as const, retryAfterSeconds: 1 };
      locked = true;
      return { acquired: true as const, token: "shared-token" };
    },
    releaseSandboxExecLock: async () => {
      locked = false;
    },
  };
  const withLock = (id: string, operation: () => Promise<Response>) =>
    withSandboxMutationLock(id, operation, lockDeps);
  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({ status })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    getSandbox: async () =>
      ({
        runCommand: async () => {
          inspected++;
          return {
            exitCode: options.exitCode ?? 0,
            stdout: async () => options.stdout ?? "",
            stderr: async () => "inspection failed",
          };
        },
        delete: async () => {
          await options.deleteSandbox?.();
          deleted = true;
        },
      }) as never,
    stopSandboxRecord: async () => {
      status = "stopped";
      return { id: "sandbox-1" } as never;
    },
    withSandboxMutationLock: withLock,
  });
  return {
    lockDeps,
    withLock,
    state: () => ({ locked, deleted, inspected }),
    stop: (discardChanges = false) =>
      handler(
        buildSandboxRouteRequest({
          method: "POST",
          suffix: "/stop",
          init: {
            body: JSON.stringify({ discardChanges }),
            headers: { "Content-Type": "application/json" },
          },
        }),
        buildSandboxRouteParams()
      ),
  };
}

test("guarded stop excludes commands and file mutations from inspection through provider shutdown", async () => {
  const deleting = Promise.withResolvers<void>();
  const finishDelete = Promise.withResolvers<void>();
  const f = await fixture({
    deleteSandbox: async () => {
      deleting.resolve();
      await finishDelete.promise;
    },
  });
  const stop = f.stop();
  await deleting.promise;
  try {
    assert.equal(f.state().locked, true);
    const { createSandboxExecPostHandler } = await loadSandboxExecRouteModule();
    let writes = 0;
    const exec = createSandboxExecPostHandler({
      getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
      loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
      ...f.lockDeps,
      recordLimitDecision: async () => {},
      enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
      resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
      getSandbox: async () => {
        writes++;
        throw new Error("must not reach provider");
      },
    });
    const execResponse = await exec(
      buildSandboxRouteRequest({
        method: "POST",
        suffix: "/exec",
        init: { body: JSON.stringify({ command: "touch work.txt" }) },
      }),
      buildSandboxRouteParams()
    );
    assert.equal(execResponse.status, 429);

    const { createSandboxFilePutHandler } =
      await import("../../app/api/sandbox/[id]/files/route");
    const context = buildBaseSandboxContext({
      writeFiles: async () => {
        writes++;
      },
    });
    const deps = {
      ...buildDefaultDeps(context),
      withSandboxMutationLock: f.withLock,
    };
    const put = createSandboxFilePutHandler(deps);
    const putResponse = await put(
      new Request("http://localhost/api/sandbox/sandbox-1/files", {
        method: "PUT",
        body: JSON.stringify({ path: "work.txt", content: "new work" }),
      }),
      buildSandboxRouteParams()
    );
    assert.equal(putResponse.status, 409);

    const tree = await import("../../app/api/sandbox/[id]/tree/route");
    for (const [handler, method, body] of [
      [
        tree.createSandboxTreePostHandler(deps),
        "POST",
        { kind: "file", path: "new.ts" },
      ],
      [
        tree.createSandboxTreePatchHandler(deps),
        "PATCH",
        { moves: [{ fromPath: "old.ts", toPath: "new.ts" }] },
      ],
      [tree.createSandboxTreeDeleteHandler(deps), "DELETE", { path: "old.ts" }],
    ] as const) {
      const response = await handler(
        buildTreeRouteRequest(method, body),
        buildSandboxRouteParams()
      );
      assert.equal(response.status, 409);
    }
    assert.equal(writes, 0);
    assert.equal((await f.stop()).status, 409);
    assert.equal(f.state().inspected, 1);
  } finally {
    finishDelete.resolve();
    await stop;
  }
  assert.deepEqual(f.state(), { locked: false, deleted: true, inspected: 1 });
});

test("a busy command prevents guarded shutdown before inspection", async () => {
  const f = await fixture();
  await f.lockDeps.acquireSandboxExecLock();
  const response = await f.stop();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "sandbox_busy");
  assert.deepEqual(f.state(), { locked: true, deleted: false, inspected: 0 });
});

for (const [stdout, exitCode, reason] of [
  [" M work.txt\n", 0, "uncommitted_changes"],
  ["", 1, "inspection_unavailable"],
] as const) {
  test(`final shutdown inspection fails safely for ${reason}`, async () => {
    const f = await fixture({ stdout, exitCode });
    const response = await f.stop();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, reason);
    assert.deepEqual(f.state(), {
      locked: false,
      deleted: false,
      inspected: 1,
    });
    assert.equal((await f.stop(true)).status, 200);
    assert.deepEqual(f.state(), { locked: false, deleted: true, inspected: 1 });
  });
}
