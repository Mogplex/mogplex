"use client";

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@pierre/trees";
import { getParentDirectoryTreePath } from "@/lib/file-tree-paths";
import type { useFileTree } from "@pierre/trees/react";
import type { TreeCreateKind } from "./helpers";

interface FileTreeContextMenuProps {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
  model: ReturnType<typeof useFileTree>["model"];
  onOpenFile: (path: string) => void;
  onOpenCreateDialog: (kind: TreeCreateKind, directoryPath: string | null) => void;
  onSetDeleteTarget: (item: ContextMenuItem) => void;
}

export function FileTreeContextMenu({
  item,
  context,
  model,
  onOpenFile,
  onOpenCreateDialog,
  onSetDeleteTarget,
}: FileTreeContextMenuProps) {
  const directoryPath =
    item.kind === "directory"
      ? item.path
      : getParentDirectoryTreePath(item.path);

  return (
    <div className="border-border/80 bg-background/95 min-w-44 rounded-md border p-1 shadow-xl backdrop-blur-sm">
      {item.kind === "file" && (
        <button
          type="button"
          className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
          onClick={() => {
            context.close();
            onOpenFile(item.path);
          }}
        >
          Open file
        </button>
      )}
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
        onClick={() => {
          context.close({ restoreFocus: false });
          model.startRenaming(item.path);
        }}
      >
        Rename
      </button>
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
        onClick={() => {
          context.close({ restoreFocus: false });
          onOpenCreateDialog("file", directoryPath);
        }}
      >
        New file here
      </button>
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
        onClick={() => {
          context.close({ restoreFocus: false });
          onOpenCreateDialog("directory", directoryPath);
        }}
      >
        New folder here
      </button>
      <div className="bg-border/80 my-1 h-px" />
      <button
        type="button"
        className="text-destructive hover:bg-destructive/10 flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
        onClick={() => {
          context.close({ restoreFocus: false });
          onSetDeleteTarget(item);
        }}
      >
        Delete
      </button>
    </div>
  );
}
