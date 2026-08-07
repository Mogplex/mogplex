"use client";

import { cn } from "@/lib/utils";
import type { Memory, MemoryLane } from "./context-section-types";
import { LANE_INFO } from "./context-section-types";
import { MemoryCard } from "./memory-card";

interface MemoryListProps {
  memories: Memory[];
  lane: MemoryLane;
  compact?: boolean;
  loading: boolean;
  memoriesError: Error | undefined;
  editingId: string | null;
  busyId: string | null;
  editingContent: string;
  onEditingContentChange: (value: string) => void;
  onStartEdit: (memory: Memory) => void;
  onSaveMemory: (id: string) => void;
  onCancelEdit: () => void;
  onDeleteMemory: (id: string) => void;
}

export function MemoryList({
  memories,
  lane,
  compact,
  loading,
  memoriesError,
  editingId,
  busyId,
  editingContent,
  onEditingContentChange,
  onStartEdit,
  onSaveMemory,
  onCancelEdit,
  onDeleteMemory,
}: MemoryListProps) {
  return (
    <div className="flex-1 overflow-auto">
      <div className={cn("space-y-2", compact ? "p-2" : "p-3")}>
        {loading && (
          <div className="text-muted-foreground text-[11px]">
            Loading memories...
          </div>
        )}
        {memoriesError && (
          <div className="text-destructive text-[11px]">
            {memoriesError.message}
          </div>
        )}
        {!loading && memories.length === 0 && (
          <div className="text-muted-foreground flex min-h-28 items-center justify-center px-4 text-center text-[11px]">
            No {LANE_INFO[lane].label.toLowerCase()} memories match these
            filters.
          </div>
        )}
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            compact={compact}
            isEditing={editingId === memory.id}
            isBusy={busyId === memory.id}
            editingContent={editingContent}
            onEditingContentChange={onEditingContentChange}
            onStartEdit={() => onStartEdit(memory)}
            onSave={() => onSaveMemory(memory.id)}
            onCancelEdit={onCancelEdit}
            onDelete={() => onDeleteMemory(memory.id)}
          />
        ))}
      </div>
    </div>
  );
}
