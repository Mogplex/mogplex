import type { FileUIPart, UIMessage } from "ai";
import {
  chargeAttachmentBudget,
  readAttachmentDataUrlByteLength,
} from "@/lib/attachments/data-url";
import { ATTACHMENT_LIMITS } from "@/lib/attachments/policy";
import type { ChatRequestMessage, ChatRequestPart } from "./types";

type NormalizedChatMessage = Omit<UIMessage, "id">;

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
  const parsed = readAttachmentDataUrlByteLength(
    part.url ?? "",
    part.mediaType ?? ""
  );
  if (!parsed.ok) {
    throw new ChatValidationError("Invalid chat file attachment.");
  }
  return parsed.byteLength;
}

function applyFileBudget(budget: ChatFileBudget, decodedBytes: number) {
  const result = chargeAttachmentBudget(budget, decodedBytes);
  if (!result.ok) {
    throw new ChatValidationError(
      result.reason === "count"
        ? `Chat supports up to ${ATTACHMENT_LIMITS.maxFiles} file attachments.`
        : "Chat file attachments exceed the total size limit."
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
  if (part.url.length > ATTACHMENT_LIMITS.maxDataUrlChars) {
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
