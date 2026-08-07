import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createAiCall } from "@/lib/interactive-runs";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { withGatewaySystemCaching } from "@/lib/models/gateway-provider-routing";
import {
  buildOrchestratorTools,
  wrapToolsWithPolicy,
  buildOrchestratorSystemPrompt,
  type OrchestratorToolContext,
  type OrchestratorPromptContext,
} from "@/lib/agents/orchestrator";
import {
  getControlChatRunScope,
  buildControlChatRunMetadata,
  buildControlGatewayContext,
  resolveGithubTokenForRepo,
} from "./context";
import {
  createToolCallStartHandler,
  createToolCallFinishHandler,
} from "./telemetry";
import {
  markControlRunStreaming,
  finalizeCancelledControlRun,
  finalizeFinishedControlRun,
} from "./lifecycle";
import type {
  ControlChatRequestBody,
  ActiveControlCall,
  ControlStartupFailure,
} from "./types";

/**
 * Stop condition for the orchestrator - allow more steps for complex planning.
 */
export const ORCHESTRATOR_STOP_WHEN = stepCountIs(150);

/**
 * Execute the Control chat request and return the streaming response.
 */
export async function executeControlChatRequest(input: {
  req: Request;
  userId: string;
  body: ControlChatRequestBody;
  resolvedModel: string;
  limitClaimId: string | null;
  callStartedAt: string;
}) {
  const scope = getControlChatRunScope(input.body);
  const teamId = readActiveTeamIdHeader(input.req);
  let aiCall: ActiveControlCall | null = null;

  try {
    aiCall = await createAiCall({
      userId: input.userId,
      type: "agent",
      model: input.resolvedModel,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      limitClaimId: input.limitClaimId,
      startedAt: input.callStartedAt,
      status: "pending",
      metadata: buildControlChatRunMetadata(input.body, teamId),
    });
    const activeCall = aiCall;

    // Build orchestrator context
    const githubToken = await resolveGithubTokenForRepo(
      input.userId,
      input.body.repoId
    );

    const toolContext: OrchestratorToolContext = {
      userId: input.userId,
      sandboxId: input.body.sandboxId,
      repoId: input.body.repoId,
      repoOwner: input.body.repoOwner,
      repoName: input.body.repoName,
      repoBranch: input.body.repoBranch,
      repoBaseBranch: input.body.repoBaseBranch,
      githubToken,
      teamId,
      missionId: input.body.missionId,
    };

    const promptContext: OrchestratorPromptContext = {
      repoFullName: input.body.repoFullName ?? undefined,
      repoOwner: input.body.repoOwner ?? undefined,
      repoName: input.body.repoName ?? undefined,
      repoBranch: input.body.repoBranch ?? undefined,
      repoBaseBranch: input.body.repoBaseBranch ?? undefined,
      missionId: input.body.missionId ?? undefined,
      missionTitle: input.body.missionTitle ?? undefined,
    };

    // Build tools with policy wrapping
    const rawTools = buildOrchestratorTools(toolContext);
    const tools =
      input.body.enableTools === false
        ? undefined
        : wrapToolsWithPolicy(rawTools, toolContext);

    // Build system prompt
    const systemPrompt = buildOrchestratorSystemPrompt(promptContext);

    // Resolve model
    const gatewayContext = buildControlGatewayContext(input.userId, input.body);
    const { model, providerOptions } = await resolveUserLanguageModel(
      input.userId,
      input.resolvedModel,
      {
        gatewayContext,
        teamId: teamId ?? null,
      }
    );

    await markControlRunStreaming(
      activeCall,
      input.userId,
      scope,
      input.resolvedModel,
      input.body.enableTools ?? true
    );

    let finalized = false;

    // Convert messages to model format. Clients send AI SDK UIMessages
    // (`parts`); a plain `content` string/array is also accepted.
    const uiMessages = input.body.messages.map((message) => {
      const parts =
        message.parts ??
        (typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : (message.content ?? []));
      return {
        role: message.role as "user" | "assistant" | "system",
        parts: parts
          .filter((part) => part.type === "text")
          .map((part) => ({
            type: "text" as const,
            text: part.text ?? "",
          })),
      };
    });

    const result = streamText({
      model,
      providerOptions,
      system: withGatewaySystemCaching(systemPrompt, gatewayContext),
      messages: await convertToModelMessages(uiMessages),
      abortSignal: input.req.signal,
      tools,
      stopWhen: ORCHESTRATOR_STOP_WHEN,
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
        await finalizeCancelledControlRun({
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
        await finalizeFinishedControlRun({
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
    });

    return {
      aiCall: activeCall,
      response: result.toUIMessageStreamResponse({
        messageMetadata: () => ({ ai_call_id: activeCall.id }),
      }),
    };
  } catch (error) {
    const startupError =
      error instanceof Error ? error : new Error("Failed to start control run");
    (startupError as ControlStartupFailure).aiCall = aiCall;
    throw startupError;
  }
}
