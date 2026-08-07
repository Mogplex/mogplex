"use client";

import { useState, useRef, useEffect } from "react";
import { ChatBubble } from "iconoir-react";
import type { SelectionRect } from "./types";

export function FeedbackForm({
  region,
  onSubmit,
  onCancel,
}: {
  region: SelectionRect;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      {/* Region highlight */}
      <div
        className="pointer-events-none absolute border-2 border-blue-400 bg-blue-400/10"
        style={{
          left: `${region.x}%`,
          top: `${region.y}%`,
          width: `${region.width}%`,
          height: `${region.height}%`,
        }}
      />

      {/* Feedback input */}
      <div className="bg-card border-border relative z-30 w-72 overflow-hidden rounded-lg border shadow-lg">
        <div className="border-border bg-secondary flex items-center gap-2 border-b px-3 py-2">
          <ChatBubble className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-secondary-foreground text-[11px] font-medium">
            Send feedback to agent
          </span>
        </div>
        <div className="p-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe what you see or what should change..."
            data-testid="preview-feedback-input"
            className="bg-background border-border focus:ring-ring placeholder:text-muted-foreground/50 h-16 w-full resize-none rounded border px-2 py-1.5 text-xs focus:ring-1 focus:outline-none"
          />
        </div>
        <div className="border-border flex items-center justify-between border-t px-3 py-2">
          <span className="text-muted-foreground/60 text-[9px]">
            Region: {region.x}%,{region.y}% · {region.width}×{region.height}%
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground border-border hover:bg-secondary rounded border px-2.5 py-1 text-[10px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              data-testid="preview-feedback-send"
              className="text-primary-foreground bg-primary hover:bg-primary/90 rounded px-2.5 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
