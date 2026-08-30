import type { FileUIPart, TextUIPart, UIMessage } from "ai";
import type {
  ControlChatRequestMessage,
  ControlChatRequestPart,
} from "./types";

type NormalizedControlChatMessage = Omit<UIMessage, "id">;

const MAX_CONTROL_FILE_DATA_URL_CHARS = 5_600_000;
const MAX_CONTROL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONTROL_FILE_PARTS = 5;
const MAX_CONTROL_TOTAL_FILE_BYTES =
  MAX_CONTROL_FILE_BYTES * MAX_CONTROL_FILE_PARTS;

type ControlFileBudget = {
  count: number;
  bytes: number;
};

export class ControlChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlChatValidationError";
  }
}

function readFilePartBytes(part: ControlChatRequestPart): number {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    part.type === "file" ? part.url : ""
  );
  if (
    !match ||
    part.type !== "file" ||
    match[1]?.toLowerCase() !== part.mediaType.toLowerCase()
  ) {
    throw new ControlChatValidationError(
      "Invalid control chat file attachment."
    );
  }
  const decodedBytes = Buffer.byteLength(match[2] ?? "", "base64");
  if (decodedBytes > MAX_CONTROL_FILE_BYTES) {
    throw new ControlChatValidationError(
      "Control chat file attachment exceeds the size limit."
    );
  }
  return decodedBytes;
}

function applyFileBudget(budget: ControlFileBudget, decodedBytes: number) {
  budget.count += 1;
  if (budget.count > MAX_CONTROL_FILE_PARTS) {
    throw new ControlChatValidationError(
      `Control chat supports up to ${MAX_CONTROL_FILE_PARTS} file attachments.`
    );
  }
  budget.bytes += decodedBytes;
  if (budget.bytes > MAX_CONTROL_TOTAL_FILE_BYTES) {
    throw new ControlChatValidationError(
      "Control chat file attachments exceed the total size limit."
    );
  }
}

function normalizeFilePart(
  part: ControlChatRequestPart,
  budget: ControlFileBudget
): FileUIPart {
  if (
    part.type !== "file" ||
    typeof part.mediaType !== "string" ||
    typeof part.url !== "string" ||
    part.url.length === 0
  ) {
    throw new ControlChatValidationError(
      "Invalid control chat file attachment."
    );
  }
  if (!part.url.toLowerCase().startsWith("data:")) {
    throw new ControlChatValidationError(
      "Control chat file attachments must be uploaded as data URLs."
    );
  }
  if (part.url.length > MAX_CONTROL_FILE_DATA_URL_CHARS) {
    throw new ControlChatValidationError(
      "Control chat file attachment exceeds the size limit."
    );
  }
  applyFileBudget(budget, readFilePartBytes(part));
  return {
    type: "file" as const,
    mediaType: part.mediaType,
    filename: part.filename,
    url: part.url,
  };
}

export function normalizeControlChatMessages(
  messages: ControlChatRequestMessage[]
): NormalizedControlChatMessage[] {
  if (!Array.isArray(messages)) {
    throw new ControlChatValidationError("Invalid control chat messages.");
  }

  const fileBudget: ControlFileBudget = { count: 0, bytes: 0 };
  return (messages as unknown[]).map((message) => {
    if (typeof message !== "object" || message === null) {
      throw new ControlChatValidationError("Invalid control chat message.");
    }
    const controlMessage = message as ControlChatRequestMessage;
    if (
      controlMessage.role !== "user" &&
      controlMessage.role !== "assistant" &&
      controlMessage.role !== "system"
    ) {
      throw new ControlChatValidationError(
        "Invalid control chat message role."
      );
    }
    const parts =
      controlMessage.parts ??
      (typeof controlMessage.content === "string"
        ? [{ type: "text", text: controlMessage.content }]
        : (controlMessage.content ?? []));
    if (!Array.isArray(parts)) {
      throw new ControlChatValidationError("Invalid control chat message.");
    }

    return {
      role: controlMessage.role as "user" | "assistant" | "system",
      parts: (parts as unknown[]).flatMap<TextUIPart | FileUIPart>(
        (part): Array<TextUIPart | FileUIPart> => {
          if (
            typeof part !== "object" ||
            part === null ||
            Array.isArray(part)
          ) {
            throw new ControlChatValidationError(
              "Invalid control chat message part."
            );
          }
          const controlPart = part as ControlChatRequestPart;
          if (controlPart.type === "text") {
            if (typeof controlPart.text !== "string") {
              throw new ControlChatValidationError(
                "Invalid control chat text part."
              );
            }
            return [{ type: "text" as const, text: controlPart.text }];
          }
          if (controlPart.type === "file") {
            return [normalizeFilePart(controlPart, fileBudget)];
          }
          return [];
        }
      ),
    };
  });
}

export function readLatestControlUserText(
  messages: NormalizedControlChatMessage[]
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return message.parts
      .filter((part): part is TextUIPart => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}
