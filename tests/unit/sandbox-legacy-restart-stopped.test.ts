import assert from "node:assert/strict";
import test from "node:test";
import { handleLegacyRestart } from "../../app/api/sandbox/[id]/restart/_lib/legacy-restart";
import type { SandboxRestartDeps } from "../../app/api/sandbox/[id]/restart/_lib/types";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { buildResolvedSandboxRouteContext } from "./sandbox-record-route-test-harness";

for (const scenario of [
  "success",
  "billing rejected",
  "concurrent stop",
] as const) {
  test(`stopped legacy restart preserves billing and session boundaries: ${scenario}`, async () => {
    const events: string[] = [];
    let status = "stopped";
    let sessionId = "old-session";
    const session = {
      get status() {
        return status;
      },
      get sessionId() {
        return sessionId;
      },
      stoppedAt: new Date("2026-11-17T16:00:00Z"),
      runCommand: async () => {
        assert.equal(status, "running");
        events.push("scrub");
        return { exitCode: 0 };
      },
      snapshot: async () => {
        events.push("snapshot");
        status = "stopped";
        return { snapshotId: "saved-snapshot" };
      },
    };
    const sandbox = {
      currentSession: () => session,
      runCommand: async () => assert.fail("must not auto-resume during scrub"),
      snapshot: async () => assert.fail("must not auto-resume during capture"),
    } as unknown as Awaited<ReturnType<SandboxRestartDeps["getSandbox"]>>;
    const deps = {
      loadOwnedSandboxRouteRecord: async () =>
        buildLoadedSandboxRestartRecord({ status: "stopped" }),
      resolveLoadedSandboxRouteContext: async (
        loaded: Parameters<
          SandboxRestartDeps["resolveLoadedSandboxRouteContext"]
        >[0]
      ) => buildResolvedSandboxRouteContext(loaded),
      getSandbox: async (
        _id: string,
        _credentials: unknown,
        options: Parameters<SandboxRestartDeps["getSandbox"]>[2]
      ) => {
        if (
          options?.resume &&
          status === "stopped" &&
          sessionId === "old-session"
        ) {
          events.push("resume");
          status = "running";
          sessionId = "resumed-session";
          await options.onResume?.(sandbox);
        }
        return sandbox;
      },
      requireSandboxBillingSession: async () => {
        events.push("admit");
        if (scenario === "billing rejected")
          throw new Error("admission failed");
        return {
          metered: true,
          reason: "opened",
          sessionId: "billing-resumed",
        };
      },
      prepareSandboxBillingClose: async () => {
        events.push("prepare");
        if (scenario === "concurrent stop") status = "stopped";
        return {
          sessionId: "billing-resumed",
          closeGeneration: 1,
          actorUserId: "user-1",
        };
      },
      finalizeSandboxBillingClose: async () => {
        events.push("finalize");
        return { finalized: true, metered: true };
      },
      updateSandboxRecord: async (
        _id: string,
        updates: { snapshot_id?: string }
      ) => {
        assert.equal(updates.snapshot_id, "saved-snapshot");
        events.push("persist");
        return { id: "sandbox-1" };
      },
      stopSandboxRecord: async () => {
        events.push("retire");
        return { id: "sandbox-1" };
      },
      fetchImpl: async (_url: string, init: RequestInit) => {
        assert.equal(
          JSON.parse(String(init.body)).restoreSnapshotId,
          "saved-snapshot"
        );
        events.push("launch");
        return Response.json({ restored: true });
      },
    } as unknown as SandboxRestartDeps;
    const response = await handleLegacyRestart(
      new Request("https://browser.example/api/sandbox/sandbox-1/restart", {
        method: "POST",
      }),
      "sandbox-1",
      deps
    );
    if (scenario === "success") {
      assert.equal(response.status, 200);
      assert.deepEqual(events, [
        "resume",
        "admit",
        "prepare",
        "scrub",
        "snapshot",
        "persist",
        "finalize",
        "retire",
        "launch",
      ]);
    } else if (scenario === "billing rejected") {
      assert.equal(response.status, 503);
      assert.deepEqual(events, ["resume", "admit"]);
    } else {
      assert.equal(response.status, 409);
      assert.deepEqual(events, ["resume", "admit", "prepare", "finalize"]);
    }
  });
}
