import type { LocalToolCall } from "@/hooks/use-conversations";
import type { HarnessRenderChunk } from "./segment-store";
import {
  createSegmentStore,
  appendText,
  upsertToolCall,
  snapshot,
} from "./segment-store";

type HarnessOutputRenderer = {
  push: (stream: string, chunk: string) => HarnessRenderChunk;
  flush: () => HarnessRenderChunk;
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

export function createCodexOutputRenderer(): HarnessOutputRenderer {
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
