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
import { supabaseAdmin } from "@/lib/supabase/admin";
import { demoteStaleToolOutputs } from "@/lib/agents/compaction/reduce";

/**
 * The shared streaming core for every chat entry point: model resolution,
 * tool wiring, system prompt, message conversion, and `stopWhen`. The HTTP
 * chat route and the in-process runner (`run-chat-agent.ts`) both build on
 * `createChatModelStream` so these cannot drift.
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
    | "onChunk"
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
      // Step-level context reduction: within a long tool loop, demote stale
      // oversized tool outputs to typed references so a 100-step run cannot
      // outgrow the window on dead payloads. Deterministic — no model call.
      prepareStep: ({ messages }) => {
        const reduced = demoteStaleToolOutputs(messages);
        return reduced === messages ? undefined : { messages: reduced };
      },
      ...hooks,
    });

    return { result, connections, cleanup: cleanupTools };
  } catch (error) {
    await cleanupTools();
    throw error;
  }
}
