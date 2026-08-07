"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTreePath,
  applyTreeMoves,
  buildTreeDropDestinationPath,
  getParentDirectoryTreePath,
  isDirectoryTreePath,
  removeTreePath,
  sortTreePaths,
  stripDirectoryTreePath,
} from "@/lib/file-tree-paths";
import { toast } from "@/hooks/use-toast";
import { useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import {
  type ContextMenuItem,
  prepareFileTreeInput,
  type FileTreeDropResult,
  type FileTreeRenameEvent,
} from "@pierre/trees";

import {
  type TreeCreateKind,
  buildDefaultCreatePath,
  getComposedPath,
  getTreeInteractionMeta,
  expandTreeAncestors,
  getExpandedDirectoryTreePaths,
} from "./file-tree-pane/helpers";
import { CreateFileDialog, DeleteFileDialog } from "./file-tree-pane/dialogs";
import { FileTreeContextMenu } from "./file-tree-pane/context-menu";
import { TreeToolbar } from "./file-tree-pane/tree-toolbar";
import { TreeContent } from "./file-tree-pane/tree-content";
import {
  fetchTreePaths,
  renameTreeItem,
  moveTreeItems,
  createTreeItem,
  deleteTreeItem,
} from "./file-tree-pane/tree-api";

interface Props {
  sandboxId: string;
  onOpenFile?: (filePath: string) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  rootLabel?: string | null;
  activeFilePath?: string | null;
}

const EMPTY_PREPARED_INPUT = prepareFileTreeInput([]);

export function FileTreePane({
  sandboxId,
  onOpenFile,
  onRetargetFilePath,
  onClearFilePath,
  rootLabel,
  activeFilePath,
}: Props) {
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<{
    directoryPath: string | null;
    kind: TreeCreateKind;
  } | null>(null);
  const [createPath, setCreatePath] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContextMenuItem | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const refreshRequestIdRef = useRef(0);
  const pathsRef = useRef<string[]>([]);
  const activeFilePathRef = useRef(activeFilePath ?? null);
  const onOpenFileRef = useRef(onOpenFile);
  const onRetargetFilePathRef = useRef(onRetargetFilePath);
  const onClearFilePathRef = useRef(onClearFilePath);
  const refreshTreeRef = useRef<
    (options?: { focusPath?: string | null; silent?: boolean }) => Promise<void>
  >(async () => {});

  useEffect(() => {
    onOpenFileRef.current = onOpenFile;
  }, [onOpenFile]);
  useEffect(() => {
    onRetargetFilePathRef.current = onRetargetFilePath;
  }, [onRetargetFilePath]);
  useEffect(() => {
    onClearFilePathRef.current = onClearFilePath;
  }, [onClearFilePath]);
  useEffect(() => {
    activeFilePathRef.current = activeFilePath ?? null;
  }, [activeFilePath]);

  const replaceTrackedPaths = useCallback((nextPaths: string[]) => {
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
  }, []);

  const handleRename = useCallback(
    (event: FileTreeRenameEvent) => {
      if (event.sourcePath === event.destinationPath) return;
      void (async () => {
        const previousPaths = pathsRef.current;
        let optimisticApplied = false;
        try {
          await renameTreeItem(sandboxId, event.sourcePath, event.destinationPath);
          replaceTrackedPaths(
            applyTreeMoves(pathsRef.current, [
              { fromPath: event.sourcePath, toPath: event.destinationPath },
            ])
          );
          onRetargetFilePathRef.current?.(
            event.sourcePath,
            event.destinationPath,
            sandboxId
          );
          optimisticApplied = true;
          await refreshTreeRef.current({
            focusPath: event.destinationPath,
            silent: true,
          });
        } catch (renameError) {
          if (optimisticApplied) {
            replaceTrackedPaths(previousPaths);
            onRetargetFilePathRef.current?.(
              event.destinationPath,
              event.sourcePath,
              sandboxId
            );
          }
          toast({
            title: "Rename failed",
            description:
              renameError instanceof Error
                ? renameError.message
                : "Rename failed",
            variant: "destructive",
          });
          await refreshTreeRef.current({
            focusPath: event.sourcePath,
            silent: true,
          });
        }
      })();
    },
    [replaceTrackedPaths, sandboxId]
  );

  const handleDropComplete = useCallback(
    (event: FileTreeDropResult) => {
      const moves = event.draggedPaths
        .map((sourcePath) => ({
          fromPath: sourcePath,
          toPath: buildTreeDropDestinationPath(
            sourcePath,
            event.target.kind === "root" ? null : event.target.directoryPath
          ),
        }))
        .filter((move) => move.fromPath !== move.toPath);
      if (moves.length === 0) return;
      void (async () => {
        const previousPaths = pathsRef.current;
        let optimisticApplied = false;
        try {
          await moveTreeItems(sandboxId, moves);
          replaceTrackedPaths(applyTreeMoves(pathsRef.current, moves));
          for (const move of moves) {
            onRetargetFilePathRef.current?.(
              move.fromPath,
              move.toPath,
              sandboxId
            );
          }
          optimisticApplied = true;
          await refreshTreeRef.current({
            focusPath: moves[0]?.toPath ?? null,
            silent: true,
          });
        } catch (moveError) {
          if (optimisticApplied) {
            replaceTrackedPaths(previousPaths);
            for (const move of moves) {
              onRetargetFilePathRef.current?.(
                move.toPath,
                move.fromPath,
                sandboxId
              );
            }
          }
          toast({
            title: "Move failed",
            description:
              moveError instanceof Error ? moveError.message : "Move failed",
            variant: "destructive",
          });
          await refreshTreeRef.current({ silent: true });
        }
      })();
    },
    [replaceTrackedPaths, sandboxId]
  );

  const { model } = useFileTree({
    preparedInput: EMPTY_PREPARED_INPUT,
    initialExpansion: 1,
    initialVisibleRowCount: 18,
    search: true,
    flattenEmptyDirectories: true,
    fileTreeSearchMode: "hide-non-matches",
    density: "compact",
    icons: "standard",
    dragAndDrop: {
      onDropComplete: handleDropComplete,
      onDropError: (message: string) => {
        toast({ title: "Move blocked", description: message, variant: "destructive" });
      },
    },
    renaming: {
      onRename: handleRename,
      onError: (message: string) => {
        toast({ title: "Rename blocked", description: message, variant: "destructive" });
      },
    },
  });

  const syncModelPaths = useCallback(
    (
      nextPaths: string[],
      focusPath?: string | null,
      expandedSourcePaths: readonly string[] = pathsRef.current
    ) => {
      const sortedPaths = sortTreePaths(nextPaths);
      const preparedInput = prepareFileTreeInput(sortedPaths);
      const expandedPaths = getExpandedDirectoryTreePaths(model, expandedSourcePaths);
      model.resetPaths(
        sortedPaths,
        expandedPaths.length > 0
          ? { preparedInput, initialExpandedPaths: expandedPaths }
          : { preparedInput }
      );
      if (!focusPath) return;
      expandTreeAncestors(model, focusPath, { includeSelf: isDirectoryTreePath(focusPath) });
      const focusedItem = model.getItem(focusPath);
      if (focusedItem) {
        focusedItem.focus();
      } else {
        model.focusNearestPath(focusPath);
      }
    },
    [model]
  );

  const refreshTree = useCallback(
    async (options?: { focusPath?: string | null; silent?: boolean }) => {
      const requestId = refreshRequestIdRef.current + 1;
      refreshRequestIdRef.current = requestId;
      if (options?.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const nextPaths = sortTreePaths(await fetchTreePaths(sandboxId));
        if (refreshRequestIdRef.current !== requestId) return;
        const previousPaths = pathsRef.current;
        replaceTrackedPaths(nextPaths);
        setError(null);
        syncModelPaths(
          nextPaths,
          options?.focusPath ?? activeFilePathRef.current ?? null,
          previousPaths
        );
      } catch (loadError) {
        if (refreshRequestIdRef.current !== requestId) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load tree");
      } finally {
        if (refreshRequestIdRef.current === requestId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [replaceTrackedPaths, sandboxId, syncModelPaths]
  );

  refreshTreeRef.current = refreshTree;

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    if (!activeFilePath || paths.length === 0) return;
    if (!paths.includes(activeFilePath)) return;
    expandTreeAncestors(model, activeFilePath);
    model.focusPath(activeFilePath);
  }, [activeFilePath, model, paths]);

  const search = useFileTreeSearch(model);
  const rootDisplayLabel = useMemo(() => rootLabel || "/", [rootLabel]);

  const openFilePath = useCallback((filePath: string) => {
    onOpenFileRef.current?.(filePath);
  }, []);

  const openCreateDialog = useCallback(
    (kind: TreeCreateKind, directoryPath: string | null = null) => {
      setCreateDialog({ kind, directoryPath });
      setCreatePath(buildDefaultCreatePath(kind, directoryPath));
    },
    []
  );

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(null);
    setCreatePath("");
    setCreating(false);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createDialog) return;
    setCreating(true);
    try {
      const payload = await createTreeItem(sandboxId, createDialog.kind, createPath);
      replaceTrackedPaths(addTreePath(pathsRef.current, payload.path));
      model.add(payload.path);
      expandTreeAncestors(model, payload.path, { includeSelf: isDirectoryTreePath(payload.path) });
      model.focusPath(payload.path);
      if (!isDirectoryTreePath(payload.path)) openFilePath(payload.path);
      await refreshTreeRef.current({ focusPath: payload.path, silent: true });
      toast({
        title: createDialog.kind === "directory" ? "Folder created" : "File created",
        description: stripDirectoryTreePath(payload.path),
      });
      closeCreateDialog();
    } catch (createError) {
      toast({
        title: "Create failed",
        description: createError instanceof Error ? createError.message : "Create failed",
        variant: "destructive",
      });
      setCreating(false);
    }
  }, [closeCreateDialog, createDialog, createPath, model, openFilePath, replaceTrackedPaths, sandboxId]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const payload = await deleteTreeItem(sandboxId, deleteTarget.path);
      replaceTrackedPaths(removeTreePath(pathsRef.current, payload.path));
      model.remove(payload.path, { recursive: isDirectoryTreePath(payload.path) });
      onClearFilePathRef.current?.(payload.path, sandboxId);
      await refreshTreeRef.current({ focusPath: getParentDirectoryTreePath(payload.path), silent: true });
      toast({
        title: deleteTarget.kind === "directory" ? "Folder deleted" : "File deleted",
        description: stripDirectoryTreePath(payload.path),
      });
      setDeleteTarget(null);
    } catch (deleteError) {
      toast({
        title: "Delete failed",
        description: deleteError instanceof Error ? deleteError.message : "Delete failed",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, model, replaceTrackedPaths, sandboxId]);

  const handleTreeClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const meta = getTreeInteractionMeta(event.nativeEvent);
      if (!meta || meta.kind !== "file") return;
      openFilePath(meta.path);
    },
    [openFilePath]
  );

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter") return;
      const composedPath = getComposedPath(event.nativeEvent);
      if (composedPath.some((node) => node instanceof HTMLElement && node.getAttribute("data-item-rename-input") === "true")) return;
      const focusedPath = model.getFocusedPath();
      if (!focusedPath) return;
      const focusedItem = model.getItem(focusedPath);
      if (!focusedItem || focusedItem.isDirectory()) return;
      event.preventDefault();
      openFilePath(focusedPath);
    },
    [model, openFilePath]
  );

  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: Parameters<typeof FileTreeContextMenu>[0]["context"]) => (
      <FileTreeContextMenu
        item={item}
        context={context}
        model={model}
        onOpenFile={openFilePath}
        onOpenCreateDialog={openCreateDialog}
        onSetDeleteTarget={setDeleteTarget}
      />
    ),
    [model, openCreateDialog, openFilePath]
  );

  return (
    <>
      <div className="flex h-full flex-col text-sm">
        <TreeToolbar
          rootDisplayLabel={rootDisplayLabel}
          refreshing={refreshing}
          search={search}
          onCreateFile={() => openCreateDialog("file")}
          onCreateFolder={() => openCreateDialog("directory")}
          onRefresh={() => void refreshTree({ silent: true })}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <TreeContent
            loading={loading}
            error={error}
            pathsLength={paths.length}
            model={model}
            renderContextMenu={renderContextMenu}
            onTreeClick={handleTreeClick}
            onTreeKeyDown={handleTreeKeyDown}
            onRetry={() => void refreshTree()}
          />
        </div>
      </div>
      <CreateFileDialog
        open={createDialog !== null}
        kind={createDialog?.kind ?? null}
        path={createPath}
        creating={creating}
        onPathChange={setCreatePath}
        onClose={closeCreateDialog}
        onCreate={() => void handleCreate()}
      />
      <DeleteFileDialog
        target={deleteTarget}
        deleting={deleting}
        onClose={() => setDeleteTarget(null)}
        onDelete={() => void handleDelete()}
      />
    </>
  );
}
