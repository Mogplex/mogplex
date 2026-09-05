import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  finalizeRunAfterWorkerExit,
  isTerminalRunStatus,
  type RuntimeFinalizationDeps,
  type WorkerCompletion,
} from "./run-runtime-reconciliation";
import type { ExternalAgentRunRow } from "./runs-types";

type RuntimeSnapshot = { id: string; taskIdentifier: string; status: string };
async function readRuntime(id: string): Promise<RuntimeSnapshot | null> {
  if (!isTriggerRuntimeConfigured()) return null;
  const { runs } = await import("@trigger.dev/sdk/v3");
  return runs.retrieve(id);
}

export function runtimeCompletion(status: string): WorkerCompletion | null {
  switch (status) {
    case "COMPLETED":
      return { status: "completed", error: null };
    case "CANCELED":
      return { status: "cancelled", error: null };
    case "TIMED_OUT":
      return {
        status: "failed",
        error: "Agent worker timed out before completion.",
      };
    case "FAILED":
    case "CRASHED":
    case "SYSTEM_FAILURE":
    case "EXPIRED":
      return {
        status: "failed",
        error: "Agent worker stopped before completion.",
      };
    default:
      return null;
  }
}

/** Explicit reads can reconcile legacy orphaned runs; this never starts work. */
export async function reconcileExternalAgentRunRuntime(
  run: ExternalAgentRunRow,
  overrides: Partial<RuntimeFinalizationDeps> & {
    readRuntime?: typeof readRuntime;
  } = {}
): Promise<ExternalAgentRunRow | null> {
  if (run.status === "awaiting_input") return run;
  if (run.runtime_provider !== "trigger" || !run.runtime_run_id) return run;
  if (isTerminalRunStatus(run.status))
    return finalizeRunAfterWorkerExit(
      run,
      { status: "completed", error: null },
      overrides
    );
  const snapshot = await (overrides.readRuntime ?? readRuntime)(
    run.runtime_run_id
  );
  if (
    snapshot?.id !== run.runtime_run_id ||
    (snapshot.taskIdentifier !== TRIGGER_TASK_IDS.externalAgentRun &&
      snapshot.taskIdentifier !== TRIGGER_TASK_IDS.resumeAgentRun)
  )
    return run;
  const completion = runtimeCompletion(snapshot.status);
  return completion
    ? finalizeRunAfterWorkerExit(run, completion, overrides)
    : run;
}
