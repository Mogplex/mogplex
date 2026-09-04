/**
 * Shared finalization for a single external-agent harness pass.
 *
 * Both the initial run (run-execution.ts) and a resumed segment
 * (run-resume.ts) launch a sandbox, run the harness once, then land the run in
 * one of three states: paused at a checkpoint (awaiting_input), terminal from
 * the ai_call status, or failed. That decision is identical for both, so it
 * lives here as `finalizeHarnessPass` / `finalizeFailedPass`.
 */
import {
  parseHarnessCheckpoint,
  type HarnessCheckpoint,
} from "@/lib/harness/checkpoint";
import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import type {
  ExternalAgentRunRow,
  MogplexApiRunStatus,
} from "@/lib/mogplex-api/runs";
import type { AiCall } from "@/lib/types";

export type ExternalAgentRunExecutionPayload = {
  runId: string;
  userId: string;
};

export type ExternalAgentRunExecutionResult = {
  success: boolean;
  runId: string;
  status: MogplexApiRunStatus | "not_found";
  error: string | null;
};

/** What a harness pass produced: the agent's aggregated assistant output. */
export type HarnessRunResult = {
  output: string;
};

export type ExternalAgentRunUpdate = Partial<
  Pick<
    ExternalAgentRunRow,
    "sandbox_record_id" | "sandbox_id" | "status" | "error" | "ai_call_id"
  >
>;

export const TERMINAL_RUN_STATUSES = new Set<MogplexApiRunStatus>([
  "success",
  "failed",
  "cancelled",
]);

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "External run failed";
}

export function parseAiCallStatus(call: AiCall | null): MogplexApiRunStatus {
  return call?.status ?? "failed";
}

/** Side-effect hooks a finished pass fires; a throw here never affects status. */
export type HarnessPassNotifiers = {
  /**
   * Invoked (best-effort) once a run reaches a terminal state — used to strip
   * the Slack "Cancel run" button.
   */
  notifyRunReachedTerminalState: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ) => Promise<void>;
  /**
   * Invoked (best-effort) when a run pauses at a checkpoint instead of
   * finishing — used to post the preview URL into Slack and invite steering.
   */
  notifyRunCheckpoint: (
    run: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ) => Promise<void>;
};

export type FinalizeDeps = HarnessPassNotifiers & {
  updateRun: (
    userId: string,
    runId: string,
    update: ExternalAgentRunUpdate
  ) => Promise<ExternalAgentRunRow>;
  loadAiCall: typeof loadOwnedAiCall;
  appendEvent: typeof safeAppendAiCallEvent;
};

async function safeNotifyTerminal(
  deps: HarnessPassNotifiers,
  run: ExternalAgentRunRow,
  status: MogplexApiRunStatus
): Promise<void> {
  try {
    await deps.notifyRunReachedTerminalState(run, status);
  } catch (error) {
    console.warn(
      "[run-execution] terminal-state notification failed",
      run.id,
      error
    );
  }
}

async function safeNotifyCheckpoint(
  deps: HarnessPassNotifiers,
  run: ExternalAgentRunRow,
  checkpoint: HarnessCheckpoint
): Promise<void> {
  try {
    await deps.notifyRunCheckpoint(run, checkpoint);
  } catch (error) {
    console.warn(
      "[run-execution] checkpoint notification failed",
      run.id,
      error
    );
  }
}

/**
 * Resolves a completed harness pass. A successful pass that declared a
 * checkpoint pauses for user feedback (awaiting_input) instead of finishing:
 * the run stays alive, the preview is surfaced, and the run waits to be steered
 * or approved. A failed pass never pauses — a checkpoint marker in failing
 * output is ignored.
 */
export async function finalizeHarnessPass(
  run: ExternalAgentRunRow,
  harnessResult: HarnessRunResult,
  deps: FinalizeDeps
): Promise<ExternalAgentRunExecutionResult> {
  const aiCall = await deps.loadAiCall(run.user_id, run.ai_call_id);
  const status = parseAiCallStatus(aiCall);

  if (status === "success") {
    const checkpoint = parseHarnessCheckpoint(harnessResult.output);
    if (checkpoint) {
      const paused = await deps.updateRun(run.user_id, run.id, {
        status: "awaiting_input",
        error: null,
      });
      await safeNotifyCheckpoint(deps, paused, checkpoint);
      return {
        success: true,
        runId: paused.id,
        status: "awaiting_input",
        error: null,
      };
    }
  }

  const finished = await deps.updateRun(run.user_id, run.id, {
    status,
    error: aiCall?.error ?? null,
  });
  await safeNotifyTerminal(deps, finished, status);

  return {
    success: status === "success",
    runId: finished.id,
    status,
    error: aiCall?.error ?? null,
  };
}

/** Records a thrown pass as a failed run and surfaces it on the ai_call. */
export async function finalizeFailedPass(
  run: ExternalAgentRunRow,
  error: unknown,
  deps: FinalizeDeps
): Promise<ExternalAgentRunExecutionResult> {
  const message = toErrorMessage(error);
  const failed = await deps.updateRun(run.user_id, run.id, {
    status: "failed",
    error: message,
  });
  await safeNotifyTerminal(deps, failed, "failed");
  await deps.appendEvent({
    aiCallId: failed.ai_call_id,
    userId: failed.user_id,
    conversationId: failed.conversation_id,
    repoId: failed.repo_id,
    eventType: "failed",
    message: "External Mogplex run failed",
    payload: { error: message },
  });

  return {
    success: false,
    runId: failed.id,
    status: "failed",
    error: message,
  };
}
