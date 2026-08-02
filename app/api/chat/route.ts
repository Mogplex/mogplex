import {
  createChatModelStream,
  resolveChatModelId,
  type ChatModelStreamHooks,
} from "@/lib/agents/run-chat";
import { requireUserId } from "@/lib/auth";
import {
  buildLimitResponse,
  enforceChatLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import {
  appendAiCallEvent,
  buildAiCallCompletionUpdate,
  createAiCall,
  safeAppendAiCallEvent,
  updateAiCall,
} from "@/lib/interactive-runs";
import {
  previewTelemetryValue,
  sanitizeTelemetryValue as sanitizeToolPayload,
} from "@/lib/ai-telemetry";
import { captureUsage } from "@/lib/observability/usage";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";
import type { MemoryScope } from "@/lib/memories-client";
import type { LanguageModelUsage, ProviderMetadata } from "ai";

const MEMORY_CONTEXT_TIMEOUT_MS = 3000;
const SESSION_MEMORY_DUPLICATE_WINDOW_MS = 60_000;
const SESSION_MEMORY_RETENTION_LIMIT = 50;
const SESSION_MEMORY_PRUNE_SCAN_LIMIT = 75;

type ChatRequestMessage = {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
};

type ChatRequestBody = {
  messages: ChatRequestMessage[];
  model?: string | null;
  enableTools?: boolean;
  sandboxId?: string | null;
  repoFullName?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  conversationId?: string | null;
  repoId?: string | null;
  workspaceSessionId?: string | null;
};

type ChatRunScope = {
  conversationId: string | null;
  repoId: string | null;
};

type ChatRunMetadata = {
  sandbox_id: string | null;
  repo: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  repo_branch: string | null;
};

type ChatMemoryContext = {
  rules?: Array<{ content: string }>;
  memories?: Array<{ content: string }>;
} | null;

type ActiveChatCall = Awaited<ReturnType<typeof createAiCall>>;

type ChatStartupFailure = Error & {
  aiCall?: ActiveChatCall | null;
};

function summarizeToolCalls(
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>
) {
  return steps.flatMap((step) =>
    (step.toolCalls || []).map((toolCall, index) => {
      const input = sanitizeToolPayload(toolCall.input);
      const output = sanitizeToolPayload(step.toolResults?.[index]);

      return {
        name: toolCall.toolName,
        input,
        output,
        input_preview: previewTelemetryValue(input),
        output_preview: previewTelemetryValue(output),
      };
    })
  );
}

type ChatPostDeps = {
  requireUserId: typeof requireUserId;
  enforceChatLimits: typeof enforceChatLimits;
};

const defaultChatPostDeps: ChatPostDeps = {
  requireUserId,
  enforceChatLimits,
};

function getChatRunScope(body: ChatRequestBody): ChatRunScope {
  return {
    conversationId: body.conversationId || null,
    repoId: body.repoId || null,
  };
}

function buildChatRunMetadata(body: ChatRequestBody): ChatRunMetadata {
  return {
    sandbox_id: body.sandboxId ?? null,
    repo: body.repoFullName ?? null,
    repo_owner: body.repoOwner ?? null,
    repo_name: body.repoName ?? null,
    repo_branch: body.repoBranch ?? null,
  };
}

export function buildMemoryQueryFromMessages(messages: ChatRequestMessage[]) {
  const latestUserText = extractLatestUserText(messages, 200);
  return latestUserText || "general context";
}

function extractLatestUserText(
  messages: ChatRequestMessage[],
  maxLength = 2_000
) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const rawContent = lastUserMessage?.content;

  if (typeof rawContent === "string") {
    return rawContent.slice(0, maxLength);
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ")
      .slice(0, maxLength);
  }

  return "";
}

export function buildMemoryContextSection(context: ChatMemoryContext) {
  if (context?.rules?.length) {
    const sectionLines: string[] = [
      "## Rules",
      ...context.rules.map((rule) => `- ${rule.content}`),
    ];
    if (context.memories?.length) {
      sectionLines.push(
        "## Relevant Memories",
        ...context.memories.map((memory) => `- ${memory.content}`)
      );
    }
    return sectionLines.join("\n");
  }

  if (context?.memories?.length) {
    return [
      "## Relevant Memories",
      ...context.memories.map((memory) => `- ${memory.content}`),
    ].join("\n");
  }

  return null;
}

function getChatMemoryScope(body: ChatRequestBody): MemoryScope | undefined {
  const scope: MemoryScope = {};

  if (body.repoId) scope.repoId = body.repoId;
  if (body.workspaceSessionId) {
    scope.workspaceSessionId = body.workspaceSessionId;
  }
  if (body.conversationId) scope.conversationId = body.conversationId;
  if (body.sandboxId) scope.sandboxId = body.sandboxId;

  return Object.keys(scope).length > 0 ? scope : undefined;
}

async function loadMemoryContext(
  userId: string,
  messages: ChatRequestMessage[],
  scope?: MemoryScope
): Promise<ChatMemoryContext> {
  try {
    const { loadMemoryContextNative } = await import("@/lib/memories-client");
    return Promise.race([
      loadMemoryContextNative(
        userId,
        buildMemoryQueryFromMessages(messages),
        10,
        undefined,
        scope
      ),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MEMORY_CONTEXT_TIMEOUT_MS)
      ),
    ]);
  } catch (error) {
    // The timeout leg of the Promise.race resolves null rather than
    // rejecting, so anything landing here is an unexpected failure worth
    // logging at error level for ops visibility.
    console.error(
      "Memory context injection failed:",
      error instanceof Error ? (error.stack ?? error.message) : error
    );
    return null;
  }
}

async function buildChatMemorySuffix(
  userId: string,
  body: ChatRequestBody
): Promise<string | null> {
  const memoryContext = await loadMemoryContext(
    userId,
    body.messages,
    getChatMemoryScope(body)
  );
  const memorySection = buildMemoryContextSection(memoryContext);
  return memorySection
    ? `<memory-context>\n${memorySection}\n</memory-context>`
    : null;
}

async function persistChatSessionMemory(userId: string, body: ChatRequestBody) {
  const content = extractLatestUserText(body.messages);
  if (!content.trim()) return;

  try {
    const {
      addToLane,
      buildLaneScopedMetadata,
      createMemoriesClient,
      forgetMemory,
      getMemoryScopeForLane,
      listByLane,
    } = await import("@/lib/memories-client");

    const client = createMemoriesClient(userId);
    const memoryScope = getMemoryScopeForLane(
      "session",
      getChatMemoryScope(body)
    );
    const recentRows = await listByLane(
      client,
      "session",
      SESSION_MEMORY_PRUNE_SCAN_LIMIT,
      memoryScope
    );
    const pruneOverflowRows = async (startIndex: number) => {
      const overflowRows = recentRows.slice(startIndex);
      if (overflowRows.length === 0) return;
      await Promise.allSettled(
        overflowRows.map((row) => forgetMemory(client, row.id))
      );
    };
    const latestRow = recentRows[0];
    if (latestRow?.content === content) {
      const createdAtMs = Date.parse(latestRow.created_at);
      if (
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs < SESSION_MEMORY_DUPLICATE_WINDOW_MS
      ) {
        // Best-effort dedupe only. Concurrent identical submissions can still
        // race past this check, but the scoped retention cap bounds the fallout.
        await pruneOverflowRows(SESSION_MEMORY_RETENTION_LIMIT);
        return;
      }
    }

    await addToLane(
      client,
      "session",
      content,
      buildLaneScopedMetadata(
        "session",
        {
          role: "user",
        },
        {
          ...getChatMemoryScope(body),
          source: "native-chat",
          agent: "native",
        }
      ),
      { skipEmbedding: true }
    );
    await pruneOverflowRows(SESSION_MEMORY_RETENTION_LIMIT - 1);
  } catch (error) {
    console.warn("[chat] failed to persist session memory", error);
  }
}

async function releaseChatLimitClaimIfNeeded(
  userId: string,
  limitClaimId: string | null
) {
  if (!limitClaimId) {
    return;
  }

  await releaseLimitClaim({
    userId,
    routeKey: "chat",
    claimId: limitClaimId,
  });
}

async function markChatRunStreaming(
  activeCall: ActiveChatCall,
  userId: string,
  scope: ChatRunScope,
  resolvedModel: string,
  enableTools: boolean
) {
  await appendAiCallEvent({
    aiCallId: activeCall.id,
    userId,
    conversationId: scope.conversationId,
    repoId: scope.repoId,
    eventType: "started",
    message: "Chat run started",
    payload: {
      model: resolvedModel,
      tool_enabled: enableTools,
    },
  });

  await updateAiCall(activeCall.id, { status: "streaming" });
  await appendAiCallEvent({
    aiCallId: activeCall.id,
    userId,
    conversationId: scope.conversationId,
    repoId: scope.repoId,
    eventType: "status_changed",
    message: "Chat run streaming",
    payload: { from: "pending", to: "streaming" },
  });
}

function createToolCallStartHandler(
  activeCall: ActiveChatCall,
  userId: string,
  scope: ChatRunScope
) {
  return function handleToolCallStart(event: {
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
    stepNumber?: number | null;
  }) {
    const input = sanitizeToolPayload(event.toolCall.input);
    void safeAppendAiCallEvent({
      aiCallId: activeCall.id,
      userId,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      eventType: "tool_started",
      toolName: event.toolCall.toolName,
      message: `Tool started: ${event.toolCall.toolName}`,
      payload: {
        tool_call_id: event.toolCall.toolCallId,
        input,
        input_preview: previewTelemetryValue(input),
        step_number: event.stepNumber ?? null,
      },
    });
  };
}

function createToolCallFinishPayload(event: {
  success: boolean;
  output?: unknown;
  error?: unknown;
  durationMs?: number | null;
  stepNumber?: number | null;
  toolCall: { input?: unknown; toolCallId: string; toolName: string };
}) {
  const input = sanitizeToolPayload(event.toolCall.input);
  const output = event.success ? sanitizeToolPayload(event.output) : undefined;
  const error = event.success
    ? null
    : event.error instanceof Error
      ? event.error.message
      : String(event.error);

  return {
    message: event.success
      ? `Tool finished: ${event.toolCall.toolName}`
      : `Tool failed: ${event.toolCall.toolName}`,
    payload: {
      tool_call_id: event.toolCall.toolCallId,
      input,
      input_preview: previewTelemetryValue(input),
      ...(event.success
        ? {
            output,
            output_preview: previewTelemetryValue(output),
          }
        : {
            error,
          }),
      duration_ms: event.durationMs,
      success: event.success,
      step_number: event.stepNumber ?? null,
    },
  };
}

function createToolCallFinishHandler(
  activeCall: ActiveChatCall,
  userId: string,
  scope: ChatRunScope
) {
  return function handleToolCallFinish(event: {
    success: boolean;
    output?: unknown;
    error?: unknown;
    durationMs?: number | null;
    stepNumber?: number | null;
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
  }) {
    const finished = createToolCallFinishPayload(event);
    void safeAppendAiCallEvent({
      aiCallId: activeCall.id,
      userId,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      eventType: "tool_finished",
      toolName: event.toolCall.toolName,
      message: finished.message,
      payload: finished.payload,
    });
  };
}

function getChatRunFinishState(finishReason: string | null | undefined): {
  status: "success" | "failed";
  error: string | null;
  eventType: "finished" | "failed";
  message: string;
} {
  const status = finishReason === "error" ? "failed" : "success";
  return {
    status,
    error: finishReason === "error" ? "Stream finished with error" : null,
    eventType: status === "failed" ? "failed" : ("finished" as const),
    message: status === "failed" ? "Chat run failed" : "Chat run finished",
  };
}

async function finalizeCancelledChatRun(input: {
  activeCall: ActiveChatCall;
  userId: string;
  scope: ChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  const toolCalls = summarizeToolCalls(input.steps);
  await updateAiCall(
    input.activeCall.id,
    buildAiCallCompletionUpdate({
      startedAt: input.callStartedAt,
      status: "cancelled",
      toolCalls,
      metadata: input.activeCall.metadata,
    })
  );
  await safeAppendAiCallEvent({
    aiCallId: input.activeCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: "cancelled",
    message: "Chat run cancelled",
    payload: {
      tool_calls_count: toolCalls.length,
    },
  });
}

async function finalizeFinishedChatRun(input: {
  activeCall: ActiveChatCall;
  userId: string;
  scope: ChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  finishReason: string | null | undefined;
  totalUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  } | null;
  providerMetadata?: ProviderMetadata;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  const toolCalls = summarizeToolCalls(input.steps);
  const completion = getChatRunFinishState(input.finishReason);
  const usage = captureUsage(
    input.totalUsage as LanguageModelUsage | undefined,
    input.providerMetadata
  );

  await updateAiCall(
    input.activeCall.id,
    buildAiCallCompletionUpdate({
      startedAt: input.callStartedAt,
      status: completion.status,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      reasoningTokens: usage.reasoningTokens,
      gatewayGenerationId: usage.generationId,
      error: completion.error,
      toolCalls,
      metadata: input.activeCall.metadata,
    })
  );
  await safeAppendAiCallEvent({
    aiCallId: input.activeCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: completion.eventType,
    message: completion.message,
    payload: {
      finish_reason: input.finishReason,
      tool_calls_count: toolCalls.length,
      total_tokens:
        (input.totalUsage?.inputTokens ?? 0) +
        (input.totalUsage?.outputTokens ?? 0),
      error: completion.error,
    },
  });
}

async function persistChatStartupFailure(input: {
  aiCall: ActiveChatCall | null;
  userId: string;
  scope: ChatRunScope;
  callStartedAt: string;
  limitClaimId: string | null;
  message: string;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  if (!input.aiCall) {
    return;
  }

  try {
    await updateAiCall(
      input.aiCall.id,
      buildAiCallCompletionUpdate({
        startedAt: input.callStartedAt,
        status: "failed",
        error: input.message,
        metadata: input.aiCall.metadata,
      })
    );
  } catch (persistError) {
    console.error("[chat] failed to persist startup failure", {
      aiCallId: input.aiCall.id,
      persistError,
    });
  }

  await safeAppendAiCallEvent({
    aiCallId: input.aiCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: "failed",
    message: "Chat run failed before streaming",
    payload: { error: input.message },
  });
}

async function executeChatRequest(input: {
  req: Request;
  userId: string;
  body: ChatRequestBody;
  resolvedModel: string;
  limitClaimId: string | null;
  callStartedAt: string;
}) {
  const scope = getChatRunScope(input.body);
  let aiCall: ActiveChatCall | null = null;

  try {
    aiCall = await createAiCall({
      userId: input.userId,
      type: "chat",
      model: input.resolvedModel,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      limitClaimId: input.limitClaimId,
      startedAt: input.callStartedAt,
      status: "pending",
      metadata: buildChatRunMetadata(input.body),
    });
    const activeCall = aiCall;

    const systemSuffix = await buildChatMemorySuffix(input.userId, input.body);
    await markChatRunStreaming(
      activeCall,
      input.userId,
      scope,
      input.resolvedModel,
      input.body.enableTools ?? true
    );
    void persistChatSessionMemory(input.userId, input.body);

    let finalized = false;

    const hooks: ChatModelStreamHooks = {
      experimental_onToolCallStart: createToolCallStartHandler(
        activeCall,
        input.userId,
        scope
      ),
      experimental_onToolCallFinish: createToolCallFinishHandler(
        activeCall,
        input.userId,
        scope
      ),
      async onAbort({ steps }) {
        if (finalized) return;
        finalized = true;
        await finalizeCancelledChatRun({
          activeCall,
          userId: input.userId,
          scope,
          limitClaimId: input.limitClaimId,
          callStartedAt: input.callStartedAt,
          steps,
        });
      },
      async onFinish({ totalUsage, steps, finishReason, providerMetadata }) {
        if (finalized) return;
        finalized = true;
        await finalizeFinishedChatRun({
          activeCall,
          userId: input.userId,
          scope,
          limitClaimId: input.limitClaimId,
          callStartedAt: input.callStartedAt,
          finishReason,
          totalUsage,
          providerMetadata,
          steps,
        });
      },
    };

    const { result } = await createChatModelStream({
      context: {
        userId: input.userId,
        repoId: input.body.repoId,
        repoOwner: input.body.repoOwner,
        repoName: input.body.repoName,
        repoBranch: input.body.repoBranch,
        repoFullName: input.body.repoFullName,
        sandboxId: input.body.sandboxId,
        workspaceSessionId: input.body.workspaceSessionId,
        conversationId: input.body.conversationId,
        enableTools: input.body.enableTools,
        teamId: readActiveTeamIdHeader(input.req),
      },
      resolvedModel: input.resolvedModel,
      uiMessages: input.body.messages as Parameters<
        typeof createChatModelStream
      >[0]["uiMessages"],
      systemSuffix,
      abortSignal: input.req.signal,
      hooks,
    });

    return {
      aiCall: activeCall,
      response: result.toUIMessageStreamResponse({
        messageMetadata: () => ({ ai_call_id: activeCall.id }),
      }),
    };
  } catch (error) {
    const startupError =
      error instanceof Error ? error : new Error("Failed to start chat run");
    (startupError as ChatStartupFailure).aiCall = aiCall;
    throw startupError;
  }
}

export function createChatPostHandler(overrides: Partial<ChatPostDeps> = {}) {
  const deps: ChatPostDeps = {
    ...defaultChatPostDeps,
    ...overrides,
  };

  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await req.json()) as ChatRequestBody;
    const scope = getChatRunScope(body);

    const limitDecision = await deps.enforceChatLimits({
      userId,
      repoId: scope.repoId,
      sandboxId: body.sandboxId ?? null,
    });
    if (!limitDecision.allowed) {
      return buildLimitResponse(limitDecision);
    }

    const limitClaimId = limitDecision.claimId ?? null;
    const callStartedAt = new Date().toISOString();
    const resolvedModel = await resolveChatModelId(userId, body.model);

    try {
      const result = await executeChatRequest({
        req,
        userId,
        body,
        resolvedModel,
        limitClaimId,
        callStartedAt,
      });
      return result.response;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start chat run";
      const aiCall = (error as ChatStartupFailure | null)?.aiCall ?? null;

      await persistChatStartupFailure({
        aiCall,
        userId,
        scope,
        callStartedAt,
        limitClaimId,
        message,
      });

      // 503 + Retry-After for an unreadable team allowlist, matching the other
      // resolver surfaces: the failure is transient and its own copy says to
      // try again, so a 500 (which reads as a bug) would mislead the client.
      if (isModelAllowlistUnavailableError(error)) {
        return Response.json(
          { error: message },
          {
            status: 503,
            headers: {
              "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
            },
          }
        );
      }

      return Response.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createChatPostHandler();
