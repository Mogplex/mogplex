import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { buildTools } from "@/lib/agents/tools";
import {
  buildSystemPrompt,
  resolveAgentDeliveryBranch,
} from "@/lib/agents/system-prompt";
import { prepareChatGitDelivery } from "@/lib/agents/chat-git-delivery";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { resolveUserDefaultModelId } from "@/lib/models/default-model";
import {
  type GatewayCallContext,
  withGatewaySystemCaching,
} from "@/lib/models/gateway-provider-routing";
import {
  captureUsage,
  capturedUsageAiCallColumns,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  hasCapturedUsage,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { windowMessages } from "@/lib/agents/message-window";
import type { LanguageModelUsage, ProviderMetadata } from "ai";

/**
 * Non-HTTP agent runner. Drives the same `streamText` loop the chat route uses
 * — same model resolver, tools, system prompt, and stop condition — but
 * consumes the stream in-process and returns the accumulated text.
 *
 * Used by adapters like the Slack event handler that need the model's final
 * answer rather than a UI stream. The HTTP chat route shares the streaming core
 * below (`createChatModelStream`) and layers its own telemetry/UI wiring on top.
 */

export type RunChatAgentContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export type RunChatAgentMessage = {
  role: "user" | "assistant" | "system";
  content: string | RunChatAgentContentPart[];
};

/**
 * The repo/sandbox/conversation fields that select tools and shape the system
 * prompt. Shared by every chat entry point so tool wiring and prompt building
 * cannot drift between the HTTP route and the in-process runner.
 */
export type ChatAgentContext = {
  userId: string;
  repoId?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  repoBaseBranch?: string | null;
  repoFullName?: string | null;
  sandboxId?: string | null;
  workspaceSessionId?: string | null;
  conversationId?: string | null;
  surface?: "chat" | "slack";
  enableTools?: boolean;
  /**
   * Stable execution scope used to deduplicate mutating tools if an external
   * event handler retries the same turn.
   */
  toolExecutionIdempotencyKey?: string | null;
  /**
   * Active team scope, if the request was made inside one. Solo turns leave
   * this null/undefined. Threaded into both buildTools (for capability
   * filtering) and resolveUserLanguageModel (for model gate + scoped key).
   */
  teamId?: string | null;
};

export type RunChatAgentInput = ChatAgentContext & {
  messages: RunChatAgentMessage[];
  model?: string | null;
  systemSuffix?: string | null;
  abortSignal?: AbortSignal;
  /**
   * Called whenever the model emits text. Receives the cumulative reply so far
   * (not just the delta) — convenient for edit-in-place surfaces like Slack
   * `chat.update`. Errors thrown by the callback are caught and logged so they
   * cannot abort the run.
   */
  onTextDelta?: (accumulatedText: string) => void | Promise<void>;
};

export type RunChatAgentResult = {
  finalText: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stepCount: number;
};

type StreamTextOptions = Parameters<typeof streamText>[0];

/**
 * Optional hooks the HTTP route uses to drive its `ai_calls` telemetry. The
 * in-process runner leaves these unset.
 */
export type ChatModelStreamHooks = Partial<
  Pick<
    StreamTextOptions,
    | "experimental_onToolCallStart"
    | "experimental_onToolCallFinish"
    | "onAbort"
    | "onFinish"
    | "onStepFinish"
  >
>;

export const CHAT_STOP_WHEN = stepCountIs(100);

function buildChatGatewayContext(
  context: ChatAgentContext
): GatewayCallContext {
  const surface = context.surface ?? "chat";
  const tags = [`surface:${surface}`];
  if (context.repoFullName) tags.push(`repo:${context.repoFullName}`);
  if (context.conversationId)
    tags.push(`conversation:${context.conversationId}`);

  return {
    userId: context.userId,
    tags,
    caching: surface === "slack" ? "auto" : "off",
  };
}

export async function resolveChatModelId(
  userId: string,
  requestedModel?: string | null
): Promise<string> {
  if (requestedModel) return requestedModel;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .single();
  return resolveUserDefaultModelId(userId, profile?.default_model);
}

function buildToolsInput(context: ChatAgentContext) {
  return {
    sandboxId: context.sandboxId ?? undefined,
    userId: context.userId,
    repoId: context.repoId ?? undefined,
    repoOwner: context.repoOwner ?? undefined,
    repoName: context.repoName ?? undefined,
    repoBranch: resolveAgentDeliveryBranch({
      repoBranch: context.repoBranch,
      repoBaseBranch: context.repoBaseBranch,
      sandboxId: context.sandboxId,
    }),
    repoBaseBranch: context.repoBaseBranch ?? undefined,
    workspaceSessionId: context.workspaceSessionId ?? null,
    conversationId: context.conversationId ?? null,
    teamId: context.teamId ?? null,
    toolExecutionIdempotencyKey: context.toolExecutionIdempotencyKey ?? null,
  };
}

function buildPromptContextInput(
  context: ChatAgentContext,
  connections: Awaited<ReturnType<typeof buildTools>>["connections"]
) {
  return {
    repoFullName: context.repoFullName ?? undefined,
    repoOwner: context.repoOwner ?? undefined,
    repoName: context.repoName ?? undefined,
    repoBranch: context.repoBranch ?? undefined,
    repoBaseBranch: context.repoBaseBranch ?? undefined,
    repoId: context.repoId ?? undefined,
    sandboxId: context.sandboxId ?? undefined,
    connections,
  };
}

// `convertToModelMessages` expects UIMessage-shaped input with a `parts`
// array. Adapt the simpler `{ role, content }` shape into that.
function toUIMessages(messages: RunChatAgentMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    parts:
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content,
  }));
}

export type CreateChatModelStreamInput = {
  context: ChatAgentContext;
  resolvedModel: string;
  /** Messages in UIMessage shape (with a `parts` array), not yet converted. */
  uiMessages: Parameters<typeof convertToModelMessages>[0];
  /**
   * Extra text appended to the built system prompt (separated by a blank
   * line). The HTTP route uses this to inject its `<memory-context>` block.
   */
  systemSuffix?: string | null;
  abortSignal?: AbortSignal;
  hooks?: ChatModelStreamHooks;
};

export type CreateChatModelStreamResult = {
  result: ReturnType<typeof streamText>;
  connections: Awaited<ReturnType<typeof buildTools>>["connections"];
  cleanup: () => Promise<void>;
};

async function prepareChatContextForDelivery(context: ChatAgentContext) {
  if (
    context.enableTools === false ||
    !context.sandboxId ||
    !context.repoFullName
  ) {
    return context;
  }

  const baseBranch = context.repoBaseBranch || "main";
  const currentBranch = context.repoBranch || baseBranch;
  // Standard launches already check out their isolated working branch. The
  // server-side repair is only needed for legacy sandboxes that still point at
  // the base branch; persisting the repaired branch makes this a one-time cost.
  if (currentBranch !== baseBranch) return context;
  const workingBranch = resolveAgentDeliveryBranch({
    repoBranch: context.repoBranch,
    repoBaseBranch: baseBranch,
    sandboxId: context.sandboxId,
  });
  await prepareChatGitDelivery({
    userId: context.userId,
    sandboxId: context.sandboxId,
    baseBranch,
    workingBranch,
  });
  if (workingBranch !== context.repoBranch) {
    const { error } = await supabaseAdmin
      .from("sandboxes")
      .update({ working_branch: workingBranch })
      .eq("id", context.sandboxId)
      .eq("user_id", context.userId);
    if (error) {
      console.warn("[chat] failed to persist isolated working branch", {
        sandboxId: context.sandboxId,
        workingBranch,
        error,
      });
    }
  }

  return { ...context, repoBranch: workingBranch };
}

/**
 * The single source of truth for how a chat turn is streamed: model resolution,
 * tool wiring, system prompt, message conversion, and `stopWhen`. Every chat
 * entry point goes through here so these cannot drift.
 */
export async function createChatModelStream(
  input: CreateChatModelStreamInput
): Promise<CreateChatModelStreamResult> {
  const context = await prepareChatContextForDelivery(input.context);

  const gatewayContext = buildChatGatewayContext(context);
  const { model, providerOptions } = await resolveUserLanguageModel(
    context.userId,
    input.resolvedModel,
    {
      gatewayContext,
      teamId: context.teamId ?? null,
    }
  );

  const { tools, connections, cleanup } = await buildTools(
    buildToolsInput(context)
  );
  let cleanedUp = false;
  const cleanupTools = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await cleanup();
  };
  const baseSystemPrompt = buildSystemPrompt(
    buildPromptContextInput(context, connections)
  );
  const systemPrompt = input.systemSuffix
    ? `${baseSystemPrompt}\n\n${input.systemSuffix}`
    : baseSystemPrompt;
  const hooks: ChatModelStreamHooks = {
    ...input.hooks,
    async onAbort(event) {
      try {
        await input.hooks?.onAbort?.(event);
      } finally {
        await cleanupTools();
      }
    },
    async onFinish(event) {
      try {
        await input.hooks?.onFinish?.(event);
      } finally {
        await cleanupTools();
      }
    },
  };

  try {
    const result = streamText({
      model,
      providerOptions,
      system: withGatewaySystemCaching(systemPrompt, gatewayContext),
      messages: await convertToModelMessages(input.uiMessages),
      abortSignal: input.abortSignal,
      tools: context.enableTools === false ? undefined : tools,
      stopWhen: CHAT_STOP_WHEN,
      ...hooks,
    });

    return { result, connections, cleanup: cleanupTools };
  } catch (error) {
    await cleanupTools();
    throw error;
  }
}

function recordRunChatAiCall(input: {
  context: RunChatAgentInput;
  model: string;
  startedAt: string;
  startedAtMs: number;
  status: "success" | "failed";
  usage: CapturedUsage;
  finishReason?: string | null;
  error?: string | null;
  stepCount?: number | null;
}) {
  const partialFailure =
    input.status === "failed" && hasCapturedUsage(input.usage);
  void supabaseAdmin
    .from("ai_calls")
    .insert({
      user_id: input.context.userId,
      type: "agent" as const,
      model: input.model,
      ...capturedUsageAiCallColumns(input.usage),
      duration_ms: Date.now() - input.startedAtMs,
      started_at: input.startedAt,
      completed_at: new Date().toISOString(),
      status: input.status,
      error: input.error ?? null,
      conversation_id: input.context.conversationId ?? null,
      repo_id: input.context.repoId ?? null,
      metadata: {
        surface: "slack",
        team_id: input.context.teamId ?? null,
        repo: input.context.repoFullName ?? null,
        repo_owner: input.context.repoOwner ?? null,
        repo_name: input.context.repoName ?? null,
        workspace_session_id: input.context.workspaceSessionId ?? null,
        finish_reason: input.finishReason ?? null,
        step_count: input.stepCount ?? null,
        ...(partialFailure ? { failed_with_partial_usage: true } : {}),
      },
    })
    .then(({ error }) => {
      if (error) {
        console.error("[run-chat-agent] failed to record ai_call", error);
      }
    });
}

async function consumeStreamWithCallback(
  result: ReturnType<typeof streamText>,
  onTextDelta?: RunChatAgentInput["onTextDelta"]
) {
  let accumulated = "";
  for await (const delta of result.textStream) {
    accumulated += delta;
    if (!onTextDelta) continue;
    try {
      await onTextDelta(accumulated);
    } catch (error) {
      console.warn("[run-chat-agent] onTextDelta callback threw", error);
    }
  }
}

export async function runChatAgent(
  input: RunChatAgentInput
): Promise<RunChatAgentResult> {
  const resolvedModel = await resolveChatModelId(input.userId, input.model);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  // Capture step usage as samples so overlapping callbacks cannot drop a merge.
  // The reduced step total remains fallback-only; final stream totals win.
  const observedStepUsages: CapturedUsage[] = [];
  const readObservedUsage = () =>
    observedStepUsages.reduce(
      (usage, stepUsage) => mergeUsage(usage, stepUsage),
      EMPTY_CAPTURED_USAGE
    );

  const { result, cleanup } = await createChatModelStream({
    context: { ...input, surface: "slack" },
    resolvedModel,
    uiMessages: toUIMessages(windowMessages(input.messages)) as Parameters<
      typeof convertToModelMessages
    >[0],
    systemSuffix: input.systemSuffix,
    abortSignal: input.abortSignal,
    hooks: {
      async onStepFinish(event) {
        observedStepUsages.push(
          captureUsage(event.usage, event.providerMetadata)
        );
      },
    },
  });

  try {
    await consumeStreamWithCallback(result, input.onTextDelta);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stream error";
    recordRunChatAiCall({
      context: input,
      model: resolvedModel,
      startedAt,
      startedAtMs,
      status: "failed",
      usage: readObservedUsage(),
      error: message,
    });
    throw error;
  } finally {
    await cleanup();
  }

  const [finalText, finishReason, totalUsage, providerMetadata, steps] =
    await Promise.all([
      result.text,
      result.finishReason,
      result.totalUsage,
      result.providerMetadata,
      result.steps,
    ]);
  const totalCapturedUsage = captureUsage(
    totalUsage as LanguageModelUsage | undefined,
    providerMetadata as ProviderMetadata | undefined
  );
  const observedUsage = readObservedUsage();
  // Union generation IDs from both sources to capture any ID that the SDK
  // surfaces only on the final aggregate (not per-step).
  const usage = fillUsageGaps(
    {
      ...totalCapturedUsage,
      generationId:
        observedUsage.generationId ?? totalCapturedUsage.generationId,
      generationIds: [
        ...new Set([
          ...observedUsage.generationIds,
          ...totalCapturedUsage.generationIds,
        ]),
      ],
    },
    observedUsage
  );
  recordRunChatAiCall({
    context: input,
    model: resolvedModel,
    startedAt,
    startedAtMs,
    status: finishReason === "error" ? "failed" : "success",
    usage,
    finishReason,
    error: finishReason === "error" ? "Stream finished with error" : null,
    stepCount: steps.length,
  });

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return {
    finalText,
    finishReason,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    stepCount: steps.length,
  };
}
