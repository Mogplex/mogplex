import type { UIMessageChunk } from "ai";
import { getSandboxRequestHeaders } from "@/lib/agents/tools/sandbox-resolution";
import { resolveAppBaseUrl } from "@/lib/agents/tools/shared";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SandboxBinding = {
  sandboxId: string | null;
  status: "running" | "pending" | "unavailable";
};

type ToolEvent = {
  toolCall: { toolName: string; input?: unknown };
  output?: unknown;
  success?: boolean;
};

type SandboxState = {
  status: string;
  persistent: boolean;
  previewUrl: string | null;
};

export type SandboxTaskLifecycleDeps = {
  loadState: (
    sandboxId: string,
    userId: string
  ) => Promise<SandboxState | null>;
  stop: (sandboxId: string, userId: string) => Promise<boolean>;
};

type RetainedSandboxReason =
  | "explicit"
  | "persistent"
  | "preview"
  | "follow_up"
  | "unconfirmed";

export type SandboxTaskLifecycleOutcome =
  | { state: "unused" }
  | { state: "stopped"; sandboxIds: string[] }
  | {
      state: "running";
      sandboxIds: string[];
      reason:
        | "explicit"
        | "persistent"
        | "preview"
        | "follow_up"
        | "unconfirmed";
    };

const SANDBOX_TOOLS = new Set([
  "bash",
  "run_command",
  "write_file",
  "start_sandbox",
  "sandbox_start",
  "stop_sandbox",
  "sandbox_stop",
  "spawn_worktree",
  "spawn_subagent",
]);

const FOLLOW_UP_TOOLS = new Set(["spawn_worktree", "spawn_subagent"]);
const COMMAND_TOOLS = new Set(["bash", "run_command"]);
const STOP_TOOLS = new Set(["sandbox_stop", "stop_sandbox"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function shouldRetainSandboxForRequest(userText: string) {
  const text = userText.toLowerCase();
  if (
    /\b(?:do not|don't|dont|never)\s+(?:leave|keep).{0,24}\brunning\b/.test(
      text
    )
  ) {
    return false;
  }
  return (
    /\b(?:keep|leave)\b.{0,24}\b(?:running|open|alive)\b/.test(text) ||
    /\b(?:do not|don't|dont)\s+(?:stop|shut down|shutdown)\b/.test(text) ||
    /\b(?:persistent|follow[- ]?up)\s+(?:sandbox|session|work)\b/.test(text)
  );
}

function shouldRetainPreviewForRequest(userText: string) {
  return (
    /\b(?:preview|dev server)\b/i.test(userText) &&
    /\b(?:check|create|get|keep|launch|open|preview|review|run|serve|show|start|view)\b/i.test(
      userText
    )
  );
}

export function isLongRunningSandboxCommand(command: string) {
  return (
    /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)(?:\s|$)/i.test(
      command
    ) ||
    /(?:^|\s)(?:next|vite|vercel)\s+dev(?:\s|$)/i.test(command) ||
    /(?:^|\s)(?:docker\s+compose\s+up|nohup)(?:\s|$)/i.test(command) ||
    /(?:^|\s)--watch(?:\s|$)/i.test(command) ||
    /(?:^|\s)&\s*$/.test(command)
  );
}

async function loadSandboxState(
  sandboxId: string,
  userId: string
): Promise<SandboxState | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select("status, persistent, preview_url")
    .eq("id", sandboxId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? {
        status: data.status,
        persistent: data.persistent === true,
        previewUrl: readString(data.preview_url),
      }
    : null;
}

async function stopSandboxCompute(sandboxId: string, userId: string) {
  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) return false;
  const response = await fetch(
    `${resolveAppBaseUrl()}/api/sandbox/${sandboxId}/stop`,
    { method: "POST", headers: requestHeaders.headers }
  );
  if (!response.ok) return false;
  const data = (await response.json().catch(() => null)) as {
    sandbox?: { runtime_summary?: { status?: unknown } };
  } | null;
  return data?.sandbox?.runtime_summary?.status === "stopped";
}

const defaultDeps: SandboxTaskLifecycleDeps = {
  loadState: loadSandboxState,
  stop: stopSandboxCompute,
};

function isConfirmedSandboxStop(
  event: ToolEvent,
  output: Record<string, unknown> | null,
  sandboxId: string | null
): sandboxId is string {
  return Boolean(
    STOP_TOOLS.has(event.toolCall.toolName) &&
    event.success !== false &&
    output?.status === "stopped" &&
    sandboxId
  );
}

async function cleanupSandboxCandidate(input: {
  deps: SandboxTaskLifecycleDeps;
  sandboxId: string;
  userId: string;
  retainPreview: boolean;
  retainReason: "explicit" | "follow_up" | null;
}): Promise<RetainedSandboxReason | null> {
  try {
    const state = await input.deps.loadState(input.sandboxId, input.userId);
    if (!state) return "unconfirmed";
    if (["stopped", "paused", "error"].includes(state.status)) return null;
    if (state.persistent) return "persistent";
    if (state.previewUrl && input.retainPreview) return "preview";
    if (input.retainReason) return input.retainReason;
    return (await input.deps.stop(input.sandboxId, input.userId))
      ? null
      : "unconfirmed";
  } catch (error) {
    console.error("[agent] automatic sandbox stop failed", {
      sandboxId: input.sandboxId,
      error,
    });
    return "unconfirmed";
  }
}

function getRequestedRetentionReason(input: {
  userText: string;
  retainForFollowUp: boolean;
}): "explicit" | "follow_up" | null {
  if (shouldRetainSandboxForRequest(input.userText)) return "explicit";
  return input.retainForFollowUp ? "follow_up" : null;
}

function toolRequiresFollowUp(
  event: ToolEvent,
  output: Record<string, unknown> | null
) {
  if (event.success !== true) return false;
  if (FOLLOW_UP_TOOLS.has(event.toolCall.toolName)) return true;
  if (!COMMAND_TOOLS.has(event.toolCall.toolName)) return false;
  const command = readString(asRecord(event.toolCall.input)?.command);
  return Boolean(
    command && output?.exitCode === 0 && isLongRunningSandboxCommand(command)
  );
}

function computeFooter(outcome: SandboxTaskLifecycleOutcome) {
  if (outcome.state === "unused") return null;
  if (outcome.state === "stopped") {
    return "Compute: stopped automatically; no sandbox task remains running.";
  }
  const reason =
    outcome.reason === "preview"
      ? "the preview remains available"
      : outcome.reason === "persistent"
        ? "this is a persistent session"
        : outcome.reason === "follow_up"
          ? "follow-up work still needs it"
          : outcome.reason === "explicit"
            ? "you asked to keep it running"
            : "an automatic stop could not be confirmed";
  return `Compute: still running because ${reason}.`;
}

export function appendSandboxTaskLifecycleFooter(
  stream: ReadableStream<UIMessageChunk>,
  input: { footer: () => Promise<string | null>; textPartId: string }
) {
  let appended = false;
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      async transform(chunk, controller) {
        if (chunk.type === "finish" && !appended) {
          appended = true;
          const footer = await input.footer();
          if (footer) {
            controller.enqueue({ type: "text-start", id: input.textPartId });
            controller.enqueue({
              type: "text-delta",
              id: input.textPartId,
              delta: `\n\n${footer}`,
            });
            controller.enqueue({ type: "text-end", id: input.textPartId });
          }
        }
        controller.enqueue(chunk);
      },
    })
  );
}

export function createSandboxTaskLifecycle(input: {
  userId: string;
  userText: string;
  binding: SandboxBinding;
  deps?: Partial<SandboxTaskLifecycleDeps>;
}) {
  const deps = { ...defaultDeps, ...input.deps };
  const touched = new Set<string>();
  const stopped = new Set<string>();
  const sandboxToolIdleWaiters = new Set<() => void>();
  let inFlightSandboxTools = 0;
  let usedSandboxTool = false;
  let retainForFollowUp = false;
  let cleanupPromise: Promise<SandboxTaskLifecycleOutcome> | null = null;

  const touchBoundSandbox = () => {
    if (input.binding.status === "running" && input.binding.sandboxId) {
      touched.add(input.binding.sandboxId);
    }
  };

  const onToolStart = (event: Pick<ToolEvent, "toolCall">) => {
    if (!SANDBOX_TOOLS.has(event.toolCall.toolName)) return;
    inFlightSandboxTools += 1;
    usedSandboxTool = true;
    touchBoundSandbox();
  };

  const onToolFinish = (event: ToolEvent) => {
    if (!SANDBOX_TOOLS.has(event.toolCall.toolName)) return;
    const output = asRecord(event.output);
    const sandboxId = readString(output?.sandboxId);
    if (sandboxId) touched.add(sandboxId);
    touchBoundSandbox();
    if (isConfirmedSandboxStop(event, output, sandboxId)) {
      stopped.add(sandboxId);
    }
    if (toolRequiresFollowUp(event, output)) retainForFollowUp = true;
    if (inFlightSandboxTools > 0) inFlightSandboxTools -= 1;
    if (inFlightSandboxTools === 0) {
      for (const resolve of sandboxToolIdleWaiters) resolve();
      sandboxToolIdleWaiters.clear();
    }
  };

  const waitForSandboxTools = () => {
    if (inFlightSandboxTools === 0) return Promise.resolve();
    return new Promise<void>((resolve) => sandboxToolIdleWaiters.add(resolve));
  };

  const performCleanup = async (): Promise<SandboxTaskLifecycleOutcome> => {
    await waitForSandboxTools();
    if (usedSandboxTool) touchBoundSandbox();
    const candidates = [...touched].filter((id) => !stopped.has(id));
    if (candidates.length === 0) {
      return touched.size === 0
        ? { state: "unused" }
        : { state: "stopped", sandboxIds: [...touched] };
    }
    const retainReason = getRequestedRetentionReason({
      userText: input.userText,
      retainForFollowUp,
    });

    const remaining: string[] = [];
    let retainedReason: RetainedSandboxReason | null = null;
    const retainPreview = shouldRetainPreviewForRequest(input.userText);
    for (const sandboxId of candidates) {
      const reason = await cleanupSandboxCandidate({
        deps,
        sandboxId,
        userId: input.userId,
        retainPreview,
        retainReason,
      });
      if (reason) {
        remaining.push(sandboxId);
        retainedReason =
          reason === "unconfirmed" ? reason : (retainedReason ?? reason);
      }
    }
    if (remaining.length > 0) {
      return {
        state: "running",
        sandboxIds: remaining,
        reason: retainedReason ?? "unconfirmed",
      };
    }
    input.binding.sandboxId = null;
    input.binding.status = "unavailable";
    return { state: "stopped", sandboxIds: candidates };
  };

  const cleanup = () => {
    cleanupPromise ??= performCleanup();
    return cleanupPromise;
  };

  return {
    onToolStart,
    onToolFinish,
    cleanup,
    footer: async () => computeFooter(await cleanup()),
  };
}
