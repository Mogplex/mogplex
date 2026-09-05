import { expect, it } from "vitest";
import {
  reconcileExternalAgentRunRuntime,
  runtimeCompletion,
} from "./run-runtime";
import {
  buildRunRow,
  buildAiCall,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { loadMogplexApiRun } from "./runs";

it.each([
  "EXECUTING",
  "QUEUED",
  "WAITING",
  "PENDING_VERSION",
  "DELAYED",
  "DEQUEUED",
  "unknown",
])("never treats %s as finished", (status) => {
  expect(runtimeCompletion(status)).toBeNull();
});
it.each(["FAILED", "CRASHED", "EXPIRED", "SYSTEM_FAILURE", "TIMED_OUT"])(
  "recognizes terminal provider failure %s",
  (status) => {
    expect(runtimeCompletion(status)?.status).toBe("failed");
  }
);
it("distinguishes completed and cancelled workers", () => {
  expect(runtimeCompletion("COMPLETED")).toEqual({
    status: "completed",
    error: null,
  });
  expect(runtimeCompletion("CANCELED")).toEqual({
    status: "cancelled",
    error: null,
  });
});
it.each([
  null,
  {
    id: "run_other",
    taskIdentifier: "execute-external-agent-run",
    status: "TIMED_OUT",
  },
  { id: "run_worker", taskIdentifier: "unrelated-task", status: "TIMED_OUT" },
  {
    id: "run_worker",
    taskIdentifier: "execute-external-agent-run",
    status: "EXECUTING",
  },
])(
  "does not finalize from absent, unrelated, or active provider evidence: %s",
  async (snapshot) => {
    const run = buildRunRow({
      status: "streaming",
      runtime_provider: "trigger",
      runtime_run_id: "run_worker",
    });
    expect(
      await reconcileExternalAgentRunRuntime(run, {
        readRuntime: async () => snapshot,
      })
    ).toBe(run);
  }
);
it("surfaces provider access errors instead of guessing that the worker failed", async () => {
  const run = buildRunRow({
    status: "streaming",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
  const failure = new Error("Unauthorized");
  await expect(
    reconcileExternalAgentRunRuntime(run, {
      readRuntime: async () => {
        throw failure;
      },
    })
  ).rejects.toBe(failure);
  expect(run.status).toBe("streaming");
});

it("an unavailable provider does not hide owned run details", async () => {
  const run = buildRunRow({
    status: "streaming",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
  const result = await loadMogplexApiRun({
    userId: run.user_id,
    runId: run.id,
    deps: { loadRunById: async () => run },
    runtimeDeps: {
      readRuntime: async () => {
        throw new Error("provider unavailable");
      },
    },
  });
  expect(result?.status).toBe("streaming");
});

it("returns the persisted terminal state even if Slack delivery fails", async () => {
  let run = buildRunRow({
    status: "streaming",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
  const result = await loadMogplexApiRun({
    userId: run.user_id,
    runId: run.id,
    deps: { loadRunById: async () => run },
    runtimeDeps: {
      readRuntime: async () => ({
        id: "run_worker",
        taskIdentifier: "execute-external-agent-run",
        status: "COMPLETED",
      }),
      loadRun: async () => run,
      loadCall: async () => buildAiCall({ status: "success" }),
      syncRun: async (_run, status, error) => (run = { ...run, status, error }),
      appendEvent: async () => null,
      notifyTerminal: async () => {
        throw new Error("Slack unavailable");
      },
    },
  });
  expect(result?.status).toBe("success");
});

it("a missing owned run does not inspect any runtime", async () => {
  expect(
    await loadMogplexApiRun({
      userId: "user-1",
      runId: "missing",
      deps: { loadRunById: async () => null },
      runtimeDeps: {
        readRuntime: async () => {
          throw new Error("must not read");
        },
      },
    })
  ).toBeNull();
});

it("terminal reads retry notification without observing the provider", async () => {
  const run = buildRunRow({
    status: "failed",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
  let delivered = false;
  expect(
    await reconcileExternalAgentRunRuntime(run, {
      loadRun: async () => run,
      loadCall: async () => buildAiCall({ status: "failed" }),
      notifyTerminal: async () => {
        delivered = true;
      },
      readRuntime: async () => {
        throw new Error("must not read");
      },
    })
  ).toBe(run);
  expect(delivered).toBe(true);
});
