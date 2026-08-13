import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createAiCall } from "@/lib/interactive-runs";
import { compactChatMessagesForModel } from "@/lib/agents/compaction/chat-adapter";
import { promoteMemoriesForConversation } from "@/lib/agents/memory-promotion-runner";
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
  resolveSelectedControlSandboxId,
  resolveControlPromptSandboxes,
  resolveControlPromptWorktrees,
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
import { normalizeControlChatMessages } from "./messages";
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
    const [githubToken, activeSandboxes, worktreeContext] = await Promise.all([
      resolveGithubTokenForRepo(input.userId, input.body.repoId),
      resolveControlPromptSandboxes(input.req, input.body),
      resolveControlPromptWorktrees(input.userId, input.body),
    ]);

    const toolContext: OrchestratorToolContext = {
      userId: input.userId,
      sandboxId: resolveSelectedControlSandboxId(activeSandboxes),
      repoId: input.body.repoId,
      repoOwner: input.body.repoOwner,
      repoName: input.body.repoName,
      repoBranch: input.body.repoBranch,
      repoBaseBranch: input.body.repoBaseBranch,
      githubToken,
      teamId,
      missionId: input.body.missionId,
      orchestrationRunId: worktreeContext.orchestrationRunId,
      conversationId: scope.conversationId,
      aiCallId: activeCall.id,
      controlMode: input.body.mode ?? null,
      controlPermissions: input.body.permissions ?? null,
    };

    const promptContext: OrchestratorPromptContext = {
      repoFullName: input.body.repoFullName ?? undefined,
      repoOwner: input.body.repoOwner ?? undefined,
      repoName: input.body.repoName ?? undefined,
      repoBranch: input.body.repoBranch ?? undefined,
      repoBaseBranch: input.body.repoBaseBranch ?? undefined,
      missionId: input.body.missionId ?? undefined,
      missionTitle: input.body.missionTitle ?? undefined,
      controlScope: input.body.scope ?? undefined,
      controlTarget: input.body.target ?? undefined,
      controlPermissions: input.body.permissions ?? undefined,
      controlMode: input.body.mode ?? undefined,
      activeSandboxes,
      activeWorktrees: worktreeContext.worktrees,
    };

    // Build tools with policy wrapping
    const rawTools = buildOrchestratorTools(toolContext);
    const tools =
      input.body.enableTools === false
        ? undefined
        : wrapToolsWithPolicy(rawTools, toolContext);

    // Build system prompt
    const systemPrompt = buildOrchestratorSystemPrompt({
      ...promptContext,
      availableToolNames:
        input.body.enableTools === false ? [] : Object.keys(rawTools),
    });

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
    const uiMessages = normalizeControlChatMessages(input.body.messages);

    // Compact oversized histories into a checkpoint handoff (same adapter as
    // /api/chat: validated checkpoint, prefix reuse, ai_call_events audit).
    // Degrades to the unmodified history on failure.
    const modelMessages = await compactChatMessagesForModel({
      userId: input.userId,
      conversationId: scope.conversationId ?? null,
      repoId: scope.repoId ?? null,
      aiCallId: activeCall.id,
      resolvedModel: input.resolvedModel,
      teamId: teamId ?? null,
      uiMessages,
      abortSignal: input.req.signal,
    });

    const result = streamText({
      model,
      providerOptions,
      system: withGatewaySystemCaching(systemPrompt, gatewayContext),
      messages: await convertToModelMessages(modelMessages),
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
        // Memory promotion (compaction plan Phase 4): distill durable facts
        // from this conversation's checkpoint, if one exists. Best-effort by
        // contract — never lets a promotion failure touch the finished run.
        promoteMemoriesForConversation({
          userId: input.userId,
          conversationId: scope.conversationId ?? null,
          repoId: scope.repoId ?? null,
          aiCallId: activeCall.id,
          model,
        }).catch((error: unknown) => {
          console.warn("[memory-promotion] failed", {
            conversationId: scope.conversationId,
            error,
          });
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
