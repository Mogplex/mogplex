import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  mergeUsage,
} from "@/lib/observability/usage";
import type { CliCallOutcome, OpenAiStreamChunk, TokenUsage } from "./types";
import { toOpenAiFinishReason, toOpenAiUsage } from "./response-translation";
import { stringifyUnknown } from "./message-conversion";

function buildOpenAiChunk(input: {
  id: string;
  created: number;
  model: string;
  delta?: Record<string, unknown>;
  finishReason?: string | null;
  usage?: ReturnType<typeof toOpenAiUsage>;
}) {
  return {
    id: input.id,
    object: "chat.completion.chunk",
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta ?? {},
        finish_reason: input.finishReason ?? null,
      },
    ],
    ...(input.usage ? { usage: input.usage } : {}),
  };
}

function readStreamToolCallId(chunk: OpenAiStreamChunk): string | null {
  if (typeof chunk.toolCallId === "string" && chunk.toolCallId.length > 0) {
    return chunk.toolCallId;
  }
  if (typeof chunk.id === "string" && chunk.id.length > 0) {
    return chunk.id;
  }
  return null;
}

function readStreamToolInputDelta(chunk: OpenAiStreamChunk): string {
  if (typeof chunk.inputTextDelta === "string") {
    return chunk.inputTextDelta;
  }
  if (typeof chunk.inputDelta === "string") {
    return chunk.inputDelta;
  }
  if (typeof chunk.delta === "string") {
    return chunk.delta;
  }
  return "";
}

export function createOpenAiChatCompletionStream(input: {
  createResult: () => { fullStream: AsyncIterable<unknown> };
  responseId: string;
  created: number;
  modelId: string;
  onOutcome?: (outcome: CliCallOutcome) => void;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      };
      const close = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      write(
        buildOpenAiChunk({
          id: input.responseId,
          created: input.created,
          model: input.modelId,
          delta: { role: "assistant" },
        })
      );

      const observedToolCalls: Array<{ name: string; input?: unknown }> = [];
      let observedUsage = EMPTY_CAPTURED_USAGE;
      let recorded = false;
      const recordOnce = (outcome: CliCallOutcome) => {
        if (recorded) return;
        recorded = true;
        input.onOutcome?.(outcome);
      };

      try {
        const result = input.createResult();
        const toolIndexes = new Map<
          string,
          { index: number; toolName: string; hasArgumentsPayload: boolean }
        >();
        let nextToolIndex = 0;

        for await (const chunk of result.fullStream) {
          const chunkLike = chunk as OpenAiStreamChunk;
          if (chunkLike.type === "text-delta") {
            const text =
              typeof chunkLike.textDelta === "string"
                ? chunkLike.textDelta
                : typeof chunkLike.text === "string"
                  ? chunkLike.text
                  : "";
            if (text.length > 0) {
              write(
                buildOpenAiChunk({
                  id: input.responseId,
                  created: input.created,
                  model: input.modelId,
                  delta: { content: text },
                })
              );
            }
            continue;
          }

          if (chunkLike.type === "tool-input-start") {
            const toolId =
              readStreamToolCallId(chunkLike) ?? crypto.randomUUID();
            const toolName =
              typeof chunkLike.toolName === "string" &&
              chunkLike.toolName.length > 0
                ? chunkLike.toolName
                : "tool";
            const existing = toolIndexes.get(toolId);
            const index = existing?.index ?? nextToolIndex++;
            toolIndexes.set(toolId, {
              index,
              toolName,
              hasArgumentsPayload: existing?.hasArgumentsPayload ?? false,
            });
            if (!existing) {
              write(
                buildOpenAiChunk({
                  id: input.responseId,
                  created: input.created,
                  model: input.modelId,
                  delta: {
                    tool_calls: [
                      {
                        index,
                        id: toolId,
                        type: "function",
                        function: {
                          name: toolName,
                          arguments: "",
                        },
                      },
                    ],
                  },
                })
              );
            }
            continue;
          }

          if (chunkLike.type === "tool-input-delta") {
            const toolId = readStreamToolCallId(chunkLike);
            const delta = readStreamToolInputDelta(chunkLike);
            const tool = toolId ? toolIndexes.get(toolId) : null;
            if (tool && delta.length > 0) {
              toolIndexes.set(toolId!, {
                ...tool,
                hasArgumentsPayload: true,
              });
              write(
                buildOpenAiChunk({
                  id: input.responseId,
                  created: input.created,
                  model: input.modelId,
                  delta: {
                    tool_calls: [
                      {
                        index: tool.index,
                        function: {
                          arguments: delta,
                        },
                      },
                    ],
                  },
                })
              );
            }
            continue;
          }

          if (chunkLike.type === "tool-call") {
            const toolId =
              readStreamToolCallId(chunkLike) ?? crypto.randomUUID();
            const toolName =
              typeof chunkLike.toolName === "string" &&
              chunkLike.toolName.length > 0
                ? chunkLike.toolName
                : "tool";
            const existing = toolIndexes.get(toolId);
            const index = existing?.index ?? nextToolIndex++;
            const toolArguments = stringifyUnknown(chunkLike.input ?? {});
            toolIndexes.set(toolId, {
              index,
              toolName: existing?.toolName ?? toolName,
              hasArgumentsPayload: existing?.hasArgumentsPayload ?? true,
            });
            observedToolCalls.push({
              name: toolName,
              input: chunkLike.input ?? undefined,
            });
            if (!existing) {
              write(
                buildOpenAiChunk({
                  id: input.responseId,
                  created: input.created,
                  model: input.modelId,
                  delta: {
                    tool_calls: [
                      {
                        index,
                        id: toolId,
                        type: "function",
                        function: {
                          name: toolName,
                          arguments: toolArguments,
                        },
                      },
                    ],
                  },
                })
              );
            } else if (!existing.hasArgumentsPayload) {
              toolIndexes.set(toolId, {
                index,
                toolName: existing.toolName,
                hasArgumentsPayload: true,
              });
              write(
                buildOpenAiChunk({
                  id: input.responseId,
                  created: input.created,
                  model: input.modelId,
                  delta: {
                    tool_calls: [
                      {
                        index,
                        function: {
                          arguments: toolArguments,
                        },
                      },
                    ],
                  },
                })
              );
            }
            continue;
          }

          if (chunkLike.type === "finish-step") {
            observedUsage = mergeUsage(
              observedUsage,
              captureUsage(
                chunkLike.usage as LanguageModelUsage | undefined,
                chunkLike.providerMetadata as ProviderMetadata | undefined
              )
            );
            continue;
          }

          if (chunkLike.type === "error") {
            // `streamText` surfaces some provider failures as an `error` chunk
            // rather than throwing. Rethrow so the outer catch emits the
            // structured SSE error frame instead of falsely closing with [DONE].
            const errorValue = chunkLike.error;
            throw errorValue instanceof Error
              ? errorValue
              : new Error(
                  typeof errorValue === "string"
                    ? errorValue
                    : stringifyUnknown(errorValue)
                );
          }

          if (chunkLike.type === "finish") {
            const inputTokens =
              typeof chunkLike.totalUsage === "object" &&
              chunkLike.totalUsage &&
              "inputTokens" in chunkLike.totalUsage
                ? (chunkLike.totalUsage as TokenUsage)?.inputTokens
                : undefined;
            const outputTokens =
              typeof chunkLike.totalUsage === "object" &&
              chunkLike.totalUsage &&
              "outputTokens" in chunkLike.totalUsage
                ? (chunkLike.totalUsage as TokenUsage)?.outputTokens
                : undefined;
            observedUsage = fillUsageGaps(
              observedUsage,
              captureUsage(
                chunkLike.totalUsage as LanguageModelUsage | undefined,
                undefined
              )
            );
            write(
              buildOpenAiChunk({
                id: input.responseId,
                created: input.created,
                model: input.modelId,
                finishReason: toOpenAiFinishReason(
                  typeof chunkLike.finishReason === "string"
                    ? chunkLike.finishReason
                    : undefined
                ),
                usage: toOpenAiUsage({ inputTokens, outputTokens }),
              })
            );
          }
        }
        recordOnce({
          status: "success",
          usage: observedUsage,
          toolCalls: observedToolCalls,
        });
        try {
          close();
        } catch {
          /* controller may already be closed */
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream error";
        recordOnce({ status: "failed", error: message, usage: observedUsage });
        try {
          write({ error: { message } });
        } catch {
          /* controller may already be closed */
        }
        try {
          close();
        } catch {
          /* controller may already be closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
