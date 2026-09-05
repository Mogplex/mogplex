import {
  DefaultChatTransport,
  isToolUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

export const CHAT_INTERRUPTED_MESSAGE =
  "Chat response interrupted. Check the sandbox before retrying; commands were not replayed.";
export const CHAT_TOOL_INTERRUPTED_MESSAGE =
  "No completion result was received. The command may still be running. Check the sandbox before retrying.";

/** Retain the SDK parser, but require an explicit terminal protocol event. */
export class WorkspaceChatTransport extends DefaultChatTransport<UIMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>) {
    let terminal = false;
    return super.processResponseStream(stream).pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          terminal ||=
            chunk.type === "finish" ||
            chunk.type === "error" ||
            chunk.type === "abort";
          // The SDK ignores server abort chunks and treats an error finish as
          // ready. Convert those terminal failures to its explicit error path.
          controller.enqueue(
            chunk.type === "abort" ||
              (chunk.type === "finish" && chunk.finishReason === "error")
              ? { type: "error", errorText: CHAT_INTERRUPTED_MESSAGE }
              : chunk
          );
        },
        flush() {
          if (!terminal) throw new Error(CHAT_INTERRUPTED_MESSAGE);
        },
      })
    );
  }
}

/** Mark only the interrupted response's unfinished tools, never prior history or completed results. */
export function markInterruptedChatResponse(
  messages: UIMessage[],
  messageId: string
): UIMessage[] {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          parts: message.parts.map((part) => {
            if (
              isToolUIPart(part) &&
              (part.state === "input-streaming" ||
                part.state === "input-available")
            ) {
              return {
                ...part,
                state: "output-error" as const,
                errorText: CHAT_TOOL_INTERRUPTED_MESSAGE,
              };
            }
            if (
              (part.type === "text" || part.type === "reasoning") &&
              part.state === "streaming"
            ) {
              return { ...part, state: "done" as const };
            }
            return part;
          }),
        }
      : message
  );
}
