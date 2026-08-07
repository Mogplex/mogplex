import {
  createChatModelStream,
  type ChatModelStreamHooks,
} from "@/lib/agents/run-chat";
import { createAiCall } from "@/lib/interactive-runs";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import type {
  ActiveChatCall,
  ChatRequestBody,
  ChatStartupFailure,
} from "./types";
import { getChatRunScope, buildChatRunMetadata } from "./types";
import { buildChatMemorySuffix } from "./memory";
import { persistChatSessionMemory } from "./session-memory";
import {
  markChatRunStreaming,
  createToolCallStartHandler,
  createToolCallFinishHandler,
} from "./events";
import {
  finalizeCancelledChatRun,
  finalizeFinishedChatRun,
} from "./finalization";

export async function executeChatRequest(input: {
  req: Request;
  userId: string;
  body: ChatRequestBody;
  resolvedModel: string;
  limitClaimId: string | null;
  callStartedAt: string;
}) {
  const scope = getChatRunScope(input.body);
  const teamId = readActiveTeamIdHeader(input.req);
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
      metadata: buildChatRunMetadata(input.body, teamId),
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
        repoBaseBranch: input.body.repoBaseBranch,
        repoFullName: input.body.repoFullName,
        sandboxId: input.body.sandboxId,
        workspaceSessionId: input.body.workspaceSessionId,
        conversationId: input.body.conversationId,
        enableTools: input.body.enableTools,
        teamId,
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
