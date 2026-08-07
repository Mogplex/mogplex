"use client";

import { Check, EditPencil, Trash, Xmark } from "iconoir-react";
import type { Memory } from "./context-section-types";
import { formatMemoryDate } from "./context-section-utils";

interface MemoryCardProps {
  memory: Memory;
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

export function MemoryCard({
  memory,
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
    <div className="border-border bg-card rounded-md border p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-foreground whitespace-pre-wrap break-words text-xs">
            {memory.content}
          </div>
          <div className="text-muted-foreground mt-1 text-[11px]">
            {formatMemoryDate(memory.updated_at || memory.created_at)}
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
