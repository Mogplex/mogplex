import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import { notifyTerminalSlackRunOnce } from "./run-terminal-notification";
import { loadRunForExecution } from "./run-execution-data";
import {
  finishCallAfterRuntime,
  syncRunAfterRuntime,
  type TerminalRunStatus,
} from "./run-runtime-store";
import type { ExternalAgentRunRow } from "./runs-types";

export type WorkerCompletion = {
  status: "completed" | "failed" | "cancelled";
  error: string | null;
};
export type RuntimeFinalizationDeps = {
  loadRun: typeof loadRunForExecution;
  loadCall: typeof loadOwnedAiCall;
  finishCall: typeof finishCallAfterRuntime;
  syncRun: typeof syncRunAfterRuntime;
  appendEvent: typeof safeAppendAiCallEvent;
  notifyTerminal: typeof notifyTerminalSlackRunOnce;
};
const defaultDeps: RuntimeFinalizationDeps = {
  loadRun: loadRunForExecution,
  loadCall: loadOwnedAiCall,
  finishCall: finishCallAfterRuntime,
  syncRun: syncRunAfterRuntime,
  appendEvent: safeAppendAiCallEvent,
  notifyTerminal: notifyTerminalSlackRunOnce,
};

export function isTerminalRunStatus(
  status: string
): status is TerminalRunStatus {
  return status === "success" || status === "failed" || status === "cancelled";
}

export async function finalizeRunAfterWorkerExit(
  expected: ExternalAgentRunRow,
  completion: WorkerCompletion,
  overrides: Partial<RuntimeFinalizationDeps> = {}
): Promise<ExternalAgentRunRow | null> {
  const deps = { ...defaultDeps, ...overrides };
  let run = await deps.loadRun(expected.id, expected.user_id);
  if (
    run?.ai_call_id !== expected.ai_call_id ||
    run.runtime_run_id !== expected.runtime_run_id ||
    run.status === "awaiting_input"
  )
    return run;
  let call = await deps.loadCall(run.user_id, run.ai_call_id);
  if (!call) throw new Error("Worker call not found during finalization");

  if (!isTerminalRunStatus(call.status)) {
    const cancelled =
      call.control_state !== "active" || completion.status === "cancelled";
    const status = isTerminalRunStatus(run.status)
      ? run.status
      : cancelled
        ? "cancelled"
        : "failed";
    const error = isTerminalRunStatus(run.status)
      ? run.error
      : status === "cancelled"
        ? null
        : (completion.error ?? "Agent worker ended without a terminal result.");
    call =
      (await deps.finishCall(call, status, error)) ??
      (await deps.loadCall(run.user_id, run.ai_call_id));
  }
  if (!call || !isTerminalRunStatus(call.status)) {
    // A cancellation request raced the guarded write. Let the durable caller
    // retry; never force failure over a concurrent cancellation.
    throw new Error("Worker call changed during finalization");
  }

  if (!isTerminalRunStatus(run.status)) {
    const updated = await deps.syncRun(run, call.status, call.error);
    if (!updated) return deps.loadRun(run.id, run.user_id);
    run = updated;
    await deps.appendEvent({
      aiCallId: call.id,
      userId: run.user_id,
      conversationId: run.conversation_id,
      repoId: run.repo_id,
      eventType: call.status === "success" ? "finished" : call.status,
      message: "Agent worker completion reconciled",
      payload: {
        external_run_id: run.id,
        runtime_run_id: run.runtime_run_id,
        error: run.error,
      },
    });
  }
  // Propagate notification errors so the supervisor retries delivery without
  // executing the agent again. A terminal row alone is not successful delivery.
  await deps.notifyTerminal(run, run.status);
  return run;
}
