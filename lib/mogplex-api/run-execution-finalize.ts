/**
 * Shared finalize step for a single harness pass, used by both a fresh run
 * (run-execution.ts) and a resumed segment (run-resume.ts). It maps the
 * backing ai_call status onto the run, pausing at a checkpoint instead of
 * finishing when the agent declared one, and persists the CLI session id so a
 * later segment can resume.
 */
import {
  parseHarnessCheckpoint,
  type HarnessCheckpoint,
} from "@/lib/harness/checkpoint";
import type {
  ExternalAgentRunRow,
  MogplexApiRunStatus,
} from "@/lib/mogplex-api/runs";
import type { AiCall } from "@/lib/types";

export type ExternalAgentRunExecutionResult = {
  success: boolean;
  runId: string;
  status: MogplexApiRunStatus | "not_found";
  error: string | null;
};

/**
 * What a harness pass produced: the agent's aggregated assistant output and
 * the CLI session id (when the harness reported one) so the run can be resumed.
 */
export type HarnessRunResult = {
  output: string;
  sessionId: string | null;
};

export type ExternalAgentRunUpdate = Partial<
  Pick<
    ExternalAgentRunRow,
    | "sandbox_record_id"
    | "sandbox_id"
    | "status"
    | "error"
    | "harness_session_id"
    | "ai_call_id"
  >
>;

export type FinalizeDeps = {
  loadAiCall: (userId: string, aiCallId: string) => Promise<AiCall | null>;
  updateRun: (
    userId: string,
    runId: string,
    update: ExternalAgentRunUpdate
  ) => Promise<ExternalAgentRunRow>;
};

export type FinalizeNotify = {
  /** Best-effort: run reached a terminal state (strip the Slack controls). */
  terminal: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ) => Promise<void>;
  /** Best-effort: run paused at a checkpoint (post the preview to Slack). */
  checkpoint: (
    run: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ) => Promise<void>;
};

export function parseAiCallStatus(call: AiCall | null): MogplexApiRunStatus {
  return call?.status ?? "failed";
}

/**
 * Resolve a completed harness pass to a run outcome. A successful pass that
 * declared a checkpoint pauses at `awaiting_input` and keeps its sandbox warm;
 * otherwise the run mirrors the ai_call's terminal status. A failed pass never
 * pauses, even if a checkpoint marker appears in its output.
 */
export async function finalizeHarnessPass(
  run: ExternalAgentRunRow,
  harnessResult: HarnessRunResult,
  deps: FinalizeDeps,
  notify: FinalizeNotify
): Promise<ExternalAgentRunExecutionResult> {
  const sessionUpdate: ExternalAgentRunUpdate = harnessResult.sessionId
    ? { harness_session_id: harnessResult.sessionId }
    : {};

  const aiCall = await deps.loadAiCall(run.user_id, run.ai_call_id);
  const status = parseAiCallStatus(aiCall);

  if (status === "success") {
    const checkpoint = parseHarnessCheckpoint(harnessResult.output);
    if (checkpoint) {
      const paused = await deps.updateRun(run.user_id, run.id, {
        ...sessionUpdate,
        status: "awaiting_input",
        error: null,
      });
      await notify.checkpoint(paused, checkpoint);
      return {
        success: true,
        runId: paused.id,
        status: "awaiting_input",
        error: null,
      };
    }
  }

  const finished = await deps.updateRun(run.user_id, run.id, {
    ...sessionUpdate,
    status,
    error: aiCall?.error ?? null,
  });
  await notify.terminal(finished, status);

  return {
    success: status === "success",
    runId: finished.id,
    status,
    error: aiCall?.error ?? null,
  };
}
