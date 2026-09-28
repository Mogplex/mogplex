import type { LocalToolCall } from "@/hooks/use-conversations";
import {
  appendText,
  appendTextChunk,
  createSegmentStore,
  snapshot,
  upsertToolCall,
  type HarnessRenderChunk,
} from "@/lib/harness/segment-store";
import {
  parseAcpBridgeLine,
  type AcpBridgeEvent,
  type AcpSessionUpdate,
  type AcpToolCallFields,
} from "./protocol";

export type AcpOutputRenderer = {
  push: (stream: string, chunk: string) => HarnessRenderChunk;
  flush: () => HarnessRenderChunk;
};

type ToolCallRecord = AcpToolCallFields & {
  terminalOutput: string;
  exitCode?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolState(
  record: ToolCallRecord,
  denied: boolean
): LocalToolCall["state"] {
  if (denied) return "denied";
  if (record.status === "completed") return "done";
  if (record.status === "failed") return "error";
  return "running";
}

function mcpIdentity(record: ToolCallRecord) {
  const input = asRecord(record.rawInput);
  if (!(record._meta?.is_mcp_tool_call || (input?.server && input.tool))) {
    return null;
  }
  return {
    server: typeof input?.server === "string" ? input.server : "server",
    tool: typeof input?.tool === "string" ? input.tool : "tool",
    arguments: input?.arguments,
  };
}

function mcpOutput(rawOutput: unknown) {
  const output = asRecord(rawOutput);
  const result = asRecord(output?.result);
  const error = asRecord(output?.error);
  if (
    result?.structuredContent !== undefined &&
    result.structuredContent !== null
  ) {
    return result.structuredContent;
  }
  if (result?.content !== undefined) return result.content;
  if (typeof error?.message === "string") return { error: error.message };
  return undefined;
}

function editChanges(content: unknown[] | undefined) {
  return (content ?? []).flatMap((item) => {
    const entry = asRecord(item);
    if (entry?.type !== "diff") return [];
    const meta = asRecord(entry._meta);
    return [
      {
        path: entry.path,
        kind: meta?.kind ?? (entry.oldText ? "update" : "add"),
      },
    ];
  });
}

/** Maps one accumulated ACP tool call onto the harness tool-call shape. */
function presentToolCall(
  id: string,
  record: ToolCallRecord,
  denied: boolean
): LocalToolCall {
  const state = toolState(record, denied);
  const mcp = mcpIdentity(record);
  if (mcp) {
    return {
      id,
      name: `MCP ${mcp.server}/${mcp.tool}`,
      input: mcp.arguments,
      output: mcpOutput(record.rawOutput),
      state,
    };
  }
  if (record.kind === "edit") {
    return {
      id,
      name: "PatchApply",
      input: { changes: editChanges(record.content) },
      state,
    };
  }
  const input = asRecord(record.rawInput);
  if (record.kind === "execute" && typeof input?.command === "string") {
    const hasOutput =
      Boolean(record.terminalOutput) || record.exitCode !== undefined;
    return {
      id,
      name: "Command",
      input: { command: input.command },
      output: hasOutput
        ? { output: record.terminalOutput, exit_code: record.exitCode ?? null }
        : undefined,
      state,
    };
  }
  return {
    id,
    name: record.title || record.kind || "Tool",
    input:
      record.rawInput ??
      (record.locations ? { locations: record.locations } : undefined),
    output: record.terminalOutput || record.rawOutput || undefined,
    state,
  };
}

function terminalFacts(update: AcpSessionUpdate) {
  const meta = update._meta ?? {};
  const delta = asRecord(meta.terminal_output_delta);
  const exit = asRecord(meta.terminal_exit);
  const rawOutput = asRecord(update.rawOutput);
  const exitCode =
    typeof exit?.exit_code === "number" || exit?.exit_code === null
      ? (exit.exit_code as number | null)
      : typeof rawOutput?.exit_code === "number"
        ? rawOutput.exit_code
        : undefined;
  return {
    output: typeof delta?.data === "string" ? delta.data : "",
    exitCode,
  };
}

/**
 * Renders the bridge's event stream into text and tool-call segments, the
 * same shape the per-CLI renderers produce, so every harness surface reads
 * ACP runs without knowing the protocol.
 */
export function createAcpOutputRenderer(): AcpOutputRenderer {
  const store = createSegmentStore();
  const toolCalls = new Map<string, ToolCallRecord>();
  const denied = new Set<string>();
  let writingMessageId: string | null = null;

  function renderToolCall(id: string) {
    const record = toolCalls.get(id);
    if (record)
      upsertToolCall(store, presentToolCall(id, record, denied.has(id)));
  }

  function applyToolUpdate(update: AcpSessionUpdate) {
    const id = update.toolCallId;
    if (!id) return;
    const previous = toolCalls.get(id) ?? { terminalOutput: "" };
    const terminal = terminalFacts(update);
    const { sessionUpdate: _kind, ...fields } = update;
    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );
    toolCalls.set(id, {
      ...previous,
      ...defined,
      _meta: { ...previous._meta, ...update._meta },
      content: (update.content as unknown[] | undefined) ?? previous.content,
      terminalOutput: previous.terminalOutput + terminal.output,
      exitCode: terminal.exitCode ?? previous.exitCode,
    });
    writingMessageId = null;
    renderToolCall(id);
  }

  function applyUpdate(update: AcpSessionUpdate) {
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const content = asRecord(update.content);
      if (content?.type !== "text" || typeof content.text !== "string") return;
      const messageId = update.messageId ?? null;
      const continues = messageId !== null && messageId === writingMessageId;
      if (appendTextChunk(store, content.text, continues))
        writingMessageId = messageId;
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      applyToolUpdate(update);
      return;
    }
    if (kind === "plan" && Array.isArray(update.entries)) {
      writingMessageId = null;
      upsertToolCall(store, {
        id: "acp-plan",
        name: "Plan",
        input: { entries: update.entries },
        state: "done",
      });
    }
    // Thoughts, usage, commands, modes, and session info are not shown.
  }

  function applyEvent(event: AcpBridgeEvent) {
    switch (event.type) {
      case "update":
        if (event.update) applyUpdate(event.update);
        return;
      case "permission": {
        const id = event.toolCall?.toolCallId;
        if (id && event.policy === "decline") {
          denied.add(id);
          renderToolCall(id);
        }
        return;
      }
      case "resume_failed":
        writingMessageId = null;
        appendText(
          store,
          "[previous session unavailable; starting fresh]",
          "status"
        );
        return;
      case "error":
        writingMessageId = null;
        appendText(store, event.message, "status");
        return;
      case "done":
        if (
          event.stopReason &&
          event.stopReason !== "end_turn" &&
          event.stopReason !== "cancelled"
        ) {
          appendText(store, `[agent stopped: ${event.stopReason}]`, "status");
        }
        return;
      default:
        return;
    }
  }

  function renderLine(line: string) {
    const event = parseAcpBridgeLine(line);
    if (event) {
      applyEvent(event);
      return;
    }
    // The bridge owns stdout, so anything else there is worth showing.
    writingMessageId = null;
    appendText(store, line, "status");
  }

  let stdoutBuffer = "";
  function renderBufferedLines(flushRemainder: boolean) {
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = flushRemainder ? "" : (lines.pop() ?? "");
    for (const line of lines) if (line.trim()) renderLine(line);
  }

  return {
    // stderr carries the agent's own logs; failures reach stdout as `error`.
    push(stream, chunk) {
      if (stream === "stdout") {
        stdoutBuffer += chunk;
        renderBufferedLines(false);
      }
      return snapshot(store);
    },
    flush() {
      renderBufferedLines(true);
      return snapshot(store);
    },
  };
}
