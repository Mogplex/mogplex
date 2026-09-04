import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { readExternalHarnessProgress } from "@/lib/mogplex-api/harness-progress";
import {
  parseHarnessCheckpoint,
  type HarnessCheckpoint,
} from "@/lib/harness/checkpoint";
import { notifySlackRunCheckpoint } from "@/lib/slack/run-checkpoint-notify";
import {
  launchSandboxViaRoute,
  readTextResponse,
  type SandboxRef,
} from "@/lib/mogplex-api/run-execution-launch";
import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import type {
  ExternalAgentRunRow,
  MogplexApiRunStatus,
} from "@/lib/mogplex-api/runs";
import type { AiCall } from "@/lib/types";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";
import {
  normalizeSlackRunImageAttachmentsMetadata,
  SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY,
  type SlackRunImageAttachmentsMetadata,
} from "@/lib/slack/run-attachments";

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

/**
 * What a harness pass produced: the agent's aggregated assistant output and
 * the CLI session id (when the harness reported one) so the run can be resumed.
 */
type HarnessRunResult = {
  output: string;
  sessionId: string | null;
};

type ExternalAgentRunUpdate = Partial<
  Pick<
    ExternalAgentRunRow,
    | "sandbox_record_id"
    | "sandbox_id"
    | "status"
    | "error"
    | "harness_session_id"
  >
>;

type ExternalAgentRunExecutionDeps = {
  loadRun: (
    runId: string,
    userId: string
  ) => Promise<ExternalAgentRunRow | null>;
  updateRun: (
    userId: string,
    runId: string,
    update: ExternalAgentRunUpdate
  ) => Promise<ExternalAgentRunRow>;
  launchSandbox: (run: ExternalAgentRunRow) => Promise<SandboxRef>;
  runHarness: (
    run: ExternalAgentRunRow,
    sandbox: SandboxRef
  ) => Promise<HarnessRunResult>;
  loadAiCall: typeof loadOwnedAiCall;
  appendEvent: typeof safeAppendAiCallEvent;
  /**
   * Side-effect hook invoked (best-effort) once a run reaches a terminal
   * state — used to strip the Slack "Cancel run" button. A throw here never
   * affects the run's status.
   */
  notifyRunReachedTerminalState: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ) => Promise<void>;
  /**
   * Side-effect hook invoked (best-effort) when a run pauses at a checkpoint
   * instead of finishing — used to post the preview URL into Slack and invite
   * the user to steer. A throw here never affects the run's status.
   */
  notifyRunCheckpoint: (
    run: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ) => Promise<void>;
};

export type ExternalAgentHarnessRequestBody = {
  harness: ExternalAgentRunRow["harness"];
  prompt: string;
  conversationId: string | null;
  workspaceSessionId: string | null;
  mode: string | null;
  aiCallId: string;
  worktreeId: string | null;
  slackImageAttachments?: SlackRunImageAttachmentsMetadata;
};

const TERMINAL_RUN_STATUSES = new Set<MogplexApiRunStatus>([
  "success",
  "failed",
  "cancelled",
]);

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "External run failed";
}

function parseAiCallStatus(call: AiCall | null): MogplexApiRunStatus {
  return call?.status ?? "failed";
}

export function buildExternalAgentHarnessRequestBody(
  run: ExternalAgentRunRow
): ExternalAgentHarnessRequestBody {
  const slackImageAttachments = normalizeSlackRunImageAttachmentsMetadata(
    run.metadata?.[SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY]
  );
  return {
    harness: run.harness,
    prompt: run.prompt,
    conversationId: run.conversation_id,
    workspaceSessionId: run.workspace_session_id,
    mode: run.mode,
    aiCallId: run.ai_call_id,
    worktreeId: run.worktree_id,
    ...(slackImageAttachments ? { slackImageAttachments } : {}),
  };
}

async function runHarnessViaRoute(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef
): Promise<HarnessRunResult> {
  const { createSandboxHarnessPostHandler } =
    await import("@/app/api/sandbox/[id]/harness/route");
  const response = await createSandboxHarnessPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandbox.recordId}/harness`,
      {
        method: "POST",
        headers: buildInternalApiHeaders(run.user_id),
        body: JSON.stringify(buildExternalAgentHarnessRequestBody(run)),
      }
    ),
    { params: Promise.resolve({ id: sandbox.recordId }) }
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok && contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: unknown };
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Harness run failed"
    );
  }
  if (!response.ok) {
    throw new Error((await readTextResponse(response)) || "Harness run failed");
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

async function loadRunForExecution(runId: string, userId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load external agent run: ${error.message}`);
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

async function updateExternalAgentRun(
  userId: string,
  runId: string,
  update: ExternalAgentRunUpdate
) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .update(update)
    .eq("user_id", userId)
    .eq("id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || `Failed to update external agent run ${runId}`
    );
  }

  return data as ExternalAgentRunRow;
}

const defaultExecutionDeps: ExternalAgentRunExecutionDeps = {
  loadRun: loadRunForExecution,
  updateRun: updateExternalAgentRun,
  launchSandbox: launchSandboxViaRoute,
  runHarness: runHarnessViaRoute,
  loadAiCall: loadOwnedAiCall,
  appendEvent: safeAppendAiCallEvent,
  notifyRunReachedTerminalState: stripSlackRunControlsForTerminalRun,
  notifyRunCheckpoint: notifySlackRunCheckpoint,
};

export async function executeExternalAgentRun(
  payload: ExternalAgentRunExecutionPayload,
  overrides: Partial<ExternalAgentRunExecutionDeps> = {}
): Promise<ExternalAgentRunExecutionResult> {
  const deps: ExternalAgentRunExecutionDeps = {
    ...defaultExecutionDeps,
    ...overrides,
  };

  const safeNotifyTerminal = async (
    terminalRun: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ): Promise<void> => {
    try {
      await deps.notifyRunReachedTerminalState(terminalRun, status);
    } catch (error) {
      console.warn(
        "[run-execution] terminal-state notification failed",
        terminalRun.id,
        error
      );
    }
  };

  const safeNotifyCheckpoint = async (
    pausedRun: ExternalAgentRunRow,
    checkpoint: HarnessCheckpoint
  ): Promise<void> => {
    try {
      await deps.notifyRunCheckpoint(pausedRun, checkpoint);
    } catch (error) {
      console.warn(
        "[run-execution] checkpoint notification failed",
        pausedRun.id,
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

  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    // Already finished (e.g. a retried task): re-run the notification so a
    // button left over from a crashed first attempt still gets stripped.
    await safeNotifyTerminal(run, run.status);
    return {
      success: run.status === "success",
      runId: run.id,
      status: run.status,
      error: run.error,
    };
  }

  try {
    const sandbox = await deps.launchSandbox(run);
    run = await deps.updateRun(run.user_id, run.id, {
      sandbox_record_id: sandbox.recordId,
      sandbox_id: sandbox.sandboxId,
      status: "streaming",
      error: null,
    });

    const harnessResult = await deps.runHarness(run, sandbox);

    // Persist the CLI session id so a later segment can resume the same
    // conversation. Only overwrite when the harness reported one this pass.
    const sessionUpdate: ExternalAgentRunUpdate = harnessResult.sessionId
      ? { harness_session_id: harnessResult.sessionId }
      : {};

    const aiCall = await deps.loadAiCall(run.user_id, run.ai_call_id);
    const status = parseAiCallStatus(aiCall);

    // A successful pass that declared a checkpoint pauses for user feedback
    // instead of finishing: keep the run and its sandbox alive, surface the
    // preview, and wait for the user to steer or approve. A failed pass never
    // pauses — a checkpoint marker in failing output is ignored.
    if (status === "success") {
      const checkpoint = parseHarnessCheckpoint(harnessResult.output);
      if (checkpoint) {
        run = await deps.updateRun(run.user_id, run.id, {
          ...sessionUpdate,
          status: "awaiting_input",
          error: null,
        });
        await safeNotifyCheckpoint(run, checkpoint);
        return {
          success: true,
          runId: run.id,
          status: "awaiting_input",
          error: null,
        };
      }
    }

    run = await deps.updateRun(run.user_id, run.id, {
      ...sessionUpdate,
      status,
      error: aiCall?.error ?? null,
    });
    await safeNotifyTerminal(run, status);

    return {
      success: status === "success",
      runId: run.id,
      status,
      error: aiCall?.error ?? null,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    run = await deps.updateRun(run.user_id, run.id, {
      status: "failed",
      error: message,
    });
    await safeNotifyTerminal(run, "failed");
    await deps.appendEvent({
      aiCallId: run.ai_call_id,
      userId: run.user_id,
      conversationId: run.conversation_id,
      repoId: run.repo_id,
      eventType: "failed",
      message: "External Mogplex run failed",
      payload: { error: message },
    });

    return {
      success: false,
      runId: run.id,
      status: "failed",
      error: message,
    };
  }
}
