"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { ArrowUp, Xmark } from "iconoir-react";
import { MogplexFace } from "@/components/brand/mogplex-face";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { MessageContent } from "@/components/message-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FlowGraph } from "@/lib/types";
import {
  FLOW_ASSISTANT_GRAPH_STATE_TOOL,
  readFlowAssistantResult,
  sanitizeFlowAssistantMessagesForRequest,
  shouldContinueFlowAssistantAfterToolCall,
} from "@/lib/flows/assistant-chat-payload";
import { useFlowAssistantPanel } from "@/hooks/use-flow-assistant-panel";

type FlowAssistantMetadata = {
  flowAssistant?: {
    summary: string | null;
    finalized: boolean;
    valid: boolean;
    errors: string[] | null;
  };
};

type AddGraphStateToolResult = (input: {
  tool: typeof FLOW_ASSISTANT_GRAPH_STATE_TOOL;
  toolCallId: string;
  output: { graph: FlowGraph };
}) => Promise<void>;

interface FlowAssistantPanelProps {
  flowId: string;
  /** Current draft graph; sent with each request so the model edits live state. */
  graph: FlowGraph;
  /** Apply an assistant-produced graph to the canvas draft. */
  onApplyGraph: (graph: FlowGraph) => void;
}

const GENERIC_ASSISTANT_ERROR = "The assistant request failed.";

/** Avoid surfacing raw network/provider/internal strings from the AI SDK. */
function friendlyAssistantError(message: string | undefined): string {
  if (!message) return GENERIC_ASSISTANT_ERROR;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 200) return GENERIC_ASSISTANT_ERROR;
  if (/^https?:\/\//i.test(trimmed)) return GENERIC_ASSISTANT_ERROR;
  return trimmed;
}

export function FlowAssistantPanel({
  flowId,
  graph,
  onApplyGraph,
}: FlowAssistantPanelProps) {
  const setOpen = useFlowAssistantPanel((s) => s.setOpen);

  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/flows/${flowId}/chat`,
        headers: () => getActiveTeamRequestHeaders(),
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            messages: sanitizeFlowAssistantMessagesForRequest(messages),
          },
        }),
      }),
    [flowId]
  );

  let addGraphStateToolResult: AddGraphStateToolResult | null = null;

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
    error,
    addToolResult,
  } = useChat({
    transport,
    id: `flow-assistant-${flowId}`,
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName !== FLOW_ASSISTANT_GRAPH_STATE_TOOL) return;
      if (!addGraphStateToolResult) {
        throw new Error("Flow assistant graph-state tool result handler missing.");
      }
      void addGraphStateToolResult({
        tool: FLOW_ASSISTANT_GRAPH_STATE_TOOL,
        toolCallId: toolCall.toolCallId,
        output: { graph: graphRef.current },
      });
    },
    sendAutomaticallyWhen: shouldContinueFlowAssistantAfterToolCall,
  });
  addGraphStateToolResult = addToolResult as unknown as AddGraphStateToolResult;

  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resetting on flow change is handled by the caller keying this component on
  // flowId: the remount gives a fresh useChat and a cleared input, and unmount
  // aborts any in-flight request from the previous flow.

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }, [input, busy, sendMessage]);

  return (
    <div
      data-testid="flow-assistant-panel"
      onPointerDownCapture={(event) => event.stopPropagation()}
      className="flows-panel-shell"
    >
      <div className="flows-panel-header bg-foreground/[0.02]">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent-blue/20 bg-accent-blue/[0.08] text-accent-blue">
          <MogplexFace
            className="size-4"
            mood={busy ? "thinking" : input.trim() ? "listening" : "idle"}
          />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-foreground uppercase">
            Flow assistant
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            Reshape this workflow
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Xmark className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        data-testid="flow-assistant-transcript"
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[12px] leading-5 text-foreground"
      >
        {messages.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-[11px] leading-5 text-muted-foreground">
            <MogplexFace className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
            <span>
              Describe a change — &ldquo;split the review into parallel
              correctness and performance agents, then join&rdquo; — and apply
              it to the canvas when it looks right.
            </span>
          </div>
        ) : null}

        {messages.map((message: UIMessage) => {
          const meta = message.metadata as FlowAssistantMetadata | undefined;
          const result = readFlowAssistantResult(message);
          const presentation = result ?? meta?.flowAssistant;
          return (
            <div
              key={message.id}
              className={cn(
                "rounded-md px-2.5 py-2",
                message.role === "user"
                  ? "border border-border bg-foreground/[0.04]"
                  : "bg-foreground/[0.02]"
              )}
            >
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                {message.role === "user" ? "You" : "Assistant"}
              </div>
              <MessageContent message={message} />
              {result?.graph ? (
                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={!result.valid}
                    onClick={() => onApplyGraph(result.graph!)}
                  >
                    {result.valid
                      ? "Apply changes to canvas"
                      : "Invalid graph — fix errors below"}
                  </Button>
                  {result.summary ? (
                    <span className="text-[10px] text-muted-foreground">
                      {result.summary}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {presentation &&
              !presentation.valid &&
              presentation.errors?.length ? (
                <ul className="mt-1.5 space-y-0.5 text-[10px] text-accent-red">
                  {presentation.errors.slice(0, 6).map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}

        {error ? (
          <div className="rounded-md border border-accent-red/30 bg-accent-red/10 px-2.5 py-2 text-[11px] text-accent-red">
            {friendlyAssistantError(error.message)}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border bg-foreground/[0.02] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="Ask the assistant to reshape this flow…"
          className="w-full resize-none rounded-md border border-border bg-input px-2.5 py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => stop()}
            >
              Stop
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            disabled={busy || !input.trim()}
            onClick={submit}
          >
            <ArrowUp className="size-3" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
