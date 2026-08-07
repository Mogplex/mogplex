"use client";
import { timeAgo } from "../utils";

interface ConversationListItem {
  id: string;
  title: string | null;
  model: string;
  updated_at: string;
}

interface ConversationHistoryProps {
  items: ConversationListItem[];
  onResumeConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

export function ConversationHistory({
  items,
  onResumeConversation,
  onDeleteConversation,
}: ConversationHistoryProps) {
  return (
    <div className="flex-1 space-y-1 overflow-auto p-2">
      {items.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">
          No past conversations
        </div>
      )}
      {items.map((c) => (
        <div
          key={c.id}
          className="hover:bg-muted group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
          onClick={() => onResumeConversation(c.id)}
        >
          <div className="min-w-0 flex-1">
            <div className="text-secondary-foreground truncate text-sm">
              {c.title || c.id.slice(0, 12)}
            </div>
            <div className="text-muted-foreground flex gap-2 text-[11px]">
              <span>{c.model.split("/").pop()}</span>
              <span>{timeAgo(c.updated_at)}</span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteConversation(c.id);
            }}
            className="text-muted-foreground hover:text-accent-red flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
            title="Delete"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
