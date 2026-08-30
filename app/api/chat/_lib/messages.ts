import type { FileUIPart, UIMessage } from "ai";
import type { ChatRequestMessage, ChatRequestPart } from "./types";

type NormalizedChatMessage = Omit<UIMessage, "id">;

const MAX_CHAT_FILE_DATA_URL_CHARS = 5_600_000;
const MAX_CHAT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CHAT_FILE_PARTS = 5;
const MAX_CHAT_TOTAL_FILE_BYTES = MAX_CHAT_FILE_BYTES * MAX_CHAT_FILE_PARTS;

type ChatFileBudget = {
  count: number;
  bytes: number;
};

export class ChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatValidationError";
  }
}

function readFilePartBytes(part: ChatRequestPart): number {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    part.url ?? ""
  );
  if (!match || match[1]?.toLowerCase() !== part.mediaType?.toLowerCase()) {
    throw new ChatValidationError("Invalid chat file attachment.");
  }
  const decodedBytes = Buffer.byteLength(match[2] ?? "", "base64");
  if (decodedBytes > MAX_CHAT_FILE_BYTES) {
    throw new ChatValidationError("Invalid chat file attachment.");
  }
  return decodedBytes;
}

function applyFileBudget(budget: ChatFileBudget, decodedBytes: number) {
  budget.count += 1;
  if (budget.count > MAX_CHAT_FILE_PARTS) {
    throw new ChatValidationError(
      `Chat supports up to ${MAX_CHAT_FILE_PARTS} file attachments.`
    );
  }
  budget.bytes += decodedBytes;
  if (budget.bytes > MAX_CHAT_TOTAL_FILE_BYTES) {
    throw new ChatValidationError(
      "Chat file attachments exceed the total size limit."
    );
  }
}

function normalizeFilePart(
  part: ChatRequestPart,
  budget: ChatFileBudget
): FileUIPart {
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
  applyFileBudget(budget, readFilePartBytes(part));
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

  const fileBudget: ChatFileBudget = { count: 0, bytes: 0 };
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
            return [normalizeFilePart(chatPart, fileBudget)];
          }
          return [chatPart as UIMessage["parts"][number]];
        }
      ),
    };
  });
}
