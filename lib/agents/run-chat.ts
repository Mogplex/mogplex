import { streamText, convertToModelMessages } from "ai";
import type { SandboxCommandExecution } from "@/lib/agents/tools/sandbox";
import { buildTools } from "@/lib/agents/tools";
import { selectChatTools } from "@/lib/agents/chat-surface-tools";
import type { Tool, ModelMessage } from "ai";
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
import { withChatStreamCleanup } from "@/lib/agents/chat-stream-cleanup";
import { withChatStreamDecisions } from "@/lib/agents/chat-stream-decisions";
import {
  readUserTexts,
  renderConversationSkills,
  resolveConversationSkills,
  withoutSkills,
  type ConversationSkills,
} from "@/lib/skill-catalog/chat";
import type { SkillLoadHint } from "@/lib/skill-catalog/render";

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
  /** Trusted server transport override; never accepted from model input. */
  sandboxExecution?: SandboxCommandExecution;
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
  /** Latest user-authored text; never model- or tool-authored. */
  latestUserText?: string | null;
  /**
   * Active team scope, if the request was made inside one. Solo turns leave
   * this null/undefined. Threaded into both buildTools (for capability
   * filtering) and resolveUserLanguageModel (for model gate + scoped key).
   */
  teamId?: string | null;
  /** Owning ai_call, when the caller tracks one; links decision events. */
  aiCallId?: string | null;
};

type StreamTextOptions = Parameters<typeof streamText>[0];

/**
 * Optional hooks the HTTP route uses to drive its `ai_calls` telemetry. The
 * in-process runner leaves these unset.
 */
export type ChatModelStreamHooks = Partial<
  Pick<
    StreamTextOptions,
    | "onToolExecutionStart"
    | "onToolExecutionEnd"
    | "onAbort"
    | "onChunk"
    | "onError"
    | "onEnd"
    | "onStepEnd"
  >
>;

// Explicitly disable the SDK default step cap. Completion, cancellation and
// provider errors still end the stream; a tool-call count never does.
export const CHAT_STOP_WHEN = () => false;

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
  requestedModel?: string | null,
  surface: "chat" | "slack" = "chat"
): Promise<string> {
  if (requestedModel) return requestedModel;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .single();
  return resolveUserDefaultModelId(userId, profile?.default_model, surface);
}

function buildToolsInput(context: ChatAgentContext) {
  return {
    sandboxExecution: context.sandboxExecution,
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
    latestUserText: context.latestUserText,
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
  /**
   * Caller-scoped tools merged in after surface filtering. The Slack event
   * handler uses this to expose a repo-agent launcher bound to the inbound
   * Slack message.
   */
  additionalTools?: Record<string, Tool>;
  /** Server-owned input delivered at an actual model-step boundary. */
  prepareMessages?: (
    messages: ModelMessage[],
    stepNumber: number
  ) => Promise<ModelMessage[]>;
  /**
   * Skills the caller already delivers in `systemSuffix` (a roster agent's
   * attached skills), so the catalog block does not repeat them.
   */
  attachedSkillIds?: readonly string[];
  /**
   * Told which skills this turn has in play, once the catalog is known. The
   * caller decides how to keep its own follow-up work alive; this never waits.
   * Called once per stream. A caller that may build several streams for one
   * turn must collect what it starts here rather than keep only the last.
   */
  onSkillsResolved?: (skills: ConversationSkills) => void;
  /** Seams for tests. Production callers leave this unset. */
  deps?: Partial<ChatModelStreamDeps>;
};

export type ChatModelStreamDeps = {
  resolveModel: typeof resolveUserLanguageModel;
  buildTools: typeof buildTools;
  resolveSkills: typeof resolveConversationSkills;
};

const defaultChatModelStreamDeps: ChatModelStreamDeps = {
  resolveModel: resolveUserLanguageModel,
  buildTools,
  resolveSkills: resolveConversationSkills,
};

function startConversationSkills(
  deps: ChatModelStreamDeps,
  context: ChatAgentContext,
  input: Pick<CreateChatModelStreamInput, "uiMessages">
) {
  return deps.resolveSkills({
    userId: context.userId,
    repoId: context.repoId ?? null,
    userTexts: readUserTexts(input.uiMessages),
  });
}

function notifySkillsResolved(
  input: Pick<CreateChatModelStreamInput, "onSkillsResolved">,
  skills: ConversationSkills
) {
  try {
    input.onSkillsResolved?.(skills);
  } catch (error) {
    console.warn("[chat] skills observer failed", error);
  }
}

/** An agent is only told about skills it was not handed if it can load one. */
function skillLoadHint(
  context: ChatAgentContext,
  tools: Record<string, Tool>
): SkillLoadHint {
  return context.enableTools !== false && "load_skill" in tools
    ? "tool"
    : "none";
}

/** Joins the prompt sections that exist, each separated by a blank line. */
export function composeChatSystemPrompt(
  sections: Array<string | null | undefined>
) {
  return sections.filter((section) => section?.trim()).join("\n\n");
}

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
  const deps = { ...defaultChatModelStreamDeps, ...input.deps };
  const context = await prepareChatContextForDelivery(input.context);
  // Started now and read once the tools are known, so it never adds a wait.
  const conversationSkills = startConversationSkills(deps, context, input);

  const gatewayContext = buildChatGatewayContext(context);
  const { model, providerOptions } = await deps.resolveModel(
    context.userId,
    input.resolvedModel,
    {
      gatewayContext,
      teamId: context.teamId ?? null,
    }
  );

  const {
    tools: builtTools,
    connections,
    cleanup,
  } = await deps.buildTools(buildToolsInput(context));
  const tools = selectChatTools({
    tools: builtTools,
    surface: context.surface ?? "chat",
    additionalTools: input.additionalTools,
  });
  let cleanedUp = false;
  const cleanupTools = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await cleanup();
  };
  const baseSystemPrompt = buildSystemPrompt(
    buildPromptContextInput(context, connections)
  );
  // The index only helps an agent that holds load_skill; a team role or a
  // tools-off turn without it still gets the skills the user invoked.
  const skills = withoutSkills(
    await conversationSkills,
    input.attachedSkillIds
  );
  notifySkillsResolved(input, skills);
  const systemPrompt = composeChatSystemPrompt([
    baseSystemPrompt,
    renderConversationSkills(skills, skillLoadHint(context, tools)),
    input.systemSuffix,
  ]);
  const hooks = withChatStreamCleanup(
    withChatStreamDecisions(input.hooks, {
      surface: context.surface ?? "chat",
      userId: context.userId,
      teamId: context.teamId ?? null,
      repoId: context.repoId ?? null,
      aiCallId: context.aiCallId ?? null,
      conversationId: context.conversationId ?? null,
    }),
    cleanupTools
  );

  try {
    const result = streamText({
      model,
      providerOptions,
      instructions: withGatewaySystemCaching(systemPrompt, gatewayContext),
      messages: await convertToModelMessages(input.uiMessages),
      // The existing chat contract includes caller-authored system messages.
      allowSystemInMessages: true,
      abortSignal: input.abortSignal,
      tools: context.enableTools === false ? undefined : tools,
      stopWhen: CHAT_STOP_WHEN,
      // Step-level context reduction: within a long tool loop, demote stale
      // oversized tool outputs to typed references so a long run cannot
      // outgrow the window on dead payloads. Deterministic — no model call.
      prepareStep: async ({ messages, stepNumber }) => {
        const prepared = input.prepareMessages
          ? await input.prepareMessages(messages, stepNumber)
          : messages;
        const reduced = demoteStaleToolOutputs(prepared);
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
