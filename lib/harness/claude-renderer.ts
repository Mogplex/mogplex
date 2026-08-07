import type { HarnessRenderChunk } from "./segment-store";
import {
  createSegmentStore,
  appendText,
  upsertToolCall,
  updateToolCall,
  snapshot,
} from "./segment-store";

type HarnessOutputRenderer = {
  push: (stream: string, chunk: string) => HarnessRenderChunk;
  flush: () => HarnessRenderChunk;
};

type ClaudeSdkMessage = {
  type?: string;
  subtype?: string;
  result?: string;
  message?: {
    content?: Array<Record<string, unknown>>;
  };
};

export function createClaudeOutputRenderer(): HarnessOutputRenderer {
  const buffers: Record<string, string> = {};
  const store = createSegmentStore();
  let sawAssistantText = false;

  function normalizeToolResultOutput(value: unknown): unknown {
    if (!Array.isArray(value)) return value;

    const textParts = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string"
          ? record.text
          : null;
      })
      .filter(Boolean);

    if (textParts.length === value.length && textParts.length > 0) {
      return textParts.join("\n\n");
    }

    return value;
  }

  function renderMessageContent(content: Array<Record<string, unknown>>) {
    for (const block of content) {
      if (
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        sawAssistantText = true;
        appendText(store, block.text.trim(), "text");
        continue;
      }

      if (typeof block.type === "string" && block.type.includes("tool_use")) {
        const toolCallId =
          typeof block.id === "string" && block.id.trim()
            ? block.id.trim()
            : `tool-${store.toolCallIndex.size + 1}`;
        const name =
          typeof block.name === "string" && block.name.trim()
            ? block.name.trim()
            : "tool";
        const existingIndex = store.toolCallIndex.get(toolCallId);
        const existing =
          existingIndex === undefined
            ? undefined
            : store.segments[existingIndex];
        const existingOutput =
          existing?.type === "tool-call" ? existing.toolCall.output : undefined;
        upsertToolCall(store, {
          id: toolCallId,
          name,
          input: block.input,
          output: existingOutput,
          state: "running",
        });
        continue;
      }

      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        block.tool_use_id.trim()
      ) {
        const output = normalizeToolResultOutput(block.content);
        const state =
          block.is_error === true
            ? typeof output === "string" && /permission denied/i.test(output)
              ? "denied"
              : "error"
            : "done";
        updateToolCall(store, block.tool_use_id.trim(), { output, state });
      }
    }
  }

  function applyPermissionFailureStatus(message: string) {
    let latestRunningToolCallId: string | undefined;
    for (const segment of store.segments) {
      if (
        segment.type === "tool-call" &&
        segment.toolCall.state === "running"
      ) {
        latestRunningToolCallId = segment.toolCall.id;
      }
    }

    if (latestRunningToolCallId) {
      updateToolCall(store, latestRunningToolCallId, {
        output: message,
        state: "denied",
      });
    }
  }

  function renderClaudeLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith("{")) {
      if (/permission denied/i.test(trimmed)) {
        applyPermissionFailureStatus(trimmed);
      }
      appendText(store, trimmed, "status");
      return;
    }

    let parsed: ClaudeSdkMessage;
    try {
      parsed = JSON.parse(trimmed) as ClaudeSdkMessage;
    } catch {
      appendText(store, trimmed, "status");
      return;
    }

    if (
      (parsed.type === "assistant" || parsed.type === "user") &&
      Array.isArray(parsed.message?.content)
    ) {
      renderMessageContent(parsed.message.content);
      return;
    }

    if (parsed.type === "result") {
      const resultText =
        typeof parsed.result === "string" ? parsed.result.trim() : "";
      if (parsed.subtype === "success") {
        if (!sawAssistantText && resultText) {
          sawAssistantText = true;
          appendText(store, resultText, "text");
        }
        return;
      }

      if (resultText) {
        if (/permission denied/i.test(resultText)) {
          applyPermissionFailureStatus(resultText);
        }
        appendText(store, resultText, sawAssistantText ? "status" : "text");
        return;
      }

      const fallback =
        parsed.subtype === "error_max_turns"
          ? "[stopped: max turns reached]"
          : "[execution error]";
      appendText(store, fallback, "status");
    }
  }

  function parseBufferedLines(stream: string, flushRemainder = false) {
    const buffer = buffers[stream] ?? "";
    if (!buffer) return;

    const lines = buffer.split("\n");
    const remainder = lines.pop() ?? "";
    buffers[stream] = flushRemainder ? "" : remainder;
    const completeLines =
      flushRemainder && remainder ? [...lines, remainder] : lines;

    for (const line of completeLines) {
      renderClaudeLine(line);
    }
  }

  return {
    push(stream, chunk) {
      buffers[stream] = (buffers[stream] ?? "") + chunk;
      parseBufferedLines(stream);
      return snapshot(store);
    },
    flush() {
      for (const stream of Object.keys(buffers)) {
        parseBufferedLines(stream, true);
      }
      return snapshot(store);
    },
  };
}
