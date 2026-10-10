import type { CreateChatModelStreamResult } from "@/lib/agents/run-chat";
import { withChatStreamKeepalive } from "@/lib/agents/chat-stream-response";
import { CHAT_INTERRUPTED_MESSAGE } from "@/lib/agents/chat-stream";
import { modelMessageMetadata } from "@/lib/agents/context-usage";

export function createWorkspaceChatResponse(
  result: Pick<
    CreateChatModelStreamResult["result"],
    "toUIMessageStreamResponse"
  >,
  aiCallId: string,
  model: string
) {
  return withChatStreamKeepalive(
    result.toUIMessageStreamResponse({
      onError: () => CHAT_INTERRUPTED_MESSAGE,
      messageMetadata: ({ part }) =>
        modelMessageMetadata(
          aiCallId,
          part.type === "finish-step" ? part.response.modelId : model,
          part
        ),
    })
  );
}
