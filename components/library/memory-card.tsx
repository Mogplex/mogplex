"use client";

import { useState } from "react";
import { Check, EditPencil, Trash, Xmark } from "iconoir-react";
import type { Memory } from "./context-section-types";
import { describeMemoryOrigin, formatMemoryDate } from "./context-section-utils";

/** Content longer than this collapses behind a "Show more" toggle. */
export const MEMORY_CARD_COLLAPSE_CHARS = 480;

interface MemoryCardProps {
  memory: Memory;
  repoLabel?: string | null;
  compact?: boolean;
  isEditing: boolean;
  isBusy: boolean;
  editingContent: string;
  onEditingContentChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function MemoryChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] leading-none">
      {children}
    </span>
  );
}

export function MemoryCard({
  memory,
  repoLabel,
  compact,
  isEditing,
  isBusy,
  editingContent,
  onEditingContentChange,
  onStartEdit,
  onSave,
  onCancelEdit,
  onDelete,
}: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const origin = describeMemoryOrigin(memory);
  const isLong = memory.content.length > MEMORY_CARD_COLLAPSE_CHARS;
  const shownContent =
    isLong && !expanded
      ? `${memory.content.slice(0, MEMORY_CARD_COLLAPSE_CHARS).trimEnd()}…`
      : memory.content;

  if (isEditing) {
    return (
      <div className="border-border bg-card rounded-md border p-2">
        <div className="space-y-2">
          <textarea
            value={editingContent}
            onChange={(event) => onEditingContentChange(event.target.value)}
            rows={compact ? 4 : 5}
            className="border-border bg-input text-foreground w-full resize-none rounded border px-2 py-1.5 text-xs outline-none"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={onSave}
              className="border-border hover:bg-secondary inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
            >
              <Check className="size-3.5" />
              Save
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onCancelEdit}
              className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-50"
            >
              <Xmark className="size-3.5" />
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-border bg-card rounded-md border p-2"
      data-testid="memory-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-foreground whitespace-pre-wrap break-words text-xs">
            {shownContent}
          </div>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-muted-foreground hover:text-foreground mt-1 text-[11px] underline-offset-2 hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span>{formatMemoryDate(memory.updated_at || memory.created_at)}</span>
            {repoLabel ? <MemoryChip>{repoLabel}</MemoryChip> : null}
            {origin ? <MemoryChip>{origin}</MemoryChip> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Edit memory"
            disabled={isBusy}
            onClick={onStartEdit}
            className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded p-1 disabled:opacity-50"
          >
            <EditPencil className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete memory"
            disabled={isBusy}
            onClick={onDelete}
            className="text-muted-foreground hover:bg-secondary hover:text-destructive rounded p-1 disabled:opacity-50"
          >
            <Trash className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
