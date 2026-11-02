import assert from "node:assert/strict";
import test from "node:test";
import { withSandboxMutationLock } from "../../lib/sandbox/mutation-lock";
import { buildLoadedSandboxStopRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxStopRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  buildResolvedSandboxRouteContext,
} from "./sandbox-record-route-test-harness";

for (const active of [
  "ai_call",
  "worker",
  "attached_client",
  "unknown",
] as const) {
  test(`automatic task cleanup preserves compute with ${active} activity`, async () => {
    const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
    let locked = false;
    const handler = createSandboxStopHandler({
      loadOwnedSandboxRouteRecord: (async () =>
        buildLoadedSandboxStopRecord()) as never,
      withSandboxMutationLock: (id, operation) =>
        withSandboxMutationLock(id, operation, {
          acquireSandboxExecLock: async () => {
            locked = true;
            return { acquired: true, token: "lock" };
          },
          releaseSandboxExecLock: async () => {
            locked = false;
          },
        }),
      resolveCompletingSandboxAiCallId: async () => undefined,
      hasActiveAiCall: async (input) => {
        assert.equal(input.excludeAiCallId, undefined);
        assert.equal(locked, true);
        if (active === "unknown")
          throw new Error("Activity lookup unavailable");
        return active === "ai_call";
      },
      hasRunningAutomation: async () => active === "worker",
      hasAttachedSandboxClient: async () => active === "attached_client",
      getSandbox: async () => {
        throw new Error("Active work must not reach provider shutdown");
      },
    });
    const response = await handler(
      buildSandboxRouteRequest({
        method: "POST",
        suffix: "/stop",
        init: {
          body: JSON.stringify({
            automatic: true,
            completingAiCallId: "current-call",
          }),
          headers: { "content-type": "application/json" },
        },
      }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, active === "unknown" ? 503 : 409);
    const body = await response.json();
    if (active !== "unknown")
      assert.equal(
        body.activity[
          active === "ai_call"
            ? "activeCall"
            : active === "worker"
              ? "runningWorker"
              : "attachedClient"
        ],
        true
      );
    assert.equal(
      body.reason,
      active === "unknown" ? "activity_unknown" : "sandbox_active_work"
    );
    assert.equal(locked, false);
  });
}

test("automatic cleanup excludes its own call, stops compute, and preserves the workspace snapshot", async () => {
  const { createSandboxStopHandler } = await loadSandboxStopRouteModule();
  const { createSandboxTaskLifecycle } =
    await import("../../lib/agents/orchestrator/sandbox-task-lifecycle");
  let stopped = false;
  let savedSnapshot: unknown;
  const handler = createSandboxStopHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedSandboxStopRecord({
        status: stopped ? "stopped" : "running",
      })) as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    resolveCompletingSandboxAiCallId: async () => "current-call",
    hasActiveAiCall: async (input) => input.excludeAiCallId !== "current-call",
    hasRunningAutomation: async (_id, excluded) => excluded !== "current-call",
    hasAttachedSandboxClient: async () => false,
    getSandbox: (async () => ({
      persistent: true,
      status: "running",
      currentSnapshotId: "saved-workspace",
      stop: async () => {
        stopped = true;
      },
      currentSession: () => ({ stoppedAt: new Date() }),
    })) as never,
    stopSandboxRecord: async (_id, options) => {
      assert.equal(options?.stopReason, "auto_pause");
      return { id: "sandbox-1" } as never;
    },
    updateSandboxRecord: async (_id, update) => {
      savedSnapshot = update.snapshot_id;
      return { id: "sandbox-1" } as never;
    },
  });
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
  globalThis.fetch = async (input, init) =>
    handler(new Request(String(input), init), buildSandboxRouteParams());
  try {
    const binding = {
      sandboxId: "sandbox-1" as string | null,
      status: "running" as "running" | "pending" | "unavailable",
    };
    const lifecycle = createSandboxTaskLifecycle({
      userId: "user-1",
      aiCallId: "current-call",
      userText: "fix the tests",
      binding,
      deps: {
        loadState: async () => ({
          status: "running",
          previewUrl: null,
        }),
      },
    });
    lifecycle.onToolStart({ toolCall: { toolName: "edit_file" } });
    lifecycle.onToolFinish({
      toolCall: { toolName: "edit_file" },
      success: true,
    });
    assert.equal(await lifecycle.footer(), null);
    assert.equal(stopped, true);
    assert.equal(binding.status, "unavailable");
    assert.equal(savedSnapshot, "saved-workspace");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = originalSecret;
  }
});
