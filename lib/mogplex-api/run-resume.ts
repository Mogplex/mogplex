/**
 * Resume a run that paused at a checkpoint (`awaiting_input`). Each resume is a
 * fresh segment: it creates a new ai_call (the harness rejects reusing a
 * finished one), reuses the run's still-warm sandbox with `--resume`, and then
 * shares the same finalize step as a fresh run so it can pause again or finish.
 *
 * The run row points at the latest segment's ai_call, so the Runs table shows
 * the current segment's usage. Earlier segments remain billed on their own
 * ai_call rows.
 */
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { readExternalHarnessProgress } from "@/lib/mogplex-api/harness-progress";
import {
  loadRunForExecution,
  updateExternalAgentRun,
} from "@/lib/mogplex-api/run-execution-data";
import {
  finalizeHarnessPass,
  type ExternalAgentRunExecutionResult,
  type HarnessRunResult,
} from "@/lib/mogplex-api/run-execution-finalize";
import {
  readTextResponse,
  type SandboxRef,
} from "@/lib/mogplex-api/run-execution-launch";
import { notifySlackRunCheckpoint } from "@/lib/slack/run-checkpoint-notify";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";
import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import type {
  ExternalAgentRunRow,
  MogplexApiRunStatus,
} from "@/lib/mogplex-api/runs";
import type { HarnessCheckpoint } from "@/lib/harness/checkpoint";

export type ResumeExternalAgentRunPayload = {
  runId: string;
  userId: string;
  message: string;
};

type ResumeExternalAgentRunDeps = {
  loadRun: (
    runId: string,
    userId: string
  ) => Promise<ExternalAgentRunRow | null>;
  updateRun: typeof updateExternalAgentRun;
  /** Create a new pending ai_call for this segment; returns its id. */
  prepareAiCall: (run: ExternalAgentRunRow, message: string) => Promise<string>;
  /** Resume the harness against the warm sandbox with the user's reply. */
  resumeHarness: (
    run: ExternalAgentRunRow,
    sandbox: SandboxRef,
    message: string
  ) => Promise<HarnessRunResult>;
  loadAiCall: typeof loadOwnedAiCall;
  appendEvent: typeof safeAppendAiCallEvent;
  notifyRunReachedTerminalState: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ) => Promise<void>;
  notifyRunCheckpoint: (
    run: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ) => Promise<void>;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Resume failed";
}

function buildResumeRequestBody(
  run: ExternalAgentRunRow,
  message: string,
  opts: { prepareOnly?: boolean; aiCallId?: string; resume?: boolean }
) {
  return {
    harness: run.harness,
    prompt: message,
    conversationId: run.conversation_id,
    workspaceSessionId: run.workspace_session_id,
    mode: run.mode,
    worktreeId: run.worktree_id,
    ...(opts.prepareOnly ? { prepareOnly: true } : {}),
    ...(opts.aiCallId ? { aiCallId: opts.aiCallId } : {}),
    ...(opts.resume && run.harness_session_id
      ? { resumeSessionId: run.harness_session_id }
      : {}),
  };
}

async function postHarness(recordId: string, userId: string, body: unknown) {
  const { createSandboxHarnessPostHandler } =
    await import("@/app/api/sandbox/[id]/harness/route");
  return createSandboxHarnessPostHandler()(
    new Request(`https://internal.mogplex/api/sandbox/${recordId}/harness`, {
      method: "POST",
      headers: buildInternalApiHeaders(userId),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: recordId }) }
  );
}

async function prepareAiCallViaRoute(
  run: ExternalAgentRunRow,
  message: string
): Promise<string> {
  const recordId = run.sandbox_record_id;
  if (!recordId) {
    throw new Error("Cannot prepare a resume: the run has no sandbox");
  }
  const response = await postHarness(
    recordId,
    run.user_id,
    buildResumeRequestBody(run, message, { prepareOnly: true })
  );
  const payload = (await response.json()) as {
    aiCallId?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof payload.aiCallId !== "string") {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Failed to prepare a resume ai_call"
    );
  }
  return payload.aiCallId;
}

async function resumeHarnessViaRoute(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef,
  message: string
): Promise<HarnessRunResult> {
  const response = await postHarness(
    sandbox.recordId,
    run.user_id,
    buildResumeRequestBody(run, message, {
      aiCallId: run.ai_call_id,
      resume: true,
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok && contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: unknown };
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Resume run failed"
    );
  }
  if (!response.ok) {
    throw new Error((await readTextResponse(response)) || "Resume run failed");
  }

  const { createSlackRunProgressReporter } =
    await import("@/lib/slack/run-progress-notify");
  const progress = createSlackRunProgressReporter(run);
  try {
    return await readExternalHarnessProgress({
      response,
      run,
      onProgress: progress.report,
    });
  } finally {
    await progress.flush();
  }
}

const defaultResumeDeps: ResumeExternalAgentRunDeps = {
  loadRun: loadRunForExecution,
  updateRun: updateExternalAgentRun,
  prepareAiCall: prepareAiCallViaRoute,
  resumeHarness: resumeHarnessViaRoute,
  loadAiCall: loadOwnedAiCall,
  appendEvent: safeAppendAiCallEvent,
  notifyRunReachedTerminalState: stripSlackRunControlsForTerminalRun,
  notifyRunCheckpoint: notifySlackRunCheckpoint,
};

/**
 * Resume a paused run with the user's reply. Only a run in `awaiting_input`
 * resumes; any other state is returned unchanged (no side effects), so a stray
 * or duplicate reply can never restart a finished or running run.
 */
export async function resumeExternalAgentRun(
  payload: ResumeExternalAgentRunPayload,
  overrides: Partial<ResumeExternalAgentRunDeps> = {}
): Promise<ExternalAgentRunExecutionResult> {
  const deps: ResumeExternalAgentRunDeps = {
    ...defaultResumeDeps,
    ...overrides,
  };

  const safeNotifyTerminal = async (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ): Promise<void> => {
    try {
      await deps.notifyRunReachedTerminalState(run, status);
    } catch (error) {
      console.warn(
        "[run-resume] terminal-state notification failed",
        run.id,
        error
      );
    }
  };

  const safeNotifyCheckpoint = async (
    run: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ): Promise<void> => {
    try {
      await deps.notifyRunCheckpoint(run, checkpoint);
    } catch (error) {
      console.warn(
        "[run-resume] checkpoint notification failed",
        run.id,
        error
      );
    }
  };

  let run = await deps.loadRun(payload.runId, payload.userId);
  if (!run) {
    return {
      success: false,
      runId: payload.runId,
      status: "not_found",
      error: "External agent run not found",
    };
  }

  if (run.status !== "awaiting_input") {
    return {
      success: run.status === "success",
      runId: run.id,
      status: run.status,
      error: run.error,
    };
  }

  const message = payload.message.trim();
  if (!message) {
    // Nothing to steer with; leave the run paused for a real reply.
    return {
      success: true,
      runId: run.id,
      status: "awaiting_input",
      error: null,
    };
  }

  const sandboxRecordId = run.sandbox_record_id;
  const sandboxId = run.sandbox_id;
  if (!sandboxRecordId || !sandboxId || sandboxId === "pending") {
    const error = "The run's sandbox is no longer available to resume.";
    run = await deps.updateRun(run.user_id, run.id, {
      status: "failed",
      error,
    });
    await safeNotifyTerminal(run, "failed");
    return { success: false, runId: run.id, status: "failed", error };
  }

  try {
    const aiCallId = await deps.prepareAiCall(run, message);
    run = await deps.updateRun(run.user_id, run.id, {
      ai_call_id: aiCallId,
      status: "streaming",
      error: null,
    });

    const sandbox: SandboxRef = {
      recordId: sandboxRecordId,
      sandboxId,
    };
    const harnessResult = await deps.resumeHarness(run, sandbox, message);

    return await finalizeHarnessPass(run, harnessResult, deps, {
      terminal: safeNotifyTerminal,
      checkpoint: safeNotifyCheckpoint,
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    run = await deps.updateRun(run.user_id, run.id, {
      status: "failed",
      error: errorMessage,
    });
    await safeNotifyTerminal(run, "failed");
    await deps.appendEvent({
      aiCallId: run.ai_call_id,
      userId: run.user_id,
      conversationId: run.conversation_id,
      repoId: run.repo_id,
      eventType: "failed",
      message: "External Mogplex resume failed",
      payload: { error: errorMessage },
    });
    return {
      success: false,
      runId: run.id,
      status: "failed",
      error: errorMessage,
    };
  }
}
