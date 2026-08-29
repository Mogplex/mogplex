import {
  convertToModelMessages,
  type streamText,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai";
import {
  COMPACTION_CHAR_BUDGET,
  compactConversation,
  estimateMessagesChars,
  type CompactionEventPayload,
} from "@/lib/agents/compaction";
import {
  loadLatestCompaction,
  persistCompactionEvent,
} from "@/lib/agents/compaction/store";
import { windowMessages } from "@/lib/agents/message-window";
import {
  createChatModelStream,
  resolveChatModelId,
  type RunChatAgentMessage,
  type ChatAgentContext,
} from "@/lib/agents/run-chat";
import {
  createRunChatProgressReporter,
  type RunChatAgentProgressCallback,
} from "@/lib/agents/run-chat-progress";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { createSlackRunFinalization } from "@/lib/agents/slack-run-finalization";
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

/**
 * Non-HTTP agent runner. Drives the same `streamText` loop the chat route uses
 * — same model resolver, tools, system prompt, and stop condition — but
 * consumes the stream in-process and returns the accumulated text.
 *
 * Used by adapters like the Slack event handler that need the model's final
 * answer rather than a UI stream.
 */

export type RunChatAgentInput = ChatAgentContext & {
  messages: RunChatAgentMessage[];
  latestUserText: string;
  model?: string | null;
  systemSuffix?: string | null;
  abortSignal?: AbortSignal;
  /**
   * Reports safe output and tool lifecycle events to external chat surfaces.
   * Tool inputs, tool outputs, and model reasoning are never included. Errors
   * from the callback are caught so a progress surface cannot abort the run.
   */
  onProgress?: RunChatAgentProgressCallback;
};

export type RunChatAgentResult = {
  finalText: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stepCount: number;
};

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

type AgentCompaction = {
  messages: RunChatAgentMessage[];
  changed: boolean;
  event: CompactionEventPayload | null;
};

/**
 * Conversation-level compaction for in-process runs. The full transcript
 * stays in the surface's conversation record (audit); the model input is
 * rebuilt as [checkpoint handoff, recent turns]. When the history is under
 * budget or compaction fails, the caller's windowing fallback applies —
 * degrading to exactly the pre-compaction behavior.
 */
async function compactAgentConversation(
  input: RunChatAgentInput,
  resolvedModel: string
): Promise<AgentCompaction> {
  const unchanged: AgentCompaction = {
    messages: input.messages,
    changed: false,
    event: null,
  };
  if (!input.conversationId) return unchanged;
  if (estimateMessagesChars(input.messages) <= COMPACTION_CHAR_BUDGET) {
    return unchanged;
  }

  try {
    const previous = await loadLatestCompaction({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    const { model } = await resolveUserLanguageModel(
      input.userId,
      resolvedModel,
      {
        gatewayContext: {
          userId: input.userId,
          tags: ["surface:compaction"],
          caching: "off",
        },
        teamId: input.teamId ?? null,
      }
    );
    const result = await compactConversation<RunChatAgentMessage>({
      messages: input.messages,
      model,
      compactorModelId: resolvedModel,
      previous,
      buildHandoffMessage: (handoffText) => ({
        role: "user",
        content: handoffText,
      }),
      abortSignal: input.abortSignal,
    });

    if (result.outcome === "compacted") {
      return { messages: result.messages, changed: true, event: result.event };
    }
    if (result.outcome === "reused") {
      return { messages: result.messages, changed: true, event: null };
    }
    if (result.outcome === "failed") {
      console.warn("[run-chat-agent] compaction failed; windowing instead", {
        conversationId: input.conversationId,
        error: result.error,
      });
      return { ...unchanged, event: result.event };
    }
    return unchanged;
  } catch (error) {
    console.error("[run-chat-agent] compaction errored; windowing instead", {
      conversationId: input.conversationId,
      error,
    });
    return unchanged;
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
  compactionEvent?: CompactionEventPayload | null;
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
    .select("id")
    .single()
    .then(async ({ data, error }) => {
      if (error || !data) {
        console.error("[run-chat-agent] failed to record ai_call", error);
        return;
      }
      // The checkpoint audit row needs the ai_call id, which only exists
      // after the run's insert — persist it here rather than mid-run.
      if (input.compactionEvent) {
        await persistCompactionEvent({
          aiCallId: data.id as string,
          userId: input.context.userId,
          conversationId: input.context.conversationId ?? null,
          repoId: input.context.repoId ?? null,
          payload: input.compactionEvent,
        });
      }
    });
}

async function consumeStreamWithCallback(
  result: ReturnType<typeof streamText>,
  reporter: ReturnType<typeof createRunChatProgressReporter>
) {
  for await (const delta of result.textStream) {
    await reporter.textDelta(delta);
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
  const progressReporter = createRunChatProgressReporter(input.onProgress);
  const finalization = createSlackRunFinalization({
    userId: input.userId,
    userText: input.latestUserText,
    repoName: input.repoName,
    sandboxId: input.sandboxId,
  });

  const compaction = await compactAgentConversation(input, resolvedModel);
  // Compacted histories are already bounded; otherwise the pre-compaction
  // windowing behavior applies unchanged.
  const sourceMessages = compaction.changed
    ? compaction.messages
    : windowMessages(input.messages);

  const { result, cleanup } = await createChatModelStream({
    context: { ...input, surface: "slack" },
    resolvedModel,
    uiMessages: toUIMessages(sourceMessages) as Parameters<
      typeof convertToModelMessages
    >[0],
    systemSuffix: input.systemSuffix,
    abortSignal: input.abortSignal,
    hooks: {
      onChunk(event) {
        if (event.chunk.type === "reasoning-delta") {
          return progressReporter.modelWorking();
        }
      },
      experimental_onToolCallStart(event) {
        finalization.onToolStart(event);
        return progressReporter.toolStarted(event);
      },
      experimental_onToolCallFinish(event) {
        finalization.onToolFinish(event);
        return progressReporter.toolFinished(event);
      },
      async onStepFinish(event) {
        observedStepUsages.push(
          captureUsage(event.usage, event.providerMetadata)
        );
      },
    },
  });

  try {
    await consumeStreamWithCallback(result, progressReporter);
  } catch (error) {
    await finalization.cleanup();
    const message = error instanceof Error ? error.message : "Stream error";
    recordRunChatAiCall({
      context: input,
      model: resolvedModel,
      startedAt,
      startedAtMs,
      status: "failed",
      usage: readObservedUsage(),
      error: message,
      compactionEvent: compaction.event,
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
    compactionEvent: compaction.event,
  });

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const userFacingFinalText = await finalization.finalize(finalText);

  return {
    finalText: userFacingFinalText,
    finishReason,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    stepCount: steps.length,
  };
}
