"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Refresh } from "iconoir-react";
import type { useFileTreeSearch } from "@pierre/trees/react";

interface TreeToolbarProps {
  rootDisplayLabel: string;
  refreshing: boolean;
  search: ReturnType<typeof useFileTreeSearch>;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
}

export function TreeToolbar({
  rootDisplayLabel,
  refreshing,
  search,
  onCreateFile,
  onCreateFolder,
  onRefresh,
}: TreeToolbarProps) {
  return (
    <div className="border-border flex flex-col gap-2 border-b px-2 py-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
          {rootDisplayLabel}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={onCreateFile}
        >
          <Plus className="size-3.5" />
          File
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={onCreateFolder}
        >
          <Plus className="size-3.5" />
          Folder
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          title="Refresh files"
          aria-label="Refresh files"
        >
          <Refresh className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <Input
        value={search.value}
        onFocus={() => search.open(search.value || undefined)}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (!search.isOpen) {
            search.open(nextValue);
            return;
          }
          search.setValue(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            search.focusNextMatch();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            search.focusPreviousMatch();
          } else if (event.key === "Escape") {
            search.close();
          }
        }}
        placeholder="Search files..."
        aria-label="Search project files"
        className="h-8 text-xs"
      />
    </div>
  );
}
