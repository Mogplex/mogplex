import type { FileUIPart, TextUIPart, UIMessage } from "ai";
import { validateUIMessages } from "ai";
import {
  checkAttachmentBudget,
  parseAttachmentDataUrl,
} from "@/lib/attachments/data-url";
import { ATTACHMENT_LIMITS } from "@/lib/attachments/policy";
import type {
  ControlChatRequestMessage,
  ControlChatRequestPart,
} from "./types";

type NormalizedControlChatMessage = UIMessage;

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
  const parsed = parseAttachmentDataUrl(
    part.type === "file" ? part.url : "",
    part.type === "file" ? part.mediaType : ""
  );
  if (!parsed.ok) {
    throw new ControlChatValidationError(
      "Invalid control chat file attachment."
    );
  }
  return parsed.content.byteLength;
}

function applyFileBudget(budget: ControlFileBudget, decodedBytes: number) {
  const result = checkAttachmentBudget(budget, decodedBytes);
  if (!result.ok) {
    throw new ControlChatValidationError(
      result.reason === "count"
        ? `Control chat supports up to ${ATTACHMENT_LIMITS.maxFiles} file attachments.`
        : "Control chat file attachments exceed the total size limit."
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
  if (part.url.length > ATTACHMENT_LIMITS.maxDataUrlChars) {
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
  const ids = new Set<string>();
  return (messages as unknown[]).map((message, index) => {
    if (typeof message !== "object" || message === null) {
      throw new ControlChatValidationError("Invalid control chat message.");
    }
    const controlMessage = message as ControlChatRequestMessage;
    const id = controlMessage.id ?? `control-legacy-${index}`;
    if (typeof id !== "string" || !id.trim() || ids.has(id)) {
      throw new ControlChatValidationError("Invalid control chat message id.");
    }
    ids.add(id);
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
      id,
      ...(controlMessage.metadata === undefined
        ? {}
        : { metadata: controlMessage.metadata }),
      role: controlMessage.role as "user" | "assistant" | "system",
      parts: (parts as unknown[]).flatMap<UIMessage["parts"][number]>(
        (part): UIMessage["parts"] => {
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
          if (
            typeof controlPart.type === "string" &&
            (controlPart.type.startsWith("tool-") ||
              controlPart.type === "dynamic-tool" ||
              controlPart.type === "step-start" ||
              controlPart.type === "reasoning")
          ) {
            if (controlMessage.role !== "assistant") {
              throw new ControlChatValidationError(
                "Tool and reasoning history must belong to an assistant message."
              );
            }
            // Preserve the SDK wire shape; validateControlChatMessages performs
            // SDK structural validation before the route or executor uses it.
            return [controlPart as UIMessage["parts"][number]];
          }
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

export async function validateControlChatMessages(
  messages: ControlChatRequestMessage[]
): Promise<UIMessage[]> {
  const normalized = normalizeControlChatMessages(messages);
  try {
    return await validateUIMessages({ messages: normalized });
  } catch {
    throw new ControlChatValidationError(
      "Invalid Control chat history. Reload the saved conversation and try again."
    );
  }
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
