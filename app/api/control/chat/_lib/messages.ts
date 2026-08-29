import type { FileUIPart, TextUIPart, UIMessage } from "ai";
import type {
  ControlChatRequestMessage,
  ControlChatRequestPart,
} from "./types";

type NormalizedControlChatMessage = Omit<UIMessage, "id">;

const MAX_CONTROL_FILE_DATA_URL_CHARS = 5_600_000;
const MAX_CONTROL_FILE_PARTS = 5;

export class ControlChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlChatValidationError";
  }
}

function normalizeFilePart(part: ControlChatRequestPart): FileUIPart {
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

  return (messages as unknown[]).map((message) => {
    if (typeof message !== "object" || message === null) {
      throw new ControlChatValidationError("Invalid control chat message.");
    }
    const controlMessage = message as ControlChatRequestMessage;
    let filePartCount = 0;
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
      parts: parts.flatMap<TextUIPart | FileUIPart>(
        (part): Array<TextUIPart | FileUIPart> => {
          if (part.type === "text") {
            return [{ type: "text" as const, text: part.text ?? "" }];
          }
          if (part.type === "file") {
            filePartCount += 1;
            if (filePartCount > MAX_CONTROL_FILE_PARTS) {
              throw new ControlChatValidationError(
                `Control chat supports up to ${MAX_CONTROL_FILE_PARTS} file attachments.`
              );
            }
            return [normalizeFilePart(part)];
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
