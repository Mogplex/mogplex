"use client";
import { forwardRef } from "react";
import type { UIMessage } from "ai";
import type { LocalMessage as ConversationLocalMessage } from "@/hooks/use-conversations";
import type { AiCallEvent } from "@/lib/types/ai";
import { AsciiLoader } from "@/components/ascii-loader";
import { LocalMessage } from "../local-message";
import dynamic from "next/dynamic";

const MessageContent = dynamic(
  () => import("@/components/message-content").then((m) => m.MessageContent),
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
}

function getText(msg: { parts?: Array<{ type: string; text?: string }> }) {
  if (!msg.parts) return "";
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export const ChatMessageList = forwardRef<HTMLDivElement, ChatMessageListProps>(
  function ChatMessageList(
    { localMsgs, messages, liveConversationRuns, activeCallEvents, isAgentRunning },
    ref
  ) {
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
        <div ref={ref} />
      </div>
    );
  }
);
