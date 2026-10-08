import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileControlContinuationWorker } from "@/lib/control/continuation-supervisor";
import { killRuntimeCommand } from "@/lib/mogplex-api/run-control";
import { runtimeCompletion } from "@/lib/mogplex-api/run-runtime";
import {
  finalizeRunAfterWorkerExit,
  isTerminalRunStatus,
} from "@/lib/mogplex-api/run-runtime-reconciliation";
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
  reconcileContinuation: (
    payload: { userId: string; continuationId: string },
    supervisorRunId: string
  ) => Promise<unknown>;
};

type Client = Pick<SupabaseClient, "from">;

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
  reconcileContinuation: (payload, supervisorRunId) =>
    reconcileControlContinuationWorker(payload, supervisorRunId),
};

const isFinished = (status: string) => runtimeCompletion(status) !== null;

/** Cancels a supervisor's live child runs of `workerTask`; false if it ended. */
async function cancelWorkerChildren(
  supervisor: RuntimeRun,
  workerTask: string,
  deps: IdleWorkerDeps
) {
  const workers = (supervisor.relatedRuns?.children ?? []).filter(
    (child) => child.taskIdentifier === workerTask && !isFinished(child.status)
  );
  for (const worker of workers) await deps.cancelRun(worker.id);
  return workers.length > 0;
}

// The harness process outlives a cancelled worker; stop it too.
async function killHarnessCommand(
  run: ExternalAgentRunRow,
  call: { runtime_command_id?: string | null },
  deps: IdleWorkerDeps
) {
  if (!call.runtime_command_id) return;
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

async function stopExternalRunWorker(
  run: ExternalAgentRunRow,
  call: { runtime_command_id?: string | null },
  error: string,
  deps: IdleWorkerDeps
) {
  if (isTerminalRunStatus(run.status) || run.status === "awaiting_input") {
    return false;
  }
  await killHarnessCommand(run, call, deps);
  if (run.runtime_provider !== "trigger" || !run.runtime_run_id) return false;
  const runtime = await deps.retrieveRun(run.runtime_run_id);
  if (
    runtime.taskIdentifier !== TRIGGER_TASK_IDS.externalAgentRun &&
    runtime.taskIdentifier !== TRIGGER_TASK_IDS.resumeAgentRun
  ) {
    return false;
  }
  if (
    runtime.taskIdentifier === TRIGGER_TASK_IDS.externalAgentRun &&
    !isFinished(runtime.status)
  ) {
    // Its supervisor wakes and finalizes the run, which tells Slack.
    return cancelWorkerChildren(
      runtime,
      TRIGGER_TASK_IDS.externalAgentRunWorker,
      deps
    );
  }
  // A resume has no supervisor, and a supervisor that already ended left
  // the run unfinalized, so the run is finalized here.
  if (!isFinished(runtime.status)) await deps.cancelRun(runtime.id);
  await deps.finalizeRun(run, { status: "failed", error });
  return true;
}

async function stopContinuationWorker(
  ticket: { id: string; user_id: string; runtime_run_id: string | null },
  deps: IdleWorkerDeps
) {
  if (!ticket.runtime_run_id) return false;
  const supervisor = await deps.retrieveRun(ticket.runtime_run_id);
  if (!isFinished(supervisor.status)) {
    // The worker's onCancel and the supervisor's reconciliation finish it.
    return cancelWorkerChildren(
      supervisor,
      TRIGGER_TASK_IDS.controlContinuationWorker,
      deps
    );
  }
  await deps.reconcileContinuation(
    { userId: ticket.user_id, continuationId: ticket.id },
    ticket.runtime_run_id
  );
  return true;
}

function readFailure(what: string, error: { message: string }) {
  return new Error(`Could not read ${what}: ${error.message}`);
}

/**
 * Stops the worker behind a call the reaper found idle. Workers have no
 * duration cap, so a hung one would otherwise run until someone cancelled
 * it. Cancelling the worker rather than its supervisor lets the supervisor
 * wake and run its normal finalization; when the supervisor is already gone
 * the run is finalized here. Safe to repeat: a finished run or continuation
 * is left alone. Returns whether anything was stopped or finalized, and
 * throws when the run state can't be read, so the caller can report it.
 */
export async function stopIdleWorker(
  input: {
    client: Client;
    call: { id: string; user_id: string; runtime_command_id?: string | null };
    error: string;
  },
  overrides: Partial<IdleWorkerDeps> = {}
): Promise<boolean> {
  if (!overrides.retrieveRun && !isTriggerRuntimeConfigured()) return false;
  const deps = { ...defaultDeps, ...overrides };
  const { client, call } = input;
  const { data: run, error: runError } = await client
    .from("external_agent_runs")
    .select("*")
    .eq("ai_call_id", call.id)
    .eq("user_id", call.user_id)
    .maybeSingle();
  if (runError) throw readFailure("the external run", runError);
  if (run) {
    return stopExternalRunWorker(
      run as ExternalAgentRunRow,
      call,
      input.error,
      deps
    );
  }
  const { data: ticket, error: ticketError } = await client
    .from("control_continuations")
    .select("id, user_id, status, runtime_run_id")
    .eq("resume_ai_call_id", call.id)
    .eq("user_id", call.user_id)
    .maybeSingle();
  if (ticketError) throw readFailure("the continuation", ticketError);
  const continuation = ticket as {
    id: string;
    user_id: string;
    status: string;
    runtime_run_id: string | null;
  } | null;
  if (!continuation || !["ready", "running"].includes(continuation.status)) {
    return false;
  }
  return stopContinuationWorker(continuation, deps);
}
