import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  MogplexApiRunControlError,
  cancelMogplexApiRun,
} from "../../lib/mogplex-api/run-control";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildAiCall,
  buildRunRow,
  loadRunCancelRoute,
} from "./helpers/mogplex-api-runs-fixtures";

test("cancelMogplexApiRun finalizes pending runs without a runtime command", async () => {
  let currentRun = buildRunRow({ status: "pending" });
  const events: Array<unknown> = [];

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () => buildAiCall({ status: currentRun.status }),
      requestCancellation: async () =>
        buildAiCall({
          status: "pending",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async (event) => {
        events.push(event);
        return null;
      },
      killRuntimeCommand: async () => {
        throw new Error("killRuntimeCommand should not run");
      },
    },
  });

  assert.ok(result);
  assert.equal(result.status, "cancelled");
  assert.equal(result.run.status, "cancelled");
  assert.equal(currentRun.status, "cancelled");
  assert.equal(events.length, 2);
});

test("cancelMogplexApiRun still finalizes when killing the runtime command fails", async () => {
  let currentRun = buildRunRow({ status: "streaming" });
  let killAttempts = 0;

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () =>
        buildAiCall({ status: "streaming", runtime_command_id: "cmd-1" }),
      requestCancellation: async () =>
        buildAiCall({
          status: "streaming",
          control_state: "cancel_requested",
          runtime_command_id: "cmd-1",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          runtime_command_id: "cmd-1",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async () => null,
      killRuntimeCommand: async () => {
        killAttempts += 1;
        throw new Error("Status code 400 is not ok");
      },
    },
  });

  assert.ok(result);
  assert.equal(killAttempts, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.run.status, "cancelled");
  assert.equal(currentRun.status, "cancelled");
});

test("cancelMogplexApiRun strips the Slack run-controls button on terminal transitions", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const notifyTerminal = async (
    run: { id: string; metadata: unknown },
    status: string
  ) => {
    notified.push({ runId: run.id, status });
  };

  // Active run -> cancelled: hook fires once.
  let currentRun = buildRunRow({ status: "pending" });
  await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () => buildAiCall({ status: currentRun.status }),
      requestCancellation: async () =>
        buildAiCall({
          status: "pending",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
      notifyTerminal,
    },
  });

  // Already-terminal run: hook still fires (defensive re-strip).
  await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => buildRunRow({ status: "success" }),
      updateRun: async () => {
        throw new Error("updateRun should not run");
      },
      loadAiCall: async () => buildAiCall(),
      requestCancellation: async () => {
        throw new Error("requestCancellation should not run");
      },
      finalizeCancelled: async () => {
        throw new Error("finalizeCancelled should not run");
      },
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
      notifyTerminal,
    },
  });

  assert.deepEqual(notified, [
    { runId: "run-1", status: "cancelled" },
    { runId: "run-1", status: "success" },
  ]);
});

test("cancelMogplexApiRun does not overwrite a run completed during cancellation", async () => {
  const initialRun = buildRunRow({ status: "streaming" });
  const completedRun = buildRunRow({ status: "success" });
  const updates: Array<unknown> = [];
  const events: Array<unknown> = [];
  let loadCount = 0;

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => {
        loadCount += 1;
        return loadCount === 1 ? initialRun : completedRun;
      },
      updateRun: async (_userId, _runId, update) => {
        updates.push(update);
        return null;
      },
      loadAiCall: async () => buildAiCall({ status: "streaming" }),
      requestCancellation: async () =>
        buildAiCall({
          status: "streaming",
          control_state: "cancel_requested",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      finalizeCancelled: async () =>
        buildAiCall({
          status: "cancelled",
          control_state: "cancelled",
          cancel_requested_at: "2026-04-28T00:01:00.000Z",
        }),
      appendEvent: async (event) => {
        events.push(event);
        return null;
      },
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "success");
  assert.equal(result.run.status, "success");
  assert.deepEqual(updates, [{ status: "cancelled", error: null }]);
  assert.equal(events.length, 1);
});

test("cancelMogplexApiRun returns current state for terminal runs", async () => {
  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => buildRunRow({ status: "cancelled" }),
      updateRun: async () => {
        throw new Error("updateRun should not run for terminal runs");
      },
      loadAiCall: async () => {
        throw new Error("loadAiCall should not run for terminal runs");
      },
      requestCancellation: async () => null,
      finalizeCancelled: async () => null,
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "cancelled");
  assert.equal(result.run.status, "cancelled");
});

test("cancelMogplexApiRun syncs terminal ai_call state instead of returning a conflict", async () => {
  let currentRun = buildRunRow({ status: "streaming" });

  const result = await cancelMogplexApiRun({
    userId: "user-123",
    runId: "run-1",
    deps: {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      loadAiCall: async () =>
        buildAiCall({ status: "failed", error: "Harness failed" }),
      requestCancellation: async () => null,
      finalizeCancelled: async () => null,
      appendEvent: async () => null,
      killRuntimeCommand: async () => {},
    },
  });

  assert.ok(result);
  assert.equal(result.status, "failed");
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.error, "Harness failed");
});

test("cancelMogplexApiRun reports inconsistent state when ai_call is missing", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () =>
        cancelMogplexApiRun({
          userId: "user-123",
          runId: "run-1",
          deps: {
            loadRun: async () => buildRunRow({ status: "pending" }),
            updateRun: async () => {
              throw new Error("updateRun should not run");
            },
            loadAiCall: async () => null,
            requestCancellation: async () => null,
            finalizeCancelled: async () => null,
            appendEvent: async () => null,
            killRuntimeCommand: async () => {},
          },
        }),
      (error) =>
        error instanceof MogplexApiRunControlError &&
        error.code === "CONFLICT" &&
        error.status === 409 &&
        error.message === "Run state is inconsistent"
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("POST /api/v1/mogplex/runs/:runId/cancel returns cancellation status", async () => {
  const { createMogplexApiRunCancelPostHandler } = await loadRunCancelRoute();
  const handler = createMogplexApiRunCancelPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: {
        userId: "user-123",
        keyId: "key-1",
        scopes: ["read", "write"],
      },
    }),
    cancelRun: async (input) => {
      assert.equal(input.userId, "user-123");
      assert.equal(input.runId, "run-1");
      return {
        run: presentMogplexApiRun(buildRunRow({ status: "cancelled" })),
        status: "cancelled",
        alreadyTerminal: false,
      };
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/runs/run-1/cancel", {
      method: "POST",
      headers: { authorization: "Bearer mog_valid" },
    }),
    { params: Promise.resolve({ runId: "run-1" }) }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, "cancelled");
  assert.equal(payload.data.run.status, "cancelled");
});
