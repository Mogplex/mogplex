import type { SupabaseClient } from "@supabase/supabase-js";
import { killRuntimeCommand } from "@/lib/mogplex-api/run-control";
import { runtimeCompletion } from "@/lib/mogplex-api/run-runtime";
import { finalizeRunAfterWorkerExit } from "@/lib/mogplex-api/run-runtime-reconciliation";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type RuntimeRun = {
  id: string;
  status: string;
  taskIdentifier: string;
  relatedRuns?: {
    children?: Array<{ id: string; status: string; taskIdentifier: string }>;
  };
};

export type IdleWorkerDeps = {
  retrieveRun: (id: string) => Promise<RuntimeRun>;
  cancelRun: (id: string) => Promise<unknown>;
  killCommand: typeof killRuntimeCommand;
  finalizeRun: typeof finalizeRunAfterWorkerExit;
};

async function triggerRuns() {
  const { runs } = await import("@trigger.dev/sdk/v3");
  return runs;
}

const defaultDeps: IdleWorkerDeps = {
  retrieveRun: async (id) =>
    (await triggerRuns()).retrieve(id) as Promise<RuntimeRun>,
  cancelRun: async (id) => (await triggerRuns()).cancel(id),
  killCommand: killRuntimeCommand,
  finalizeRun: finalizeRunAfterWorkerExit,
};

const isFinished = (status: string) => runtimeCompletion(status) !== null;

/** Cancels the live child runs of a supervisor that belong to `workerTask`. */
async function cancelWorkerChildren(
  supervisorRunId: string,
  workerTask: string,
  deps: IdleWorkerDeps
) {
  const supervisor = await deps.retrieveRun(supervisorRunId);
  const workers = (supervisor.relatedRuns?.children ?? []).filter(
    (child) => child.taskIdentifier === workerTask && !isFinished(child.status)
  );
  for (const worker of workers) await deps.cancelRun(worker.id);
  return workers.length;
}

async function stopExternalRunWorker(
  run: ExternalAgentRunRow,
  call: { runtime_command_id?: string | null },
  error: string,
  deps: IdleWorkerDeps
) {
  if (call.runtime_command_id) {
    // The harness process outlives a cancelled worker; stop it too.
    await deps
      .killCommand({
        user_id: run.user_id,
        sandbox_record_id: run.sandbox_record_id,
        runtimeCommandId: call.runtime_command_id,
      })
      .catch((killError: unknown) =>
        console.warn(
          "[zombie-reaper] idle command kill failed",
          run.id,
          killError
        )
      );
  }
  if (run.runtime_provider !== "trigger" || !run.runtime_run_id) return false;
  const runtime = await deps.retrieveRun(run.runtime_run_id);
  if (runtime.taskIdentifier === TRIGGER_TASK_IDS.externalAgentRun) {
    // Its supervisor wakes and finalizes the run, which tells Slack.
    return (
      (await cancelWorkerChildren(
        runtime.id,
        TRIGGER_TASK_IDS.externalAgentRunWorker,
        deps
      )) > 0
    );
  }
  if (
    runtime.taskIdentifier === TRIGGER_TASK_IDS.resumeAgentRun &&
    !isFinished(runtime.status)
  ) {
    // A resume has no supervisor, so the run is finalized here.
    await deps.cancelRun(runtime.id);
    await deps.finalizeRun(run, { status: "failed", error });
    return true;
  }
  return false;
}

/**
 * Stops the worker behind a call the reaper found idle. Workers have no
 * duration cap, so a hung one would otherwise run until someone cancelled
 * it. Cancelling the worker rather than its supervisor lets the supervisor
 * wake and run its normal finalization. Returns whether a worker was stopped.
 */
export async function stopIdleWorker(
  input: {
    client: Pick<SupabaseClient, "from">;
    call: { id: string; user_id: string; runtime_command_id?: string | null };
    error: string;
  },
  overrides: Partial<IdleWorkerDeps> = {}
): Promise<boolean> {
  if (!overrides.retrieveRun && !isTriggerRuntimeConfigured()) return false;
  const deps = { ...defaultDeps, ...overrides };
  const { client, call } = input;
  const { data: run } = await client
    .from("external_agent_runs")
    .select("*")
    .eq("ai_call_id", call.id)
    .eq("user_id", call.user_id)
    .maybeSingle();
  if (run) {
    return stopExternalRunWorker(
      run as ExternalAgentRunRow,
      call,
      input.error,
      deps
    );
  }
  const { data: ticket } = await client
    .from("control_continuations")
    .select("runtime_run_id")
    .eq("resume_ai_call_id", call.id)
    .eq("user_id", call.user_id)
    .maybeSingle();
  const supervisorRunId = (ticket as { runtime_run_id?: string } | null)
    ?.runtime_run_id;
  if (!supervisorRunId) return false;
  return (
    (await cancelWorkerChildren(
      supervisorRunId,
      TRIGGER_TASK_IDS.controlContinuationWorker,
      deps
    )) > 0
  );
}
