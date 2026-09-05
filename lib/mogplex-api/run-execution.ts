import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { readExternalHarnessProgress } from "@/lib/mogplex-api/harness-progress";
import { notifySlackRunCheckpoint } from "@/lib/slack/run-checkpoint-notify";
import {
  launchSandboxViaRoute,
  readTextResponse,
  type SandboxRef,
} from "@/lib/mogplex-api/run-execution-launch";
import {
  finalizeFailedPass,
  finalizeHarnessPass,
  TERMINAL_RUN_STATUSES,
  type ExternalAgentRunExecutionPayload,
  type ExternalAgentRunExecutionResult,
  type FinalizeDeps,
  type HarnessRunResult,
} from "@/lib/mogplex-api/run-execution-finalize";
import {
  loadRunForExecution,
  updateExternalAgentRun,
} from "@/lib/mogplex-api/run-execution-data";
import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";
import {
  normalizeSlackRunImageAttachmentsMetadata,
  SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY,
  type SlackRunImageAttachmentsMetadata,
} from "@/lib/slack/run-attachments";

export type {
  ExternalAgentRunExecutionPayload,
  ExternalAgentRunExecutionResult,
} from "@/lib/mogplex-api/run-execution-finalize";

type ExternalAgentRunExecutionDeps = FinalizeDeps & {
  loadRun: (
    runId: string,
    userId: string
  ) => Promise<ExternalAgentRunRow | null>;
  launchSandbox: (run: ExternalAgentRunRow) => Promise<SandboxRef>;
  runHarness: (
    run: ExternalAgentRunRow,
    sandbox: SandboxRef
  ) => Promise<HarnessRunResult>;
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

export async function runHarnessViaRoute(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef
): Promise<HarnessRunResult> {
  if (run.harness === "mogplex") {
    const { runNativeMogplexAgent } = await import("./native-run");
    return runNativeMogplexAgent(run, sandbox);
  }
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
    try {
      await deps.notifyRunReachedTerminalState(run, run.status);
    } catch (error) {
      console.warn(
        "[run-execution] terminal-state notification failed",
        run.id,
        error
      );
    }
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
    return await finalizeHarnessPass(run, harnessResult, deps);
  } catch (error) {
    return await finalizeFailedPass(run, error, deps);
  }
}
