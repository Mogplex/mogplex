import { expect, it } from "vitest";
import { resumeExternalAgentRun } from "./run-resume";
import { reconcileExternalAgentRunRuntime } from "./run-runtime";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

it.each(["trigger", null] as const)(
  "a status read during resume observes its active worker, with prior provider %s",
  async (provider) => {
    let run = buildRunRow({
      status: "awaiting_input",
      runtime_provider: provider,
      runtime_run_id: "run_completed_plan",
    });
    let call = buildAiCall({ id: "resumed-call" });
    const observedWorkers: string[] = [];
    const result = await resumeExternalAgentRun(
      {
        runId: run.id,
        userId: run.user_id,
        steer: "Approved. Implement the plan.",
        runtimeRunId: "run_active_resume",
      },
      {
        loadRun: async () => run,
        createAiCall: async () => call,
        updateRun: async (_userId, _runId, update) =>
          (run = { ...run, ...update }),
        // Read at the first observable moment, before sandbox restoration.
        launchSandbox: async () => {
          await reconcileExternalAgentRunRuntime(run, {
            readRuntime: async (id) => {
              observedWorkers.push(id);
              return {
                id,
                taskIdentifier:
                  id === "run_active_resume"
                    ? TRIGGER_TASK_IDS.resumeAgentRun
                    : TRIGGER_TASK_IDS.externalAgentRun,
                status: id === "run_active_resume" ? "EXECUTING" : "COMPLETED",
              };
            },
            loadRun: async () => run,
            loadCall: async () => call,
            finishCall: async (_call, status, error) =>
              (call = { ...call, status, error }),
            syncRun: async (_run, status, error) =>
              (run = { ...run, status, error }),
            appendEvent: async () => null,
            notifyTerminal: async () => {},
            cleanupSandbox: async () => {},
            cleanupBranches: async () => {},
          });
          return { recordId: "saved-record", sandboxId: "saved-sandbox" };
        },
        runHarness: async () => {
          if (call.status === "failed") throw new Error(call.error!);
          call = { ...call, status: "success" };
          return { output: "Implementation complete" };
        },
        loadAiCall: async () => call,
        appendEvent: async () => null,
        notifyRunReachedTerminalState: async () => {},
        notifyRunCheckpoint: async () => {},
      }
    );
    expect(result).toMatchObject({ success: true, status: "success" });
    expect(observedWorkers).toEqual(["run_active_resume"]);
    expect(run).toMatchObject({
      runtime_provider: "trigger",
      runtime_run_id: "run_active_resume",
      ai_call_id: "resumed-call",
    });
  }
);

it.each([false, true])(
  "keeps a cancellation during sandbox restoration (restore throws: %s)",
  async (restoreThrows) => {
    let run = buildRunRow({ status: "awaiting_input" });
    let harnessStarted = false;
    const result = await resumeExternalAgentRun(
      {
        runId: run.id,
        userId: run.user_id,
        steer: "Approved",
        runtimeRunId: "run_resume",
      },
      {
        loadRun: async () => run,
        createAiCall: async () => buildAiCall(),
        updateRun: async (_userId, _runId, update) =>
          (run = { ...run, ...update }),
        launchSandbox: async () => {
          run = { ...run, status: "cancelled" };
          if (restoreThrows) throw new Error("restoration interrupted");
          return { recordId: "saved-record", sandboxId: "saved-sandbox" };
        },
        runHarness: async () => {
          harnessStarted = true;
          return { output: "done" };
        },
        loadAiCall: async () => buildAiCall({ status: "success" }),
        appendEvent: async () => null,
        notifyRunReachedTerminalState: async () => {},
        notifyRunCheckpoint: async () => {},
      }
    );
    expect(result).toMatchObject({ status: "cancelled", error: null });
    expect(run.status).toBe("cancelled");
    expect(harnessStarted).toBe(false);
  }
);
