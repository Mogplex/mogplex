"use client";

import { Plus } from "iconoir-react";
import { cn } from "@/lib/utils";
import type { MemoryLane, MemoryResourceScope } from "./context-section-types";
import { LANE_INFO, SCOPE_LABELS } from "./context-section-types";

interface MemoryComposerProps {
  lane: MemoryLane;
  writeScope: Exclude<MemoryResourceScope, "all">;
  query: string;
  newContent: string;
  onNewContentChange: (value: string) => void;
  creating: boolean;
  onAdd: () => void;
  compact?: boolean;
}

export function MemoryComposer({
  lane,
  writeScope,
  query,
  newContent,
  onNewContentChange,
  creating,
  onAdd,
  compact,
}: MemoryComposerProps) {
  return (
    <div className={cn("border-border border-t", compact ? "p-2" : "p-3")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="ui-label">Add to {LANE_INFO[lane].label}</div>
        <div className="text-muted-foreground text-[11px]">
          Saves as {SCOPE_LABELS[writeScope]}
        </div>
      </div>
      <textarea
        value={newContent}
        onChange={(event) => onNewContentChange(event.target.value)}
        placeholder={`Add ${LANE_INFO[lane].label.toLowerCase()} memory...`}
        rows={compact ? 2 : 3}
        className="border-border bg-input text-foreground w-full resize-none rounded border px-2 py-1.5 text-xs outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-muted-foreground min-w-0 truncate text-[11px]">
          {query ? `Filtered by "${query}"` : LANE_INFO[lane].desc}
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={onAdd}
          className="border-border bg-secondary hover:bg-primary hover:text-primary-foreground inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-[11px] text-foreground disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
