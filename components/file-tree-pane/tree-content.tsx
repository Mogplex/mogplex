"use client";

import { Button } from "@/components/ui/button";
import { FileTree, type useFileTree } from "@pierre/trees/react";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";

interface TreeContentProps {
  loading: boolean;
  error: string | null;
  pathsLength: number;
  model: ReturnType<typeof useFileTree>["model"];
  renderContextMenu: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => React.ReactNode;
  onTreeClick: (event: React.MouseEvent<HTMLElement>) => void;
  onTreeKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onRetry: () => void;
}

export function TreeContent({
  loading,
  error,
  pathsLength,
  model,
  renderContextMenu,
  onTreeClick,
  onTreeKeyDown,
  onRetry,
}: TreeContentProps) {
  if (loading) {
    return (
      <div className="text-muted-foreground p-3 text-xs">
        Loading project tree...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-start gap-3 p-3">
        <div className="text-destructive text-xs">{error}</div>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (pathsLength === 0) {
    return (
      <div className="text-muted-foreground p-3 text-xs">No files found.</div>
    );
  }

  return (
    <FileTree
      model={model}
      header={null}
      renderContextMenu={renderContextMenu}
      className="h-full w-full bg-transparent"
      onClick={onTreeClick}
      onKeyDown={onTreeKeyDown}
    />
  );
}
