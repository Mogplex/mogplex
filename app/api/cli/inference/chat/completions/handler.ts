import { NextResponse } from "next/server";
import { generateText, streamText } from "ai";
import { requireUserId } from "@/lib/auth";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";
import { captureUsage } from "@/lib/observability/usage";
import type { AiToolChoice, OpenAiChatRequest } from "./types";
import { toModelMessages, toAiTools } from "./message-conversion";
import {
  toOpenAiFinishReason,
  toOpenAiUsage,
  toOpenAiToolCalls,
} from "./response-translation";
import { resolveCliModelId } from "./model-resolution";
import { recordCliInferenceCall } from "./usage-recording";
import { createOpenAiChatCompletionStream } from "./streaming";

// `runtime` is declared on the route segment file (`route.ts`). Next.js only
// honors it there, so we intentionally do not re-declare it in this handler.

// Re-export public API for backwards compatibility
export {
  parseOpenAiToolCallArguments,
  toModelMessages,
} from "./message-conversion";
export { toOpenAiToolCalls } from "./response-translation";
export { createOpenAiChatCompletionStream } from "./streaming";

function errorResponse(
  message: string,
  status = 400,
  headers?: Record<string, string>
) {
  return NextResponse.json(
    { error: { message } },
    { status, ...(headers ? { headers } : {}) }
  );
}

/**
 * Provider-agnostic OpenAI-compatible chat-completions handler for the
 * hosted CLI. Accepts an OpenAI-shaped request and dispatches it through
 * the AI SDK to whichever provider the resolved user model belongs to.
 *
 * Known limitations:
 * - `tool` role messages lose their tool name. OpenAI's wire format only
 *   carries `tool_call_id` on tool results, so providers that require a
 *   `toolName` on tool-result parts (notably Anthropic when used without a
 *   compat gateway) may reject requests that include tool results. Callers
 *   that need strict cross-provider tool-result fidelity should use the
 *   native `/api/chat` endpoint instead of this OpenAI compat shim.
 */
export async function postChatCompletions(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  let body: OpenAiChatRequest;
  try {
    body = (await request.json()) as OpenAiChatRequest;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse("messages is required");
  }

  let modelId: string;
  try {
    modelId = await resolveCliModelId(userId, body.model);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Could not resolve a model",
      400
    );
  }

  let resolved: Awaited<ReturnType<typeof resolveUserLanguageModel>>;
  try {
    resolved = await resolveUserLanguageModel(userId, modelId, {
      preferGatewayProviderObject: true,
      gatewayContext: {
        userId,
        tags: ["surface:cli", body.stream === false ? "oneshot" : "streaming"],
      },
      teamId: readActiveTeamIdHeader(request),
    });
  } catch (error) {
    // See the note in app/api/agents/generate/route.ts: everything else here is
    // a permanent access decision, but an unreadable allowlist is not.
    const transient = isModelAllowlistUnavailableError(error);
    return errorResponse(
      error instanceof Error ? error.message : "Model access is unavailable",
      transient ? 503 : 400,
      transient
        ? {
            "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
          }
        : undefined
    );
  }

  let toolChoice: AiToolChoice;
  if (
    body.tool_choice === "auto" ||
    body.tool_choice === "none" ||
    body.tool_choice === "required"
  ) {
    toolChoice = body.tool_choice;
  } else {
    const toolName = body.tool_choice?.function?.name?.trim();
    toolChoice =
      body.tool_choice?.type === "function" && toolName
        ? { type: "tool", toolName }
        : undefined;
  }

  const sharedOptions = {
    model: resolved.model,
    providerOptions: resolved.providerOptions,
    messages: toModelMessages(messages),
    tools: toAiTools(body.tools) as Parameters<typeof streamText>[0]["tools"],
    toolChoice,
    temperature: body.temperature,
    topP: body.top_p,
    stopSequences: Array.isArray(body.stop)
      ? body.stop
      : typeof body.stop === "string"
        ? [body.stop]
        : undefined,
    maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
  } satisfies Partial<Parameters<typeof streamText>[0]>;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  if (body.stream === false) {
    try {
      const result = await generateText(
        sharedOptions as Parameters<typeof generateText>[0]
      );
      const usage = captureUsage(result.usage, result.providerMetadata);
      recordCliInferenceCall({
        userId,
        model: modelId,
        startedAt,
        startedAtMs,
        streaming: false,
        outcome: {
          status: "success",
          usage,
          toolCalls: result.toolCalls.map((tc) => ({
            name: tc.toolName,
            input: tc.input,
          })),
        },
      });
      return NextResponse.json({
        id: `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.text || null,
              tool_calls: toOpenAiToolCalls(
                result.toolCalls.map((toolCall) => ({
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input,
                }))
              ),
            },
            finish_reason: toOpenAiFinishReason(result.finishReason),
          },
        ],
        usage: toOpenAiUsage({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Generation failed";
      recordCliInferenceCall({
        userId,
        model: modelId,
        startedAt,
        startedAtMs,
        streaming: false,
        outcome: { status: "failed", error: message },
      });
      return errorResponse(message, 500);
    }
  }

  const responseId = `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`;
  const created = Math.floor(Date.now() / 1000);
  return createOpenAiChatCompletionStream({
    createResult: () =>
      streamText(sharedOptions as Parameters<typeof streamText>[0]),
    responseId,
    created,
    modelId,
    onOutcome: (outcome) => {
      recordCliInferenceCall({
        userId,
        model: modelId,
        startedAt,
        startedAtMs,
        streaming: true,
        outcome,
      });
    },
  });
}
