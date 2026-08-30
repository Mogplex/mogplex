import type { FileUIPart, UIMessage } from "ai";
import type { ChatRequestMessage, ChatRequestPart } from "./types";

type NormalizedChatMessage = Omit<UIMessage, "id">;

const MAX_CHAT_FILE_DATA_URL_CHARS = 5_600_000;
const MAX_CHAT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CHAT_FILE_PARTS = 5;

export class ChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatValidationError";
  }
}

function normalizeFilePart(part: ChatRequestPart): FileUIPart {
  if (
    part.type !== "file" ||
    typeof part.mediaType !== "string" ||
    typeof part.url !== "string" ||
    part.url.length === 0
  ) {
    throw new ChatValidationError("Invalid chat file attachment.");
  }
  if (!part.url.toLowerCase().startsWith("data:")) {
    throw new ChatValidationError(
      "Chat file attachments must be uploaded as data URLs."
    );
  }
  if (part.url.length > MAX_CHAT_FILE_DATA_URL_CHARS) {
    throw new ChatValidationError(
      "Chat file attachment exceeds the size limit."
    );
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
  if (
    !match ||
    match[1]?.toLowerCase() !== part.mediaType.toLowerCase() ||
    Buffer.byteLength(match[2] ?? "", "base64") > MAX_CHAT_FILE_BYTES
  ) {
    throw new ChatValidationError("Invalid chat file attachment.");
  }
  return {
    type: "file",
    mediaType: part.mediaType,
    filename: part.filename,
    url: part.url,
  };
}

export function normalizeChatMessages(
  messages: ChatRequestMessage[]
): NormalizedChatMessage[] {
  if (!Array.isArray(messages)) {
    throw new ChatValidationError("Invalid chat messages.");
  }

  return (messages as unknown[]).map((message) => {
    if (typeof message !== "object" || message === null) {
      throw new ChatValidationError("Invalid chat message.");
    }
    const chatMessage = message as ChatRequestMessage;
    if (
      chatMessage.role !== "user" &&
      chatMessage.role !== "assistant" &&
      chatMessage.role !== "system"
    ) {
      throw new ChatValidationError("Invalid chat message role.");
    }
    const parts =
      chatMessage.parts ??
      (typeof chatMessage.content === "string"
        ? [{ type: "text" as const, text: chatMessage.content }]
        : (chatMessage.content ?? []));
    if (!Array.isArray(parts)) {
      throw new ChatValidationError("Invalid chat message.");
    }

    let filePartCount = 0;
    return {
      role: chatMessage.role,
      parts: (parts as unknown[]).flatMap<UIMessage["parts"][number]>(
        (part) => {
          if (
            typeof part !== "object" ||
            part === null ||
            Array.isArray(part) ||
            typeof (part as ChatRequestPart).type !== "string" ||
            (part as ChatRequestPart).type.length === 0
          ) {
            throw new ChatValidationError("Invalid chat message part.");
          }
          const chatPart = part as ChatRequestPart;
          if (chatPart.type === "text") {
            if (typeof chatPart.text !== "string") {
              throw new ChatValidationError("Invalid chat text part.");
            }
            return [{ type: "text", text: chatPart.text }];
          }
          if (chatPart.type === "file") {
            filePartCount += 1;
            if (filePartCount > MAX_CHAT_FILE_PARTS) {
              throw new ChatValidationError(
                `Chat supports up to ${MAX_CHAT_FILE_PARTS} file attachments.`
              );
            }
            return [normalizeFilePart(chatPart)];
          }
          return [chatPart as UIMessage["parts"][number]];
        }
      ),
    };
  });
}
