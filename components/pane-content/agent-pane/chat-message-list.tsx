"use client";
import { useMemo, type RefObject } from "react";
import type { UIMessage } from "ai";
import type { LocalMessage as ConversationLocalMessage } from "@/hooks/use-conversations";
import type { AiCallEvent } from "@/lib/types/ai";
import { AsciiLoader } from "@/components/ascii-loader";
import { PatchViewer } from "@/components/diffs/patch-viewer";
import { detectPatch } from "@/lib/diffs/detect";
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { LocalToolCall } from "@/hooks/use-conversations";
import dynamic from "next/dynamic";

const MessageContent = dynamic(
  () => import("@/components/message-content").then((m) => m.MessageContent),
  {
    ssr: false,
    loading: () => <span className="text-muted-foreground">...</span>,
  }
);

const MessageResponse = dynamic(
  () =>
    import("@/components/ai-elements/message").then((m) => m.MessageResponse),
  {
    ssr: false,
    loading: () => <span className="text-muted-foreground">...</span>,
  }
);

interface ConversationRun {
  id: string;
  type: string;
  status: string;
}

interface ChatMessageListProps {
  localMsgs: ConversationLocalMessage[];
  messages: UIMessage[];
  liveConversationRuns: ConversationRun[];
  activeCallEvents: AiCallEvent[];
  isAgentRunning: boolean;
  endRef?: RefObject<HTMLDivElement | null>;
}

function getText(msg: { parts?: Array<{ type: string; text?: string }> }) {
  if (!msg.parts) return "";
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Inline LocalMessage to avoid module boundary issues
function LocalMessage({
  message,
}: {
  message: ConversationLocalMessage;
}) {
  const detectedPatch = useMemo(
    () => detectPatch(message.text),
    [message.text]
  );
  const hasToolCallSegment =
    message.segments?.some((s) => s.type === "tool-call") ?? false;
  const hasToolCalls =
    hasToolCallSegment || (message.toolCalls?.length ?? 0) > 0;

  if (detectedPatch && !hasToolCalls) {
    return <PatchViewer detectedPatch={detectedPatch} />;
  }

  if (message.segments && message.segments.length > 0) {
    return (
      <div className="space-y-2">
        {message.segments.map((segment, index) =>
          segment.type === "text" ? (
            <MessageResponse
              key={`text-${index}`}
              className="text-foreground"
            >
              {segment.text}
            </MessageResponse>
          ) : (
            <LocalToolCalls
              key={`tool-${segment.toolCall.id}`}
              toolCalls={[segment.toolCall]}
            />
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.text ? (
        <MessageResponse className="text-foreground">
          {message.text}
        </MessageResponse>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <LocalToolCalls toolCalls={message.toolCalls} />
      ) : null}
    </div>
  );
}

function LocalToolCalls({ toolCalls }: { toolCalls: LocalToolCall[] }) {
  return (
    <Accordion
      type="multiple"
      className="border-border-dim bg-background/40 rounded border px-2"
    >
      {toolCalls.map((toolCall) => (
        <AccordionItem
          key={toolCall.id}
          value={toolCall.id}
          className="border-border-dim"
        >
          <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-accent-blue font-mono">
                {toolCall.name}
              </span>
              <ToolCallStateBadge state={toolCall.state} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-2">
            {toolCall.input !== undefined ? (
              <div>
                <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                  Input
                </div>
                <StructuredValueViewer
                  value={toolCall.input}
                  className="my-0"
                  stringLanguage="language-json"
                />
              </div>
            ) : null}
            {toolCall.output !== undefined ? (
              <div>
                <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                  Output
                </div>
                <StructuredValueViewer
                  value={toolCall.output}
                  className="my-0"
                  stringLanguage="language-json"
                />
              </div>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ToolCallStateBadge({
  state,
}: {
  state: LocalToolCall["state"];
}) {
  const className =
    state === "done"
      ? "text-accent-green border-accent-green/20 bg-accent-green/[0.06]"
      : state === "denied" || state === "error"
        ? "text-accent-red border-accent-red/20 bg-accent-red/[0.06]"
        : "text-accent-amber border-accent-amber/20 bg-accent-amber/[0.06]";

  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${className}`}
    >
      {state}
    </span>
  );
}

export function ChatMessageList({
  localMsgs,
  messages,
  liveConversationRuns,
  activeCallEvents,
  isAgentRunning,
  endRef,
}: ChatMessageListProps) {
  return (
    <div className="flex-1 space-y-2 overflow-auto p-2 leading-relaxed">
      {localMsgs.map((m) => (
        <LocalMessage key={m.id} message={m} />
      ))}
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            m.role === "user"
              ? "text-secondary-foreground"
              : "text-foreground"
          }
        >
          {m.role === "user" ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0 select-none">
                you
              </span>
              <span className="whitespace-pre-wrap">{getText(m)}</span>
            </div>
          ) : (
            <MessageContent message={m} />
          )}
        </div>
      ))}
      {liveConversationRuns.map((run) => (
        <div
          key={run.id}
          className="border-border text-muted-foreground rounded border px-2 py-1.5 text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${run.status === "streaming" ? "animate-pulse bg-accent-blue" : "bg-accent-amber"}`}
            />
            <span className="tracking-wide uppercase">{run.type}</span>
            <span>{run.status}</span>
            <span className="ml-auto font-mono">{run.id.slice(0, 8)}</span>
          </div>
        </div>
      ))}
      {activeCallEvents.length > 0 && (
        <div className="border-border-dim bg-background/60 space-y-1.5 rounded border px-2 py-2">
          <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Live timeline
          </div>
          {activeCallEvents.slice(-6).map((event) => (
            <div key={event.id} className="text-muted-foreground text-[11px]">
              <span className="text-secondary-foreground">
                {event.event_type.replaceAll("_", " ")}
              </span>
              {event.tool_name && ` - ${event.tool_name}`}
              {event.message && ` - ${event.message}`}
            </div>
          ))}
        </div>
      )}
      {isAgentRunning && (
        <div className="py-2">
          <AsciiLoader />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
