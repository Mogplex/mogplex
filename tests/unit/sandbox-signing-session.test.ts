import assert from "node:assert/strict";
import test from "node:test";
import { captureLegacyWorkspaceSnapshot } from "../../app/api/sandbox/[id]/restart/_lib/legacy-snapshot";
import type { SandboxRestartDeps } from "../../app/api/sandbox/[id]/restart/_lib/types";

for (const status of ["running", "stopped"] as const) {
  test(`signing snapshot uses the existing ${status} session without auto-resume`, async () => {
    let wakes = 0;
    let commands = 0;
    let captures = 0;
    const session = {
      status,
      sessionId: "original-session",
      runCommand: async () => {
        commands++;
        return { exitCode: 0 };
      },
      snapshot: async () => {
        captures++;
        return { snapshotId: "safe-snapshot" };
      },
    };
    const sandbox = {
      currentSession: () => session,
      runCommand: async () => {
        wakes++;
        return { exitCode: 0 };
      },
      snapshot: async () => {
        wakes++;
        return { snapshotId: "resumed-snapshot" };
      },
    };
    const result = await captureLegacyWorkspaceSnapshot({
      recordId: "sandbox-1",
      userId: "user-1",
      sandboxId: "provider-1",
      snapshotProjectId: null,
      snapshotTeamId: null,
      credentials: {
        vercelToken: "fixture-token",
        vercelProjectId: "fixture-project",
      },
      deps: {
        getSandbox: async () => sandbox,
        prepareSandboxBillingClose: async () => null,
        updateSandboxRecord: async () => ({ id: "sandbox-1" }),
      } as unknown as SandboxRestartDeps,
    });
    assert.equal(
      wakes,
      0,
      "never use SDK methods that automatically resume a VM"
    );
    assert.equal(commands, status === "running" ? 1 : 0);
    assert.equal(captures, status === "running" ? 1 : 0);
    assert.equal(result, status === "running" ? "safe-snapshot" : null);
  });
}

test("failed capture restores signing through the pinned session", async () => {
  let wakes = 0;
  let restored = false;
  const session = {
    status: "running",
    sessionId: "original-session",
    runCommand: async () => ({ exitCode: 0 }),
    snapshot: async () => {
      throw new Error("capture failed");
    },
    writeFiles: async () => {
      restored = true;
    },
  };
  const sandbox = {
    currentSession: () => session,
    runCommand: async () => {
      wakes++;
      return { exitCode: 0 };
    },
    snapshot: async () => {
      wakes++;
      throw new Error("capture failed");
    },
    writeFiles: async () => {
      wakes++;
    },
  };
  const result = await captureLegacyWorkspaceSnapshot({
    recordId: "sandbox-1",
    userId: "user-1",
    sandboxId: "provider-1",
    snapshotProjectId: null,
    snapshotTeamId: null,
    credentials: {
      vercelToken: "fixture-token",
      vercelProjectId: "fixture-project",
    },
    deps: {
      getSandbox: async () => sandbox,
      prepareSandboxBillingClose: async () => null,
      setupSandboxCommitSigning: async (
        input: Parameters<SandboxRestartDeps["setupSandboxCommitSigning"]>[0]
      ) => {
        await input.sandbox.writeFiles([]);
        return { status: "configured" };
      },
    } as unknown as SandboxRestartDeps,
  });
  assert.equal(result, null);
  assert.equal(
    wakes,
    0,
    "recovery cannot resume a stopped VM through a mutable handle"
  );
  assert.equal(restored, true);
});
