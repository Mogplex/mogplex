"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTreePath,
  applyTreeMoves,
  buildTreeDropDestinationPath,
  getAncestorDirectoryTreePaths,
  getParentDirectoryTreePath,
  isDirectoryTreePath,
  removeTreePath,
  sortTreePaths,
  stripDirectoryTreePath,
} from "@/lib/file-tree-paths";
import { toast } from "@/hooks/use-toast";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  prepareFileTreeInput,
  type FileTreeDropResult,
  type FileTreeRenameEvent,
} from "@pierre/trees";
import { Plus, Refresh } from "iconoir-react";

type TreeCreateKind = "directory" | "file";

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

function buildDefaultCreatePath(
  kind: TreeCreateKind,
  directoryPath?: string | null
) {
  const baseName = kind === "file" ? "untitled.txt" : "new-folder/";
  return directoryPath ? `${directoryPath}${baseName}` : baseName;
}

function getComposedPath(event: Event) {
  return typeof event.composedPath === "function" ? event.composedPath() : [];
}

function getTreeInteractionMeta(event: Event) {
  const composedPath = getComposedPath(event);
  let targetPath: string | null = null;
  let targetKind: "directory" | "file" | null = null;

  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) continue;
    if (
      node.dataset.type === "context-menu-trigger" ||
      node.dataset.itemRenameInput === "true"
    ) {
      return null;
    }
    if (!targetPath && node.dataset.itemPath) {
      targetPath = node.dataset.itemPath;
      targetKind = node.dataset.itemType === "folder" ? "directory" : "file";
    }
  }

  return targetPath && targetKind
    ? { kind: targetKind, path: targetPath }
    : null;
}

function expandTreeAncestors(
  model: ReturnType<typeof useFileTree>["model"],
  path: string,
  options?: { includeSelf?: boolean }
) {
  for (const ancestor of getAncestorDirectoryTreePaths(path, options)) {
    const item = model.getItem(ancestor);
    if (item && "expand" in item) item.expand();
  }
}

function getExpandedDirectoryTreePaths(
  model: ReturnType<typeof useFileTree>["model"],
  paths: readonly string[]
) {
  const expandedPaths: string[] = [];

  for (const treePath of paths) {
    if (!isDirectoryTreePath(treePath)) continue;
    const item = model.getItem(treePath);
    if (item && "isExpanded" in item && item.isExpanded()) {
      expandedPaths.push(treePath);
    }
  }

  return expandedPaths;
}

async function readJsonResponse<T>(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

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
  const activeFilePathRef = useRef<string | null>(activeFilePath ?? null);
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
          await readJsonResponse<{
            moves: Array<{ fromPath: string; toPath: string }>;
          }>(
            await fetch(`/api/sandbox/${sandboxId}/tree`, {
              method: "PATCH",
              headers: getActiveTeamRequestHeaders({
                "Content-Type": "application/json",
              }),
              body: JSON.stringify({
                moves: [
                  {
                    fromPath: event.sourcePath,
                    toPath: event.destinationPath,
                  },
                ],
              }),
            })
          );

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
          await readJsonResponse<{
            moves: Array<{ fromPath: string; toPath: string }>;
          }>(
            await fetch(`/api/sandbox/${sandboxId}/tree`, {
              method: "PATCH",
              headers: getActiveTeamRequestHeaders({
                "Content-Type": "application/json",
              }),
              body: JSON.stringify({ moves }),
            })
          );

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
      onDropError: (message) => {
        toast({
          title: "Move blocked",
          description: message,
          variant: "destructive",
        });
      },
    },
    renaming: {
      onRename: handleRename,
      onError: (message) => {
        toast({
          title: "Rename blocked",
          description: message,
          variant: "destructive",
        });
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
      const expandedPaths = getExpandedDirectoryTreePaths(
        model,
        expandedSourcePaths
      );
      model.resetPaths(
        sortedPaths,
        expandedPaths.length > 0
          ? {
              preparedInput,
              initialExpandedPaths: expandedPaths,
            }
          : { preparedInput }
      );

      if (!focusPath) return;

      expandTreeAncestors(model, focusPath, {
        includeSelf: isDirectoryTreePath(focusPath),
      });
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

      if (options?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const payload = await readJsonResponse<{ paths: string[] }>(
          await fetch(`/api/sandbox/${sandboxId}/tree`, {
            cache: "no-store",
          })
        );

        if (refreshRequestIdRef.current !== requestId) return;

        const nextPaths = sortTreePaths(payload.paths || []);
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
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load tree"
        );
      } finally {
        if (refreshRequestIdRef.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
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
      const payload = await readJsonResponse<{ path: string }>(
        await fetch(`/api/sandbox/${sandboxId}/tree`, {
          method: "POST",
          headers: getActiveTeamRequestHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            kind: createDialog.kind,
            path: createPath,
          }),
        })
      );

      replaceTrackedPaths(addTreePath(pathsRef.current, payload.path));
      model.add(payload.path);
      expandTreeAncestors(model, payload.path, {
        includeSelf: isDirectoryTreePath(payload.path),
      });
      model.focusPath(payload.path);

      if (!isDirectoryTreePath(payload.path)) {
        openFilePath(payload.path);
      }

      await refreshTreeRef.current({
        focusPath: payload.path,
        silent: true,
      });

      toast({
        title:
          createDialog.kind === "directory" ? "Folder created" : "File created",
        description: stripDirectoryTreePath(payload.path),
      });
      closeCreateDialog();
    } catch (createError) {
      toast({
        title: "Create failed",
        description:
          createError instanceof Error ? createError.message : "Create failed",
        variant: "destructive",
      });
      setCreating(false);
    }
  }, [
    closeCreateDialog,
    createDialog,
    createPath,
    model,
    openFilePath,
    replaceTrackedPaths,
    sandboxId,
  ]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const payload = await readJsonResponse<{ path: string }>(
        await fetch(`/api/sandbox/${sandboxId}/tree`, {
          method: "DELETE",
          headers: getActiveTeamRequestHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ path: deleteTarget.path }),
        })
      );

      replaceTrackedPaths(removeTreePath(pathsRef.current, payload.path));
      model.remove(payload.path, {
        recursive: isDirectoryTreePath(payload.path),
      });
      onClearFilePathRef.current?.(payload.path, sandboxId);
      await refreshTreeRef.current({
        focusPath: getParentDirectoryTreePath(payload.path),
        silent: true,
      });
      toast({
        title:
          deleteTarget.kind === "directory" ? "Folder deleted" : "File deleted",
        description: stripDirectoryTreePath(payload.path),
      });
      setDeleteTarget(null);
    } catch (deleteError) {
      toast({
        title: "Delete failed",
        description:
          deleteError instanceof Error ? deleteError.message : "Delete failed",
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
      if (
        composedPath.some(
          (node) =>
            node instanceof HTMLElement &&
            node.dataset.itemRenameInput === "true"
        )
      ) {
        return;
      }

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
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
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
                openFilePath(item.path);
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
              openCreateDialog("file", directoryPath);
            }}
          >
            New file here
          </button>
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
            onClick={() => {
              context.close({ restoreFocus: false });
              openCreateDialog("directory", directoryPath);
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
              setDeleteTarget(item);
            }}
          >
            Delete
          </button>
        </div>
      );
    },
    [model, openCreateDialog, openFilePath]
  );

  return (
    <>
      <div className="flex h-full flex-col text-sm">
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
              onClick={() => openCreateDialog("file")}
            >
              <Plus className="size-3.5" />
              File
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => openCreateDialog("directory")}
            >
              <Plus className="size-3.5" />
              Folder
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => void refreshTree({ silent: true })}
              title="Refresh files"
              aria-label="Refresh files"
            >
              <Refresh
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
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

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="text-muted-foreground p-3 text-xs">
              Loading project tree…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-start gap-3 p-3">
              <div className="text-destructive text-xs">{error}</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refreshTree()}
              >
                Retry
              </Button>
            </div>
          ) : paths.length === 0 ? (
            <div className="text-muted-foreground p-3 text-xs">
              No files found.
            </div>
          ) : (
            <FileTree
              model={model}
              header={null}
              renderContextMenu={renderContextMenu}
              className="h-full w-full bg-transparent"
              onClick={handleTreeClick}
              onKeyDown={handleTreeKeyDown}
            />
          )}
        </div>
      </div>

      <Dialog
        open={createDialog !== null}
        onOpenChange={(open) => {
          if (!open) closeCreateDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createDialog?.kind === "directory"
                ? "Create folder"
                : "Create file"}
            </DialogTitle>
            <DialogDescription>
              Enter a repo-relative path. Folder paths can be nested.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={createPath}
            onChange={(event) => setCreatePath(event.target.value)}
            placeholder={
              createDialog?.kind === "directory"
                ? "src/new-folder/"
                : "src/new-file.ts"
            }
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeCreateDialog}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !createPath.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.kind === "directory" ? "folder" : "file"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This will permanently remove ${stripDirectoryTreePath(deleteTarget.path)} from the sandbox.`
                : "This will permanently remove the selected path from the sandbox."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
