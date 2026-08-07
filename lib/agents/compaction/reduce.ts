import type { ModelMessage, ToolResultPart } from "ai";
import {
  TOOL_OUTPUT_DEMOTION_MIN_CHARS,
  TOOL_OUTPUT_KEEP_RECENT_MESSAGES,
} from "./types";

/**
 * Step-level reduction inside a running tool loop: once a tool result is old
 * enough that the model has already acted on it, its full payload is dead
 * weight. Demote oversized outputs to a typed reference that keeps the tool
 * name, call id, size, and a head excerpt — enough to know what happened and
 * to re-fetch from the authoritative source (filesystem, API) if needed.
 *
 * Deterministic and pure; never touches user messages, never calls a model.
 */

const DEMOTION_HEAD_CHARS = 600;
const DEMOTION_MARKER = "[tool output demoted";

type DemotionOptions = {
  keepRecentMessages?: number;
  minChars?: number;
};

function serializeOutput(output: ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") {
    return output.value;
  }
  try {
    return JSON.stringify("value" in output ? output.value : output) ?? "";
  } catch {
    return "";
  }
}

function demoteToolResultPart(part: ToolResultPart): ToolResultPart {
  const serialized = serializeOutput(part.output);
  const head = serialized.slice(0, DEMOTION_HEAD_CHARS);
  return {
    ...part,
    output: {
      type: "text",
      value:
        `${DEMOTION_MARKER}: tool=${part.toolName} call=${part.toolCallId} ` +
        `${serialized.length} chars. Re-run the tool if the full output is ` +
        `needed again. Head excerpt:]\n${head}`,
    },
  };
}

function isDemotable(part: ToolResultPart, minChars: number): boolean {
  const serialized = serializeOutput(part.output);
  if (serialized.length < minChars) return false;
  return !serialized.startsWith(DEMOTION_MARKER);
}

/**
 * Walk every model message except the trailing `keepRecentMessages` and
 * replace oversized tool-result outputs with typed references. Returns the
 * original array when nothing qualifies so callers can cheaply detect a
 * no-op (and `prepareStep` can leave the step untouched).
 */
export function demoteStaleToolOutputs(
  messages: readonly ModelMessage[],
  options?: DemotionOptions
): ModelMessage[] {
  const keepRecent =
    options?.keepRecentMessages ?? TOOL_OUTPUT_KEEP_RECENT_MESSAGES;
  const minChars = options?.minChars ?? TOOL_OUTPUT_DEMOTION_MIN_CHARS;
  const cutoff = messages.length - keepRecent;
  if (cutoff <= 0) return messages as ModelMessage[];

  let changed = false;
  const reduced = messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      return message;
    }
    let messageChanged = false;
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || !isDemotable(part, minChars)) {
        return part;
      }
      messageChanged = true;
      return demoteToolResultPart(part);
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, content };
  });

  return changed ? (reduced as ModelMessage[]) : (messages as ModelMessage[]);
}
