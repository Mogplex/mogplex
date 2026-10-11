import {
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { sanitizeAgentUserFacingError } from "@/lib/agents/user-facing-output";
import {
  persistedControlStream,
  type ControlStreamCompletion,
} from "@/lib/control/persisted-stream";
import { saveControlTranscript } from "@/lib/control/transcript-store";

export async function controlResponseStream(input: {
  stream: ReadableStream<UIMessageChunk>;
  userId: string;
  sessionId: string | null | undefined;
  aiCallId: string;
  messages: UIMessage[];
  expectedMessages: UIMessage[];
  continuationMessageId?: string;
  onComplete: (event: ControlStreamCompletion) => Promise<void>;
  onClosed: () => Promise<void>;
  onFailure: () => Promise<void>;
}) {
  const durable = input.sessionId
    ? await persistedControlStream({
        stream: input.stream,
        messages: input.messages,
        expectedMessages: input.expectedMessages,
        messageId: `control-${input.aiCallId}`,
        continuationMessageId: input.continuationMessageId,
        onComplete: input.onComplete,
        save: (messages, previous) =>
          saveControlTranscript({
            userId: input.userId,
            sessionId: input.sessionId!,
            messages,
            expectedMessages: previous,
          }),
        onError: (error) => {
          const message = sanitizeAgentUserFacingError(
            error instanceof Error
              ? error.message
              : "Could not save the Control conversation."
          );
          console.error("[control/chat] transcript checkpoint failed", {
            aiCallId: input.aiCallId,
            message,
          });
          return message;
        },
      })
    : { stream: input.stream, completion: null };
  const completion =
    durable.completion?.finally(input.onClosed).catch(async (error) => {
      await input.onFailure();
      throw error;
    }) ?? null;
  void completion?.catch(() => undefined);
  return {
    response: createUIMessageStreamResponse({ stream: durable.stream }),
    completion,
  };
}
