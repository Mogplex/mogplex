import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { loadOwnedAiCall, safeAppendAiCallEvent } from "@/lib/interactive-runs";
import type {
  ExternalAgentRunRow,
  MogplexApiRunStatus,
} from "@/lib/mogplex-api/runs";
import type { AiCall, SandboxRecord } from "@/lib/types";
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

type SandboxRef = {
  recordId: string;
  sandboxId: string | null;
};

type ExternalAgentRunUpdate = Partial<
  Pick<
    ExternalAgentRunRow,
    "sandbox_record_id" | "sandbox_id" | "status" | "error"
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
  runHarness: (run: ExternalAgentRunRow, sandbox: SandboxRef) => Promise<void>;
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

function extractSandboxRef(record: unknown): SandboxRef | null {
  if (!record || typeof record !== "object") return null;
  const sandbox = record as Partial<SandboxRecord> & {
    runtime_summary?: { sandbox_id?: string | null };
  };
  if (typeof sandbox.id !== "string") return null;
  return {
    recordId: sandbox.id,
    sandboxId:
      typeof sandbox.sandbox_id === "string"
        ? sandbox.sandbox_id
        : (sandbox.runtime_summary?.sandbox_id ?? null),
  };
}

async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readJsonSandboxResponse(response: Response) {
  const payload = (await response.json()) as {
    sandbox?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox launch failed"
    );
  }

  const sandbox = extractSandboxRef(payload.sandbox);
  if (!sandbox) {
    throw new Error("Sandbox launch response did not include a sandbox");
  }
  return sandbox;
}

function parseSseDataEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");
  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      // SSE requires multiple data fields in one event to be joined with a
      // newline before the event is dispatched.
      .join("\n");
    if (data) {
      events.push(JSON.parse(data));
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

async function readSandboxStreamResponse(response: Response) {
  if (!response.body) {
    throw new Error("Sandbox launch response did not include a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestSandbox: SandboxRef | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!event || typeof event !== "object") continue;
      const typedEvent = event as {
        type?: string;
        message?: string;
        sandbox?: unknown;
      };
      if (typedEvent.type === "error") {
        throw new Error(typedEvent.message || "Sandbox launch failed");
      }
      const sandbox = extractSandboxRef(typedEvent.sandbox);
      if (sandbox) latestSandbox = sandbox;
      if (typedEvent.type === "ready" && latestSandbox) {
        return latestSandbox;
      }
    }
  }

  if (!latestSandbox) {
    throw new Error("Sandbox launch stream ended before a sandbox was ready");
  }
  return latestSandbox;
}

async function launchSandboxViaRoute(run: ExternalAgentRunRow) {
  if (run.sandbox_record_id && run.sandbox_id && run.sandbox_id !== "pending") {
    return {
      recordId: run.sandbox_record_id,
      sandboxId: run.sandbox_id,
    };
  }

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildInternalApiHeaders(run.user_id),
      body: JSON.stringify({
        repoId: run.repo_id,
        baseBranch: run.base_branch,
        workingBranch: run.working_branch,
        createBranch: run.create_branch,
        rootDirectory: run.root_directory,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}

async function readHarnessStreamResponse(response: Response) {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!event || typeof event !== "object") continue;
      const typedEvent = event as { type?: string; data?: string };
      if (typedEvent.type === "error") {
        throw new Error(typedEvent.data || "Harness run failed");
      }
    }
  }
}

async function runHarnessViaRoute(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef
) {
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

  await readHarnessStreamResponse(response);
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

    await deps.runHarness(run, sandbox);

    const aiCall = await deps.loadAiCall(run.user_id, run.ai_call_id);
    const status = parseAiCallStatus(aiCall);
    run = await deps.updateRun(run.user_id, run.id, {
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
