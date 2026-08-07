"use client";
import { AsciiLoader } from "@/components/ascii-loader";

interface AgentHeaderProps {
  showHistory: boolean;
  isAgentRunning: boolean;
  status: string;
  stopError: string | null;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onStopRun: () => void;
}

export function AgentHeader({
  showHistory,
  isAgentRunning,
  status,
  stopError,
  onToggleHistory,
  onNewChat,
  onStopRun,
}: AgentHeaderProps) {
  return (
    <div className="border-border-dim flex h-8 items-center gap-1 border-b px-2">
      <button
        onClick={onToggleHistory}
        className={`rounded px-2 py-0.5 text-[11px] transition-colors ${showHistory ? "bg-muted text-foreground" : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"}`}
      >
        History
      </button>
      <button
        onClick={onNewChat}
        className="text-muted-foreground hover:text-secondary-foreground hover:bg-muted rounded px-2 py-0.5 text-[11px] transition-colors"
      >
        New chat
      </button>
      {isAgentRunning && (
        <button
          onClick={onStopRun}
          className="rounded px-2 py-0.5 text-[11px] text-accent-red transition-colors hover:bg-accent-red/10"
        >
          Stop
        </button>
      )}
      {stopError && (
        <span className="max-w-[220px] truncate text-[11px] text-accent-red">
          {stopError}
        </span>
      )}
      {(status === "streaming" || status === "submitted") && (
        <span className="ml-auto">
          <AsciiLoader variant={status === "streaming" ? undefined : "bars"} />
        </span>
      )}
    </div>
  );
}
