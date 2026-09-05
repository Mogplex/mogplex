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
import { buildChatMemorySuffix, extractLatestUserText } from "./memory";
import { compactChatMessagesForModel } from "@/lib/agents/compaction/chat-adapter";
import { persistChatSessionMemory } from "./session-memory";
import { withChatStreamKeepalive } from "@/lib/agents/chat-stream-response";
import { CHAT_INTERRUPTED_MESSAGE } from "@/lib/agents/chat-stream";
import {
  markChatRunStreaming,
  createToolCallStartHandler,
  createToolCallFinishHandler,
} from "./events";
import { createChatFinalizationHooks } from "./lifecycle";

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

    const hooks: ChatModelStreamHooks = {
      ...createChatFinalizationHooks({
        activeCall,
        userId: input.userId,
        scope,
        limitClaimId: input.limitClaimId,
        callStartedAt: input.callStartedAt,
      }),
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
    };

    const modelMessages = await compactChatMessagesForModel({
      userId: input.userId,
      conversationId: scope.conversationId ?? null,
      repoId: scope.repoId ?? null,
      aiCallId: activeCall.id,
      resolvedModel: input.resolvedModel,
      teamId: teamId ?? null,
      uiMessages: input.body.messages as Parameters<
        typeof compactChatMessagesForModel
      >[0]["uiMessages"],
      abortSignal: input.req.signal,
    });

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
        latestUserText: extractLatestUserText(input.body.messages),
      },
      resolvedModel: input.resolvedModel,
      uiMessages: modelMessages as Parameters<
        typeof createChatModelStream
      >[0]["uiMessages"],
      systemSuffix,
      abortSignal: input.req.signal,
      hooks,
    });

    return {
      aiCall: activeCall,
      response: withChatStreamKeepalive(
        result.toUIMessageStreamResponse({
          onError: () => CHAT_INTERRUPTED_MESSAGE,
          messageMetadata: () => ({ ai_call_id: activeCall.id }),
        })
      ),
    };
  } catch (error) {
    const startupError =
      error instanceof Error ? error : new Error("Failed to start chat run");
    (startupError as ChatStartupFailure).aiCall = aiCall;
    throw startupError;
  }
}
