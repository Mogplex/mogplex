import { jsonSchema, type ModelMessage } from "ai";
import type {
  OpenAiContentPart,
  OpenAiMessage,
  OpenAiTool,
  UserContent,
  UserContentPart,
} from "./types";

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isToolInputObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOpenAiToolCallArguments(
  value: unknown
): Record<string, unknown> {
  if (isToolInputObject(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return {};
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isToolInputObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function coerceTextContent(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: OpenAiContentPart) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : part.image_url?.url;
        return url ? `[image: ${url}]` : "";
      }
      return stringifyUnknown(part);
    })
    .filter(Boolean)
    .join("\n");
}

function toUserContent(content: OpenAiMessage["content"]): UserContent {
  if (typeof content === "string") {
    return [{ type: "text", text: content.length > 0 ? content : "(empty)" }];
  }
  if (!Array.isArray(content)) {
    return [{ type: "text", text: "(empty)" }];
  }

  const parts = content
    .map((part: OpenAiContentPart) => {
      if (part?.type === "text" && typeof part.text === "string") {
        return { type: "text" as const, text: part.text };
      }
      if (part?.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : part.image_url?.url;
        if (typeof url === "string" && url.length > 0) {
          return { type: "image" as const, image: url };
        }
      }
      const fallback = stringifyUnknown(part);
      return fallback.length > 0
        ? { type: "text" as const, text: fallback }
        : null;
    })
    .filter((part): part is UserContentPart => part !== null);

  return parts.length > 0 ? parts : [{ type: "text", text: "(empty)" }];
}

export function toModelMessages(messages: OpenAiMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    switch (message.role) {
      case "system":
        return [
          {
            role: "system",
            content: coerceTextContent(message.content) || "(empty)",
          },
        ];
      case "user":
        return [{ role: "user", content: toUserContent(message.content) }];
      case "assistant": {
        const content: Array<Record<string, unknown>> = [];
        const text = coerceTextContent(message.content);
        if (text) {
          content.push({ type: "text", text });
        }
        for (const toolCall of message.tool_calls ?? []) {
          const toolName = toolCall.function?.name;
          if (!toolName) continue;
          content.push({
            type: "tool-call",
            toolCallId: toolCall.id ?? crypto.randomUUID(),
            toolName,
            input: parseOpenAiToolCallArguments(toolCall.function?.arguments),
          });
        }
        return [
          {
            role: "assistant",
            content:
              content.length > 0
                ? (content as ModelMessage["content"])
                : [{ type: "text", text: "(no response)" }],
          } as ModelMessage,
        ];
      }
      case "tool":
        return [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: message.tool_call_id ?? crypto.randomUUID(),
                // OpenAI's wire format only carries tool_call_id on tool
                // results, not the tool name — so we cannot populate toolName
                // here. Providers that require it (e.g. Anthropic) must be
                // used through the native chat endpoint, not this compat shim.
                toolName: "",
                output: {
                  type: "text",
                  value: coerceTextContent(message.content) || "(empty)",
                },
              },
            ],
          } as ModelMessage,
        ];
      default:
        return [];
    }
  });
}

export function toAiTools(tools: OpenAiTool[] | undefined) {
  if (!tools?.length) return undefined;
  const entries = tools.flatMap((tool) => {
    if (tool.type !== "function") return [];
    const name = tool.function?.name?.trim();
    if (!name) return [];
    return [
      [
        name,
        {
          description: tool.function?.description ?? "",
          inputSchema: jsonSchema(
            (tool.function?.parameters ?? {
              type: "object",
              properties: {},
            }) as object
          ),
        },
      ] as const,
    ];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
