import assert from "node:assert/strict";
import test from "node:test";
import { createNativeSandboxExecution } from "../../lib/mogplex-api/native-sandbox-execution";
import { getDelegatedUserIdFromRequest } from "../../lib/internal-api-auth";
import { readActiveTeamIdHeader } from "../../lib/team-capabilities";
import {
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceAiAccess,
  buildSandboxServiceRouteAuth,
  loadSandboxExecRouteModule,
} from "./sandbox-service-route-test-harness";
import type { SandboxExecPostDeps } from "../../app/api/sandbox/[id]/exec/_lib/types";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function fixture() {
  const commands: string[] = [];
  let released = 0;
  const deps: Partial<SandboxExecPostDeps> = {
    getSandboxServiceCredentials: async (request, options) => {
      assert.equal(getDelegatedUserIdFromRequest(request!), "user-123");
      assert.equal(readActiveTeamIdHeader(request!), TEAM_ID);
      assert.equal(options?.requireCapability, "tools.bash");
      assert.equal(options?.teamId, TEAM_ID);
      return buildSandboxServiceRouteAuth();
    },
    loadOwnedSandboxRecord: async (id, userId) => {
      assert.equal(id, "record-1");
      assert.equal(userId, "user-123");
      return buildOwnedSandboxServiceRecord();
    },
    acquireSandboxExecLock: async () => ({ acquired: true, token: "lock-1" }),
    enforceSandboxExecLimits: async () => ({ allowed: true, status: 200 }),
    recordLimitDecision: async () => {},
    releaseSandboxExecLock: async () => {
      released++;
    },
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    syncTerminalRuntimeAuth: async () => ({ ok: true, logs: "" }),
    getSandbox: async () =>
      ({
        runCommand: async (input: { args?: string[] }) => {
          commands.push(input.args?.join(" ") ?? "");
          return {
            exitCode: 0,
            stdout: async () => "quiet-command-done",
            stderr: async () => "",
          };
        },
      }) as never,
  };
  return { deps, commands, released: () => released };
}

test("native commands execute through the authorized route in-process, not the 300-second HTTP hop", async () => {
  await loadSandboxExecRouteModule();
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.INTERNAL_API_SECRET = "fixture-secret";
  globalThis.fetch = async () => {
    throw new Error("HTTP invocation timed out after 300 seconds");
  };
  try {
    const f = fixture();
    const execution = createNativeSandboxExecution("user-123", TEAM_ID, f.deps);
    const response = await execution.execute(
      "record-1",
      {},
      { command: "sleep 330 && printf done" }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      exitCode: 0,
      stdout: "quiet-command-done",
      stderr: "",
      cwd: ".",
    });
    assert.equal(f.commands.length, 1);
    assert.match(f.commands[0], /sleep 330/);
    assert.equal(f.released(), 1);
    assert.equal(execution.retryOnSandboxLoss, false);
    const denied = await createNativeSandboxExecution("user-123", TEAM_ID, {
      ...f.deps,
      getSandboxServiceCredentials: async () => null,
    }).execute("record-1", {}, { command: "echo denied" });
    assert.equal(denied.status, 401);
    const foreign = await createNativeSandboxExecution("user-123", TEAM_ID, {
      ...f.deps,
      loadOwnedSandboxRecord: async () => null,
    }).execute("record-1", {}, { command: "echo foreign" });
    assert.equal(foreign.status, 404);
    assert.equal(f.commands.length, 1);
    const invalid = await execution.execute("record-1", {}, { command: "" });
    assert.equal(invalid.status, 400);
    assert.equal(f.commands.length, 1);
    const unavailable = await createNativeSandboxExecution(
      "user-123",
      TEAM_ID,
      {
        ...f.deps,
        getSandbox: async () => {
          throw new Error("Provider unavailable");
        },
      }
    ).execute("record-1", {}, { command: "echo unavailable" });
    assert.equal(unavailable.status, 500);
    assert.deepEqual(await unavailable.json(), {
      error: "Provider unavailable",
    });
    assert.equal(f.commands.length, 1);
    assert.equal(f.released(), 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = originalSecret;
  }
});
