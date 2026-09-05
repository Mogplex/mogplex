import { expect, it, vi } from "vitest";
import { superviseExternalAgentRun } from "./run-supervisor";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

it("a hard-killed child finalizes the run even though the child cannot run cleanup", async () => {
  let run = buildRunRow({
    status: "streaming",
    runtime_run_id: "run_parent",
    runtime_provider: "trigger",
  });
  let call = buildAiCall({ status: "streaming" });
  const deliveries: string[] = [];
  const result = await superviseExternalAgentRun(
    { runId: run.id, userId: run.user_id },
    "run_parent",
    {
      loadRun: async () => run,
      loadCall: async () => call,
      waitForWorker: async (_payload, key) => {
        expect(key).toBe("external-worker:run_parent");
        return {
          ok: false,
          error: { type: "INTERNAL_ERROR", code: "MAX_DURATION_EXCEEDED" },
        };
      },
      finishCall: async (_call, status, error) => {
        call = { ...call, status, error };
        return call;
      },
      syncRun: async (_run, status, error) => {
        run = { ...run, status, error };
        return run;
      },
      appendEvent: async () => null,
      notifyTerminal: async (_run, status) => {
        deliveries.push(status);
      },
    }
  );
  expect(result).toMatchObject({
    success: false,
    status: "failed",
    error: "Agent worker timed out before completion.",
  });
  expect(call.status).toBe("failed");
  expect(deliveries).toEqual(["failed"]);
});

it("does not execute another child when retrying terminal notification", async () => {
  const run = buildRunRow({
    status: "failed",
    runtime_run_id: "run_parent",
    error: "worker failed",
  });
  const result = await superviseExternalAgentRun(
    { runId: run.id, userId: run.user_id },
    "run_parent",
    {
      loadRun: async () => run,
      loadCall: async () => buildAiCall({ status: "failed" }),
      waitForWorker: async () => {
        throw new Error("must not rerun work");
      },
      notifyTerminal: async () => {},
    }
  );
  expect(result.status).toBe("failed");
});

it("refuses a stale supervisor without starting a child", async () => {
  const run = buildRunRow({ runtime_run_id: "run_new" });
  await expect(
    superviseExternalAgentRun(
      { runId: run.id, userId: run.user_id },
      "run_old",
      {
        loadRun: async () => run,
        waitForWorker: async () => {
          throw new Error("must not run");
        },
      }
    )
  ).rejects.toThrow("no longer owns");
});

it.each(["success", "cancelled", "awaiting_input"] as const)(
  "preserves a worker's %s result",
  async (status) => {
    let run = buildRunRow({ status: "pending", runtime_run_id: null });
    const result = await superviseExternalAgentRun(
      { runId: run.id, userId: run.user_id },
      "run_parent",
      {
        loadRun: async () => run,
        loadCall: async () => buildAiCall({ status: "success" }),
        waitForWorker: async () => {
          run = { ...run, status, runtime_run_id: "run_parent" };
          return {
            ok: true,
            output: { success: true, runId: run.id, status, error: null },
          };
        },
        notifyTerminal: async () => {},
      }
    );
    expect(result).toMatchObject({ status, success: status !== "cancelled" });
  }
);

it("does not start work for an already paused run", async () => {
  const run = buildRunRow({
    status: "awaiting_input",
    runtime_run_id: "run_parent",
  });
  const waitForWorker = vi.fn();
  const result = await superviseExternalAgentRun(
    { runId: run.id, userId: run.user_id },
    "run_parent",
    { loadRun: async () => run, waitForWorker }
  );
  expect(result).toMatchObject({ success: true, status: "awaiting_input" });
  expect(waitForWorker).not.toHaveBeenCalled();
});

it("does not infer worker failure from an ambiguous wait error", async () => {
  const run = buildRunRow({
    status: "streaming",
    runtime_run_id: "run_parent",
  });
  const finishCall = vi.fn();
  await expect(
    superviseExternalAgentRun(
      { runId: run.id, userId: run.user_id },
      "run_parent",
      {
        loadRun: async () => run,
        finishCall,
        waitForWorker: async () => {
          throw new Error("connection lost");
        },
      }
    )
  ).rejects.toThrow("connection lost");
  expect(finishCall).not.toHaveBeenCalled();
});

it("does not finalize a new runtime that replaced the waiting parent", async () => {
  let run = buildRunRow({ status: "streaming", runtime_run_id: "run_parent" });
  const finishCall = vi.fn();
  await expect(
    superviseExternalAgentRun(
      { runId: run.id, userId: run.user_id },
      "run_parent",
      {
        loadRun: async () => run,
        finishCall,
        waitForWorker: async () => {
          run = { ...run, runtime_run_id: "run_new" };
          return { ok: false, error: "worker failed" };
        },
      }
    )
  ).rejects.toThrow("runtime binding changed");
  expect(finishCall).not.toHaveBeenCalled();
});

it.each([0, 1, 2])("handles a run deleted at read %i", async (deletion) => {
  const run = buildRunRow({
    status: "streaming",
    runtime_run_id: "run_parent",
  });
  let reads = 0;
  const result = await superviseExternalAgentRun(
    { runId: run.id, userId: run.user_id },
    "run_parent",
    {
      loadRun: async () => (reads++ >= deletion ? null : run),
      waitForWorker: async () => ({ ok: false, error: null }),
    }
  );
  expect(result).toMatchObject({ success: false, status: "not_found" });
});
