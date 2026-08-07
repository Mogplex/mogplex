import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import { FlowServiceError } from "@/lib/flows/errors";
import { createFlowAssistantTools } from "@/lib/flows/assistant-tools";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";
import {
  FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
  FLOW_ASSISTANT_RESULT_DATA_TYPE,
} from "@/lib/flows/assistant-chat-payload";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import {
  assertOwnedFlowGraphAgents,
  loadOwnedFlow as loadOwnedFlowProd,
} from "@/lib/flows/server";
import {
  isFlowsE2ETestMode,
  generateFlowAssistantSuggestion as generateFlowAssistantSuggestionTest,
} from "@/lib/flows/test-store";
import {
  FLOW_ASSISTANT_MODEL_ID,
  FLOW_ASSISTANT_MAX_STEPS,
  FLOW_ASSISTANT_SYSTEM_PROMPT,
  FLOW_ASSISTANT_CHAT_SYSTEM_PROMPT,
  buildFlowAssistantResultData,
  mergeFlowAssistantUsage,
  flowAssistantIncompleteError,
} from "@/lib/flows/api-assistant-prompts";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { recordAiCallTelemetry } from "@/lib/observability/ai-call-telemetry";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlowGraph } from "@/lib/types";
import { unwrapRowsOrThrow } from "@/lib/flows/supabase-result";
import type { Capability } from "@/lib/team-capabilities";
import type { LanguageModelUsage, UIMessage } from "ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractLatestFlowAssistantGraphState(
  messages: Parameters<typeof convertToModelMessages>[0]
): FlowGraph | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex] as UIMessage;
    if (!Array.isArray(message.parts)) continue;
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      if (
        !isRecord(part) ||
        part.type !== FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const output = part.output;
      if (!isRecord(output)) continue;
      return coerceGraph(output.graph);
    }
  }
  return null;
}

/**
 * Streams a multi-turn chat for the in-canvas Flow assistant. Reuses the same
 * tool set as {@link generateFlowAssistantSuggestion}; the resulting working
 * graph is sent as a one-turn data part so later requests can prune it.
 */
export async function streamFlowAssistantChat(input: {
  userId: string;
  flowId: string;
  teamId?: string | null;
  capabilities?: ReadonlySet<Capability>;
  messages: Parameters<typeof convertToModelMessages>[0];
}): Promise<Response> {
  if (isFlowsE2ETestMode()) {
    throw new FlowServiceError(
      "FLOW_NOT_FOUND",
      "Flow assistant chat is not available in test mode"
    );
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const { data: agents, error: agentsError } = await supabaseAdmin
    .from("agents")
    .select("id, name, slug")
    .eq("user_id", input.userId)
    .order("name", { ascending: true });

  if (agentsError) {
    throw new Error(agentsError.message);
  }

  const allowedAgents = (agents ?? []).map((agent) => ({
    id: agent.id as string,
    name: agent.name as string,
    slug: agent.slug as string,
  }));

  const gatewayContext = {
    userId: input.userId,
    tags: ["surface:flow_assistant", `flow:${input.flowId}`],
  };
  const { model, providerOptions } = await resolveUserLanguageModel(
    input.userId,
    FLOW_ASSISTANT_MODEL_ID,
    {
      gatewayContext,
      teamId: input.teamId ?? null,
      capabilities: input.capabilities,
    }
  );

  const graph = extractLatestFlowAssistantGraphState(input.messages);
  const allowedModelIds = await listUsableModelIdsForScope(input.userId, {
    teamId: input.teamId ?? null,
  }).catch((error) => {
    console.error("[flows] failed to load usable models for assistant", error);
    return [] as string[];
  });
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: graph,
    allowedAgents,
    allowedModelIds,
    includeGraphStateTool: true,
  });

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const observedStepUsages: CapturedUsage[] = [];
  const result = streamText({
    model,
    providerOptions,
    system: [
      FLOW_ASSISTANT_CHAT_SYSTEM_PROMPT,
      `Current flow name: ${flow.name}`,
      `Available agents: ${JSON.stringify(allowedAgents)}`,
    ].join("\n\n"),
    messages: await convertToModelMessages(input.messages),
    tools,
    stopWhen: stepCountIs(FLOW_ASSISTANT_MAX_STEPS),
    async onStepFinish(event) {
      observedStepUsages.push(
        captureUsage(event.usage, event.providerMetadata)
      );
    },
    async onFinish({ totalUsage, providerMetadata, finishReason, steps }) {
      const observedUsage = observedStepUsages.reduce(
        (usage, stepUsage) => mergeUsage(usage, stepUsage),
        EMPTY_CAPTURED_USAGE
      );
      const totalCapturedUsage = captureUsage(
        totalUsage as LanguageModelUsage | undefined,
        providerMetadata
      );
      await recordAiCallTelemetry({
        userId: input.userId,
        type: "agent",
        model: FLOW_ASSISTANT_MODEL_ID,
        usage: fillUsageGaps(
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
        ),
        startedAtMs,
        startedAt,
        status: finishReason === "error" ? "failed" : "success",
        error: finishReason === "error" ? "Flow assistant stream failed" : null,
        metadata: {
          surface: "flow_assistant",
          team_id: input.teamId ?? null,
          flow_id: input.flowId,
          mode: "chat",
          finish_reason: finishReason,
          step_count: steps.length,
        },
        logPrefix: "[flow-assistant]",
      });
    },
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const uiStream = result.toUIMessageStream({
        sendFinish: false,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish") return undefined;
          if (part.finishReason === "tool-calls") return undefined;
          const data = buildFlowAssistantResultData(getResult());
          return {
            flowAssistant: {
              summary: data.summary,
              finalized: data.finalized,
              valid: data.valid,
              errors: data.errors,
            },
          };
        },
      });
      for await (const part of uiStream) {
        writer.write(part);
      }
      const finishReason = await result.finishReason;
      const data = buildFlowAssistantResultData(getResult());
      if (data.graph) {
        writer.write({
          type: FLOW_ASSISTANT_RESULT_DATA_TYPE,
          data,
        });
      }
      const messageMetadata =
        finishReason === "tool-calls"
          ? undefined
          : {
              flowAssistant: {
                summary: data.summary,
                finalized: data.finalized,
                valid: data.valid,
                errors: data.errors,
              },
            };
      writer.write({
        type: "finish",
        finishReason,
        ...(messageMetadata ? { messageMetadata } : {}),
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export async function generateFlowAssistantSuggestion(input: {
  userId: string;
  flowId: string;
  teamId?: string | null;
  capabilities?: ReadonlySet<Capability>;
  message: string;
  graph: FlowGraph;
}) {
  if (isFlowsE2ETestMode()) {
    return generateFlowAssistantSuggestionTest(input);
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const agents = unwrapRowsOrThrow(
    await supabaseAdmin
      .from("agents")
      .select("id, name, slug")
      .eq("user_id", input.userId)
      .order("name", { ascending: true })
  );

  const gatewayContext = {
    userId: input.userId,
    tags: ["surface:flow_assistant", `flow:${input.flowId}`],
  };
  const { model, providerOptions } = await resolveUserLanguageModel(
    input.userId,
    FLOW_ASSISTANT_MODEL_ID,
    {
      gatewayContext,
      teamId: input.teamId ?? null,
      capabilities: input.capabilities,
    }
  );

  const allowedAgents = agents.map((agent) => ({
    id: agent.id as string,
    name: agent.name as string,
    slug: agent.slug as string,
  }));

  const allowedModelIds = await listUsableModelIdsForScope(input.userId, {
    teamId: input.teamId ?? null,
  }).catch((error) => {
    console.error("[flows] failed to load usable models for assistant", error);
    return [] as string[];
  });

  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: input.graph,
    allowedAgents,
    allowedModelIds,
  });

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const observedStepUsages: CapturedUsage[] = [];
  const generation = await generateText({
    model,
    providerOptions,
    system: FLOW_ASSISTANT_SYSTEM_PROMPT,
    prompt: [
      `User request: ${input.message}`,
      `Current flow name: ${flow.name}`,
      `Current graph JSON: ${JSON.stringify(input.graph)}`,
      `Available agents: ${JSON.stringify(allowedAgents)}`,
      "When the flow is correct and connected from start to end, call finalize with a short summary. Do not emit prose — call tools only.",
    ].join("\n\n"),
    tools,
    stopWhen: stepCountIs(FLOW_ASSISTANT_MAX_STEPS),
    onStepFinish(event) {
      observedStepUsages.push(
        captureUsage(event.usage, event.providerMetadata)
      );
    },
  });
  await recordAiCallTelemetry({
    userId: input.userId,
    type: "agent",
    model: FLOW_ASSISTANT_MODEL_ID,
    usage: mergeFlowAssistantUsage(observedStepUsages, generation),
    startedAtMs,
    startedAt,
    status: "success",
    metadata: {
      surface: "flow_assistant",
      team_id: input.teamId ?? null,
      flow_id: input.flowId,
      mode: "suggestion",
      finish_reason: generation.finishReason,
      step_count: generation.steps.length,
    },
    logPrefix: "[flow-assistant]",
  });

  const result = getResult();
  if (!result.done) {
    throw flowAssistantIncompleteError(generation.steps?.length ?? 0);
  }

  const graph = coerceGraph(result.graph);
  const validation = validateFlowGraph(graph, { requireRunnableConfig: true });
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_ASSISTANT_INVALID_GRAPH",
      "Assistant produced an invalid flow graph",
      { details: validation.errors }
    );
  }

  await assertOwnedFlowGraphAgents(input.userId, graph);

  return {
    summary: result.summary ?? "",
    graph,
  };
}
