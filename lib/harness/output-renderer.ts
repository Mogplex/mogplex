import type { HarnessId } from "@/lib/harness/config";
import type {
  LocalMessageSegment,
  LocalToolCall,
} from "@/hooks/use-conversations";

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

type CodexThreadEvent = {
  type?: string;
  item?: CodexThreadItem;
  message?: string;
  error?: {
    message?: string;
  };
};

type CodexThreadItem = {
  id?: string;
  type?: string;
  message?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: Array<Record<string, unknown>>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: {
    content?: unknown;
    structured_content?: unknown;
  } | null;
  error?: {
    message?: string;
  } | null;
  query?: string;
  action?: string;
  sender_thread_id?: string;
  receiver_thread_ids?: string[];
  prompt?: string | null;
  agents_states?: unknown;
};

export type HarnessRenderChunk = {
  text: string;
  toolCalls?: LocalToolCall[];
  segments?: LocalMessageSegment[];
};

// Invariant: segments is append-only within a run — entries are pushed or
// mutated in place, never removed or reordered. toolCallIndex stores positions
// into segments, so any future code that splices/removes segments must also
// rebuild this map, or the indices will dangle.
type SegmentStore = {
  segments: LocalMessageSegment[];
  toolCallIndex: Map<string, number>;
  dirty: boolean;
  pendingTextDelta: string;
};

function createSegmentStore(): SegmentStore {
  return {
    segments: [],
    toolCallIndex: new Map(),
    dirty: false,
    pendingTextDelta: "",
  };
}

function appendText(
  store: SegmentStore,
  text: string,
  kind: "text" | "status"
): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const last = store.segments.at(-1);
  const prefix = last ? (kind === "text" ? "\n\n" : "\n") : "";
  const chunk = `${prefix}${normalized}`;

  if (last?.type === "text") {
    last.text += chunk;
  } else {
    store.segments.push({ type: "text", text: chunk });
  }
  store.dirty = true;
  store.pendingTextDelta += chunk;
  return chunk;
}

function upsertToolCall(store: SegmentStore, toolCall: LocalToolCall) {
  const existingIndex = store.toolCallIndex.get(toolCall.id);
  if (existingIndex !== undefined) {
    const existing = store.segments[existingIndex];
    if (existing?.type === "tool-call") {
      store.segments[existingIndex] = { type: "tool-call", toolCall };
      store.dirty = true;
      return;
    }
  }
  store.segments.push({ type: "tool-call", toolCall });
  store.toolCallIndex.set(toolCall.id, store.segments.length - 1);
  store.dirty = true;
}

function updateToolCall(
  store: SegmentStore,
  id: string,
  patch: Partial<LocalToolCall>
) {
  const existingIndex = store.toolCallIndex.get(id);
  if (existingIndex === undefined) return;
  const existing = store.segments[existingIndex];
  if (existing?.type !== "tool-call") return;
  store.segments[existingIndex] = {
    type: "tool-call",
    toolCall: { ...existing.toolCall, ...patch },
  };
  store.dirty = true;
}

function snapshot(store: SegmentStore): HarnessRenderChunk {
  const textDelta = store.pendingTextDelta;
  store.pendingTextDelta = "";

  if (!store.dirty) return { text: textDelta };
  store.dirty = false;

  const segments: LocalMessageSegment[] = store.segments.map((segment) =>
    segment.type === "text"
      ? { type: "text", text: segment.text }
      : { type: "tool-call", toolCall: { ...segment.toolCall } }
  );

  const toolCalls = segments
    .filter(
      (segment): segment is { type: "tool-call"; toolCall: LocalToolCall } =>
        segment.type === "tool-call"
    )
    .map((segment) => segment.toolCall);

  return {
    text: textDelta,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    segments,
  };
}

function createPassthroughRenderer(): HarnessOutputRenderer {
  const store = createSegmentStore();
  return {
    push: (_stream, chunk) => {
      appendText(store, chunk, "text");
      return snapshot(store);
    },
    flush: () => snapshot(store),
  };
}

function createClaudeOutputRenderer(): HarnessOutputRenderer {
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

function createCodexOutputRenderer(): HarnessOutputRenderer {
  const buffers: Record<string, string> = {};
  const store = createSegmentStore();

  function mapCommandStatus(status?: string): LocalToolCall["state"] {
    if (status === "completed") return "done";
    if (status === "declined") return "denied";
    if (status === "failed") return "error";
    return "running";
  }

  function mapGenericStatus(status?: string): LocalToolCall["state"] {
    if (status === "completed") return "done";
    if (status === "failed") return "error";
    return "running";
  }

  function normalizeMcpOutput(item: CodexThreadItem) {
    if (
      item.result?.structured_content !== undefined &&
      item.result.structured_content !== null
    ) {
      return item.result.structured_content;
    }
    if (item.result?.content !== undefined) {
      return item.result.content;
    }
    if (item.error?.message) {
      return { error: item.error.message };
    }
  }

  function renderCodexItem(
    item: CodexThreadItem | undefined,
    eventType?: string
  ) {
    if (!item?.type || !item.id) return;

    if (item.type === "agent_message") {
      appendText(store, item.text ?? "", "text");
      return;
    }

    if (item.type === "reasoning") {
      return;
    }

    if (item.type === "command_execution") {
      const hasOutput =
        Boolean(item.aggregated_output) ||
        (item.exit_code !== null && item.exit_code !== undefined);
      upsertToolCall(store, {
        id: item.id,
        name: "Command",
        input: { command: item.command },
        output: hasOutput
          ? {
              output: item.aggregated_output,
              exit_code: item.exit_code,
            }
          : undefined,
        state: mapCommandStatus(item.status),
      });
      return;
    }

    if (item.type === "file_change") {
      upsertToolCall(store, {
        id: item.id,
        name: "PatchApply",
        input: { changes: item.changes ?? [] },
        state: mapGenericStatus(item.status),
      });
      return;
    }

    if (item.type === "mcp_tool_call") {
      upsertToolCall(store, {
        id: item.id,
        name: `MCP ${item.server ?? "server"}/${item.tool ?? "tool"}`,
        input: item.arguments,
        output: normalizeMcpOutput(item),
        state: mapGenericStatus(item.status),
      });
      return;
    }

    if (item.type === "web_search") {
      upsertToolCall(store, {
        id: item.id,
        name: "WebSearch",
        input: {
          query: item.query,
          action: item.action,
        },
        state: eventType === "item.completed" ? "done" : "running",
      });
      return;
    }

    if (item.type === "collab_tool_call") {
      upsertToolCall(store, {
        id: item.id,
        name: `Collab ${item.tool ?? "tool"}`,
        input: {
          sender_thread_id: item.sender_thread_id,
          receiver_thread_ids: item.receiver_thread_ids ?? [],
          prompt: item.prompt,
        },
        output: item.agents_states,
        state: mapGenericStatus(item.status),
      });
      return;
    }

    if (item.type === "error") {
      appendText(
        store,
        item.text ?? item.error?.message ?? item.message ?? "[error]",
        "status"
      );
    }
  }

  function renderCodexLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith("{")) {
      appendText(store, trimmed, "status");
      return;
    }

    let parsed: CodexThreadEvent;
    try {
      parsed = JSON.parse(trimmed) as CodexThreadEvent;
    } catch {
      appendText(store, trimmed, "status");
      return;
    }

    if (
      parsed.type === "item.started" ||
      parsed.type === "item.updated" ||
      parsed.type === "item.completed"
    ) {
      renderCodexItem(parsed.item, parsed.type);
      return;
    }

    if (parsed.type === "turn.failed") {
      appendText(
        store,
        parsed.error?.message ?? parsed.message ?? "[turn failed]",
        "status"
      );
      return;
    }

    if (parsed.type === "error") {
      appendText(
        store,
        parsed.message ?? parsed.error?.message ?? "[error]",
        "status"
      );
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
      renderCodexLine(line);
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

export function createHarnessOutputRenderer(
  harnessId: HarnessId
): HarnessOutputRenderer {
  if (harnessId === "claude-code") {
    return createClaudeOutputRenderer();
  }

  if (harnessId === "codex") {
    return createCodexOutputRenderer();
  }

  return createPassthroughRenderer();
}
