"use client";
import { useMemo } from "react";
import type {
  LocalMessage as ConversationLocalMessage,
  LocalToolCall,
} from "@/hooks/use-conversations";
import { PatchViewer } from "@/components/diffs/patch-viewer";
import { detectPatch } from "@/lib/diffs/detect";
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function LocalMessage({
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
            <div
              key={`text-${index}`}
              className="text-foreground whitespace-pre-wrap"
            >
              {segment.text}
            </div>
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
        <div className="text-foreground whitespace-pre-wrap">
          {message.text}
        </div>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <LocalToolCalls toolCalls={message.toolCalls} />
      ) : null}
    </div>
  );
}

export function LocalToolCalls({ toolCalls }: { toolCalls: LocalToolCall[] }) {
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

export function ToolCallStateBadge({
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
