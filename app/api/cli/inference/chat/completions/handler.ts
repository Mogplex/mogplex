import { NextResponse } from "next/server";
import {
  generateText,
  jsonSchema,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata,
} from "ai";
import { requireUserId } from "@/lib/auth";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";
import { resolveUserDefaultModelId } from "@/lib/models/default-model";
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

// `runtime` is declared on the route segment file (`route.ts`). Next.js only
// honors it there, so we intentionally do not re-declare it in this handler.

type OpenAiContentPart =
  | { type?: "text"; text?: string }
  | { type?: "image_url"; image_url?: { url?: string } | string };

type OpenAiMessage = {
  role?: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

type OpenAiTool = {
  type?: "function";
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type OpenAiChatRequest = {
  messages?: OpenAiMessage[];
  model?: string | null;
  tools?: OpenAiTool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | {
        type?: "function";
        function?: { name?: string };
      };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  max_tokens?: number;
  max_completion_tokens?: number;
};

type TokenUsage =
  | {
      inputTokens?: number | null;
      outputTokens?: number | null;
    }
  | null
  | undefined;

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

type UserContent = UserContentPart[];

type AiToolChoice = Parameters<typeof streamText>[0]["toolChoice"];

type OpenAiUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number;
};

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

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isToolInputObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOpenAiToolCallArguments(
  value: unknown
): Record<string, unknown> {
  if (isToolInputObject(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return {};
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isToolInputObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function coerceTextContent(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : part.image_url?.url;
        return url ? `[image: ${url}]` : "";
      }
      return stringifyUnknown(part);
    })
    .filter(Boolean)
    .join("\n");
}

function toUserContent(content: OpenAiMessage["content"]): UserContent {
  if (typeof content === "string") {
    return [{ type: "text", text: content.length > 0 ? content : "(empty)" }];
  }
  if (!Array.isArray(content)) {
    return [{ type: "text", text: "(empty)" }];
  }

  const parts = content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") {
        return { type: "text" as const, text: part.text };
      }
      if (part?.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : part.image_url?.url;
        if (typeof url === "string" && url.length > 0) {
          return { type: "image" as const, image: url };
        }
      }
      const fallback = stringifyUnknown(part);
      return fallback.length > 0
        ? { type: "text" as const, text: fallback }
        : null;
    })
    .filter((part): part is UserContentPart => part !== null);

  return parts.length > 0 ? parts : [{ type: "text", text: "(empty)" }];
}

export function toModelMessages(messages: OpenAiMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    switch (message.role) {
      case "system":
        return [
          {
            role: "system",
            content: coerceTextContent(message.content) || "(empty)",
          },
        ];
      case "user":
        return [{ role: "user", content: toUserContent(message.content) }];
      case "assistant": {
        const content: Array<Record<string, unknown>> = [];
        const text = coerceTextContent(message.content);
        if (text) {
          content.push({ type: "text", text });
        }
        for (const toolCall of message.tool_calls ?? []) {
          const toolName = toolCall.function?.name;
          if (!toolName) continue;
          content.push({
            type: "tool-call",
            toolCallId: toolCall.id ?? crypto.randomUUID(),
            toolName,
            input: parseOpenAiToolCallArguments(toolCall.function?.arguments),
          });
        }
        return [
          {
            role: "assistant",
            content:
              content.length > 0
                ? (content as ModelMessage["content"])
                : [{ type: "text", text: "(no response)" }],
          } as ModelMessage,
        ];
      }
      case "tool":
        return [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: message.tool_call_id ?? crypto.randomUUID(),
                // OpenAI's wire format only carries tool_call_id on tool
                // results, not the tool name — so we cannot populate toolName
                // here. Providers that require it (e.g. Anthropic) must be
                // used through the native chat endpoint, not this compat shim.
                toolName: "",
                output: {
                  type: "text",
                  value: coerceTextContent(message.content) || "(empty)",
                },
              },
            ],
          } as ModelMessage,
        ];
      default:
        return [];
    }
  });
}

function toAiTools(tools: OpenAiTool[] | undefined) {
  if (!tools?.length) return undefined;
  const entries = tools.flatMap((tool) => {
    if (tool.type !== "function") return [];
    const name = tool.function?.name?.trim();
    if (!name) return [];
    return [
      [
        name,
        {
          description: tool.function?.description ?? "",
          inputSchema: jsonSchema(
            (tool.function?.parameters ?? {
              type: "object",
              properties: {},
            }) as object
          ),
        },
      ] as const,
    ];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function resolveCliModelId(
  userId: string,
  requestedModel?: string | null
): Promise<string> {
  const explicitModel = requestedModel?.trim();
  if (explicitModel) {
    const resolved = await resolveExplicitCliModelId(explicitModel);
    if (resolved) return resolved;
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const fallback = await resolveUserDefaultModelId(
    userId,
    profile?.default_model
  );
  if (!fallback) {
    throw new Error("No enabled model is configured for this account.");
  }
  return fallback;
}

async function resolveExplicitCliModelId(
  modelId: string
): Promise<string | null> {
  if (modelId.includes("/")) return modelId;
  const { data: catalogRow } = await supabaseAdmin
    .from("ai_models")
    .select("provider")
    .eq("id", modelId)
    .maybeSingle();
  if (typeof catalogRow?.provider === "string") {
    return `${catalogRow.provider}/${modelId}`;
  }
  // Bare slug with no catalog match — treat as unresolved so the caller
  // can fall back to the user's configured default. Older CLI versions
  // ship hardcoded bare defaults (e.g. "claude-opus-4-7") that never match
  // the canonical `provider/model-id` shape of `ai_models.id`; without this
  // fallback those requests are forwarded to the Vercel AI Gateway, which
  // rejects them with a 500 that surfaces in the CLI as an opaque
  // "Internal server error".
  return null;
}

function toOpenAiFinishReason(reason: string | null | undefined) {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "content-filter") return "content_filter";
  if (reason === "length") return "length";
  return "stop";
}

function toOpenAiUsage(usage: TokenUsage): OpenAiUsage | undefined {
  const promptTokens = usage?.inputTokens ?? null;
  const completionTokens = usage?.outputTokens ?? null;
  if (promptTokens == null && completionTokens == null) {
    return undefined;
  }
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

export function toOpenAiToolCalls(
  toolCalls: Array<{ toolCallId?: string; toolName: string; input: unknown }>
) {
  if (toolCalls.length === 0) return undefined;
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId ?? crypto.randomUUID(),
    type: "function" as const,
    function: {
      name: toolCall.toolName,
      arguments: stringifyUnknown(toolCall.input || {}),
    },
  }));
}

type CliCallOutcome =
  | {
      status: "success";
      usage: CapturedUsage;
      toolCalls: Array<{ name: string; input?: unknown }>;
    }
  | { status: "failed"; error: string; usage?: CapturedUsage };

/**
 * Record a single CLI inference call in `ai_calls` so it surfaces in the
 * observability dashboard alongside automation and flow runs. Fire-and-forget:
 * telemetry failures are logged but never block the response.
 */
function recordCliInferenceCall(input: {
  userId: string;
  model: string;
  startedAt: string;
  startedAtMs: number;
  streaming: boolean;
  outcome: CliCallOutcome;
}): void {
  const toolCalls =
    input.outcome.status === "success" ? input.outcome.toolCalls : [];
  const usage =
    input.outcome.status === "success"
      ? input.outcome.usage
      : (input.outcome.usage ?? EMPTY_CAPTURED_USAGE);
  const partialFailure =
    input.outcome.status === "failed" && hasCapturedUsage(usage);
  const payload = {
    user_id: input.userId,
    type: "chat" as const,
    model: input.model,
    ...capturedUsageAiCallColumns(usage),
    duration_ms: Date.now() - input.startedAtMs,
    started_at: input.startedAt,
    completed_at: new Date().toISOString(),
    status: input.outcome.status,
    error: input.outcome.status === "failed" ? input.outcome.error : null,
    tool_calls_count: toolCalls.length,
    tool_calls: toolCalls,
    metadata: {
      source: "cli",
      streaming: input.streaming,
      ...(partialFailure ? { failed_with_partial_usage: true } : {}),
    },
  };
  void supabaseAdmin
    .from("ai_calls")
    .insert(payload)
    .then(({ error }) => {
      if (error) {
        console.error("[cli-inference] failed to record ai_call", error);
      }
    });
}

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

type OpenAiStreamChunk = { type: string; [key: string]: unknown };

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
