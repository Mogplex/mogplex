import {
  createChatModelStream,
  resolveChatModelId,
} from "@/lib/agents/run-chat";
import {
  loadOwnedAiCall,
  updateAiCallIfActive,
  safeAppendAiCallEvent,
  finalizeAiCallIfNotCancelled,
  finalizeAiCallAsCancelledIfActive,
  buildAiCallCompletionUpdate,
} from "@/lib/interactive-runs";
import {
  captureUsage,
  mergeUsage,
  EMPTY_CAPTURED_USAGE,
} from "@/lib/observability/usage";
import { createSlackRunProgressReporter } from "@/lib/slack/run-progress-notify";
import { createNativeRunControl } from "./native-run-control";
import { ensureNativeRunExecutionLease } from "./run-execution-lease";
import {
  loadNativeRunContext,
  buildNativeRunMessages,
} from "./native-run-context";
import type { ExternalAgentRunRow } from "./runs-types";
import type { SandboxRef } from "./run-execution-launch";

const defaultDeps = {
  ensureExecutionLease: ensureNativeRunExecutionLease,
  loadContext: loadNativeRunContext,
  buildMessages: buildNativeRunMessages,
  resolveModel: resolveChatModelId,
  createStream: createChatModelStream,
  createControl: createNativeRunControl,
  createProgress: createSlackRunProgressReporter,
  loadCall: loadOwnedAiCall,
  updateCall: updateAiCallIfActive,
  appendEvent: safeAppendAiCallEvent,
  finishCall: finalizeAiCallIfNotCancelled,
  cancelCall: finalizeAiCallAsCancelledIfActive,
};

/** Run Mogplex's shared agent core against the already-owned sandbox and ai_call. */
export async function runNativeMogplexAgent(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<{ output: string }> {
  const deps = { ...defaultDeps, ...overrides };
  const call = await deps.loadCall(run.user_id, run.ai_call_id);
  if (call?.repo_id !== run.repo_id) throw new Error("Agent call not found");
  if (call.status !== "pending" && call.status !== "streaming")
    return { output: "" };
  let control: Awaited<ReturnType<typeof createNativeRunControl>> | undefined;
  let stream: Awaited<ReturnType<typeof createChatModelStream>> | undefined;
  const progress = deps.createProgress(run);
  let usage = EMPTY_CAPTURED_USAGE;
  let output = "";
  let pendingText = "";
  let toolCount = 0;
  const event = (
    data: Pick<
      Parameters<typeof safeAppendAiCallEvent>[0],
      "eventType" | "message" | "payload" | "toolName"
    >
  ) =>
    deps.appendEvent({
      aiCallId: call.id,
      userId: run.user_id,
      repoId: run.repo_id,
      conversationId: run.conversation_id,
      ...data,
    });
  // Bound telemetry writes by text size, not provider token/chunk count.
  // Tool boundaries and completion flush the remainder without a polling timer.
  const flushText = async () => {
    const text = pendingText;
    pendingText = "";
    if (text)
      await event({
        eventType: "log",
        message: text,
        payload: { kind: "assistant_delta" },
      });
  };
  const finish = async (
    status: "success" | "failed" | "cancelled",
    error: string | null
  ) => {
    await flushText();
    const update = buildAiCallCompletionUpdate({
      startedAt: call.started_at,
      status,
      error,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      reasoningTokens: usage.reasoningTokens,
      gatewayGenerationId: usage.generationId,
      metadata: {
        ...call.metadata,
        harness_id: "mogplex",
        gateway_generation_ids: usage.generationIds,
      },
    });
    const updated =
      status === "cancelled"
        ? await deps.cancelCall(call.id, {
            ...update,
            tool_calls_count: toolCount,
          })
        : await deps.finishCall(call.id, {
            ...update,
            tool_calls_count: toolCount,
          });
    if (updated)
      await event({
        eventType: status === "success" ? "finished" : status,
        message: error ?? "Mogplex run finished",
      });
    return updated;
  };
  try {
    control = await deps.createControl(run.user_id, call.id);
    control.signal.throwIfAborted();
    const context = await deps.loadContext(run, sandbox);
    await deps.ensureExecutionLease(run, sandbox, context.teamId);
    const resolvedModel = await deps.resolveModel(run.user_id);
    const uiMessages = await deps.buildMessages(run);
    control.signal.throwIfAborted();
    const active = await deps.updateCall(call.id, {
      model: resolvedModel,
      status: "streaming",
    });
    if (!active) {
      await finish("cancelled", null);
      return { output };
    }
    await event({
      eventType: "started",
      message: "Mogplex agent run started",
      payload: { harness_id: "mogplex", model: resolvedModel },
    });
    stream = await deps.createStream({
      context,
      resolvedModel,
      uiMessages,
      abortSignal: control.signal,
      hooks: {
        onStepFinish(step) {
          usage = mergeUsage(
            usage,
            captureUsage(step.usage, step.providerMetadata)
          );
        },
        async experimental_onToolCallStart({ toolCall }) {
          toolCount += 1;
          await flushText();
          await event({
            eventType: "tool_started",
            toolName: toolCall.toolName,
            message: `${toolCall.toolName} started`,
            payload: { toolCallId: toolCall.toolCallId },
          });
          await progress.report({
            kind: "tool_started",
            toolName: toolCall.toolName,
          });
        },
        async experimental_onToolCallFinish({ toolCall, success }) {
          await event({
            eventType: "tool_finished",
            toolName: toolCall.toolName,
            message: `${toolCall.toolName} ${success ? "finished" : "failed"}`,
            payload: {
              toolCallId: toolCall.toolCallId,
              state: success ? "success" : "error",
            },
          });
          await progress.report({
            kind: "tool_finished",
            toolName: toolCall.toolName,
            state: success ? "success" : "error",
          });
        },
      },
    });
    // fullStream surfaces provider errors, unlike a text-only consumer.
    for await (const part of stream.result.fullStream) {
      control.signal.throwIfAborted();
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") {
        output += part.text;
        pendingText += part.text;
        if (pendingText.length >= 2048) await flushText();
        await progress.report({ kind: "assistant_text", text: part.text });
      }
    }
    control.signal.throwIfAborted();
    const reason = await stream.result.finishReason;
    if (reason !== "stop") throw new Error(`Mogplex run stopped: ${reason}`);
    const completed = await finish("success", null);
    // A cancel may win the database CAS after the last stream event.
    if (!completed) await finish("cancelled", null);
    return { output };
  } catch (error) {
    if (control?.isCancelled()) {
      await finish("cancelled", null);
      return { output };
    }
    await finish(
      "failed",
      error instanceof Error ? error.message : "Mogplex run failed"
    );
    throw error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      stream?.cleanup(),
      control?.close(),
      progress.flush(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected")
        console.warn("[native-run] cleanup failed", result.reason);
    }
  }
}
